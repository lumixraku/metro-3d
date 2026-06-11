# Technical Implementation Notes — metro-3d

How the real-time 3D Shenzhen Metro renderer is actually built. Pure
implementation detail: coordinate math, GPU buffer layout, shaders, the
schedule model, and the AMap integration. File references point at `src/`.

## 1. Custom WebGL layer sharing AMap's camera (`layers/gl-scene.js`)

Rendering rides on `AMap.GLCustomLayer`, so it draws into AMap's own WebGL
context and reuses its MVP matrix and depth buffer instead of doing
screen-space projection.

- The layer is registered with `{zIndex, init(gl), render(gl)}`. `init` compiles
  programs and creates buffers once; `render(gl)` runs inside AMap's pipeline.
- The MVP comes from `map.customCoords.getMVPMatrix()`. `customCoords.setCenter(center)`
  must be called (with a fixed projection origin) before both `lngLatToCoord`
  and `getMVPMatrix` so world coords and the matrix agree.
- `lngLatToCoord([lng,lat])` maps geographic coords to AMap world units. Feeding
  world coords through the real perspective MVP means the GPU does near-plane
  clipping (points behind the camera vanish — no "fly lines") and the depth
  buffer resolves occlusion (no painter's-algorithm sorting, no manual culling).
- GL state per frame: `DEPTH_TEST` with `depthFunc(LEQUAL)`, `BLEND` with
  `SRC_ALPHA, ONE_MINUS_SRC_ALPHA`. Solid boxes draw first (opaque, write depth),
  lines second (depth-tested against the boxes).

### `lngLatToContainer` vs `lngLatToCoord` — the two coordinate APIs

This is the crux of the rewrite (screen-space overlay → GLCustomLayer). The two
AMap conversions differ by one word but do completely different things:

| API | Output | Coordinate space | Where projection happens | Behind-camera clipping |
|---|---|---|---|---|
| `map.lngLatToContainer` | `{x, y}` pixels | **screen** (container top-left origin, x right / y down) | inside AMap, straight to the screen | **none** — discards the clip-space `w` sign |
| `map.customCoords.lngLatToCoord` | `[x, y]` | **world** (AMap's internal Mercator units, *not* metres, pre-projection) | left to the GPU (MVP in the vertex shader) | **GPU near-plane clip, automatic** |

- The old overlay used `lngLatToContainer`: lng/lat → screen pixels → 2D lines.
  Projection was outsourced to AMap, which flattens 3D to 2D and loses the `w`
  sign, so points **behind the camera** (`w ≤ 0`) come back as garbage pixel
  values (hundreds of thousands of px) and connect into "fly lines". No depth
  buffer either, so occlusion/back-faces had to be hacked manually.
- The new scene uses `lngLatToCoord`: lng/lat → world `[x, y]` (caller adds z),
  pushed into the vertex buffer. **Projection is not done in JS** — it happens in
  the vertex shader as `gl_Position = u_mvp * vec4(a_pos, 1.0)`, with `u_mvp`
  from `customCoords.getMVPMatrix()`. Because projection is left to the GPU,
  near-plane clipping and depth testing apply for free.

Full pipeline:

```
lng/lat
  --customCoords.lngLatToCoord-->  world [x, y] (Mercator units)   ← CPU (gl-scene.js toWorld)
  --MVP matrix (in vertex shader)-> clip space             ← GPU
  --perspective divide + near clip-> screen                ← GPU, free
```

The fly lines disappeared not because of a different drawing method, but because
the **projection step moved from `lngLatToContainer` (outsourced to AMap, `w`
discarded) back to the GPU's own MVP transform (keeps `w`, clips behind-camera
points)**.

### Converting metres ↔ AMap world units

`lngLatToCoord` returns AMap's **internal Mercator world units, not metres**, and
they are relative to whatever origin `customCoords.setCenter()` was last given.
You cannot substitute your own metre-based coordinate system, because the
`getMVPMatrix()` camera matrix is built *for this exact coordinate system* — the
geometry coords and the matrix must come from the same source to multiply
correctly. So real-world sizes (a 4 m car height, a 1 m line lift) have to be
converted into these world units before they can be used as a z or an offset.

There are **two different conversions** in the code, because vertical and
horizontal sit in different coordinate forms:

**Vertical (z): a measured scalar `worldPerMeter`.** A height has no lng/lat — it
is a pure extrusion along the world z axis — so it needs a direct
metres → world-units multiplier. `beginFrame()` measures it empirically each
frame by asking AMap how many world units span a known ground distance:

```js
const o = cc.lngLatToCoord(center);
const n = cc.lngLatToCoord([center[0], center[1] + 0.001]);   // 0.001° north
const worldPerDegLat = Math.hypot(n[0]-o[0], n[1]-o[1]) / 0.001;
this._worldPerMeter = worldPerDegLat / 110574;   // 110574 m per degree of latitude
```

- A **latitude** delta is used (not longitude) because metres-per-degree of
  latitude is ~constant (`110574`), whereas longitude varies with `cos(lat)`.
- It is recomputed per frame because the Mercator scale changes with the
  viewport's centre/zoom.
- Usage: heights/lifts in metres become world z via
  `metres * scene.worldPerMeter` — e.g. `LIFT_M * worldPerMeter` (line-layer)
  and `TRAIN_HEIGHT_M * worldPerMeter` (train-layer `heightW`).

**Horizontal (xy): metres → degrees → `lngLatToCoord`.** A horizontal offset
*does* have a lng/lat, so instead of a scalar it is expressed as a lng/lat delta
and routed through the authoritative projection. `train-layer.js` offsets the
car centreline left/right by `halfWidthM` metres using the local metres-per-degree:

```js
const mLat = 111320;                              // m per degree latitude
const mLng = 111320 * Math.cos(p[1]*Math.PI/180); // m per degree longitude at this lat
const offLng = (-dy * halfWidthM) / mLng;         // metres → degrees
const offLat = ( dx * halfWidthM) / mLat;
const l = scene.toWorld(p[0]+offLng, p[1]+offLat); // degrees → world via lngLatToCoord
```

So z uses the `worldPerMeter` scalar, while xy converts metres to a degree
offset and lets `lngLatToCoord` do the projection. (The `110574` used for z and
the `111320` used for xy are both "metres per degree of latitude" — they differ
only because they were sourced/rounded independently; either is fine at city
scale.)

## 2. Interleaved vertex buffers (`gl-scene.js`)

Two programs, two interleaved `Float32Array` layouts uploaded with `DYNAMIC_DRAW`:

- **Solid** — `SOLID_STRIDE = 7` floats: `pos(3) + color(4)`.
- **Line** — `LINE_STRIDE = 15` floats: `pos(3) + prev(3) + next(3) + side(1) + width(1) + color(4)`.

CPU-side scratch arrays (`_solid`, `_line`) are filled each frame by the layers
via `solidQuad()` / `addPolyline()`, then `commit()` freezes them into typed
arrays. Attributes are bound with `vertexAttribPointer(loc, size, FLOAT, false,
stride*4, offset*4)`. `solidQuad(a,b,c,d)` emits two triangles `a,b,c / a,c,d`.

## 3. Constant-pixel-width miter polylines in the vertex shader (`gl-scene.js`)

Lines keep a constant screen width regardless of zoom and bevel their joins,
entirely in `VERT_LINE`:

- Each vertex carries its own position plus `a_prev`/`a_next` (neighbour world
  positions) and `a_side` (±1).
- All three are projected by the MVP; positions are taken to screen space via
  `xy / w` scaled by the viewport.
- Direction vectors `dirA` (prev→cur) and `dirB` (cur→next) give normals
  `nA`, `nB`; the miter direction is `normalize(nA + nB)`.
- Miter length is scaled by `1.0 / max(abs(dot(miter, nA)), 0.35)` — the `0.35`
  clamp caps the spike at sharp angles.
- The offset is applied in screen space, then multiplied back by `cp.w` so
  perspective and near-plane clipping still hold:
  `gl_Position = vec4((sp + off) * cp.w, cp.z, cp.w)`.
- `addPolyline()` (CPU) emits 6 vertices per segment, passing
  `pts[i-1] || A` and `pts[i+2] || B` as the end neighbours. Width is multiplied
  by `devicePixelRatio` so lines are crisp on HiDPI.

## 4. Stateless train positions from headway math (`simulation.js`)

No per-train objects or per-frame integration. Given a simulated `Date`, the
set of live trains and their positions is derived analytically each frame.

Per line (`LineSchedule`):

- `runtimeSec = (pathLength / cruiseSpeed) + intermediateStations * 30s` dwell.
- `headwaySec` switches between `peakHeadway`/`headway` based on whether the
  minute-of-day falls in any `peakWindows`.
- A train dispatched at multiple of `headway` is live now iff its run window
  `[k*h, k*h + runtime]` covers the elapsed time since first train. Only the
  covering `k` range is iterated:

  ```js
  const earliestK = Math.floor((sinceFirstSec - runtime) / headway);
  const latestK   = Math.floor(sinceFirstSec / headway);
  ```

- For each live `k`, `progress = t / runtime`; position is `pointAlong(measured,
  progress * total)` for outbound (`direction +1`) or `(1-progress)*total` for
  return (`direction -1`).
- Return trains are offset by `headway/2` purely for visual spacing.
- Outside `[firstTrain, lastTrain]` the line returns `[]` — empty at night,
  by design.

`Simulation.snapshot(date)` flattens all lines into one array of lightweight
`{id, lineId, color, coord, distance, measured, direction, progress}`.

## 5. Path measurement and sampling (`utils/geo.js`)

- `distanceMeters` is Haversine on a sphere (R = 6378137) — accurate enough
  under ~100 km, avoids bundling turf.
- `measurePath(path)` returns `{path, cum, total}` where `cum` is a `Float64Array`
  of cumulative metres per vertex.
- `pointAlong(measured, dist)` binary-searches `cum` for the segment containing
  `dist`, then linearly interpolates lng/lat within it.
- `snapStationsToPath` assigns each station a cumulative `distance` by
  nearest-*vertex* search (not nearest-point-on-segment — the AMap polyline is
  dense enough), then sorts stations by distance along the path.

## 6. Trains as extruded 3D cuboids (`layers/train-layer.js`)

Each train is built as oriented boxes fed to `scene.solidQuad`, with the depth
buffer handling occlusion so faces emit in any order.

- **Zoom LOD**: below `SWITCH_ZOOM = 14.5`, one elongated box per train
  (`mode='far'`, 5 arc samples); at/above, six car boxes (18 m car + 2 m gap =
  118 m, 2 samples each).
- **Centreline → box**: for each sample, a tangent is taken from neighbour
  samples and converted to metres (`mLat = 111320`, `mLng = 111320*cos(lat)`).
  The perpendicular `(-dy, dx)` offset by `halfWidthM` produces left/right
  ground rails (z=0); a lifted copy at `heightW` gives the roof. Each segment
  emits left wall, right wall, roof; the two ends emit cap quads.
- **Apparent-size floors**: `metersPerPixel(map)` (from `getResolution()`, or
  `156543.034 * cos(lat) / 2^zoom`) is used to enforce a minimum on-screen width
  (`MIN_WIDTH_PX`/`STROKE_FAR_PX`) and, in far mode, a minimum body length
  (`MIN_APPARENT_PX_FAR`), so trains stay visible when zoomed out.
- **Shading**: face colour is the line colour times `1.0` (roof), `SIDE_SHADE
  0.62` (walls), `CAP_SHADE 0.48` (ends) — fake directional lighting via flat
  per-face multipliers. `hexToRgb` results are cached per colour.

## 7. Lines and the per-frame loop (`layers/line-layer.js`, `map.js`)

- `LineLayer.build(scene)` converts each line's lng/lat path to world coords,
  lifts it `LIFT_M = 1 m` (× `worldPerMeter`) above ground to avoid z-fighting
  the basemap, and calls `addPolyline`. Highlight state widens the active line
  to `HILITE_WIDTH` and dims others to `DIM_OPACITY 0.35`.
- The driver in `map.js._startLoop` runs every `requestAnimationFrame`:
  `clock.now()` → `simulation.snapshot` → `scene.beginFrame()` →
  `lineLayer.build` + `trainLayer.build` → `scene.commit()` → `map.render()`.
  `map.render()` is what triggers the `GLCustomLayer.render` callback.

## 8. Scalable simulation clock (`clock.js`)

- `now()` accumulates `(realNow - lastReal) * speed` into `_simTime`; every
  other module reads simulated time only through it, never `Date.now()`.
- `setSpeed`/`pause` call `now()` first to flush accumulated drift before
  changing state. `onChange` fans out to listeners (e.g. the clock panel).
- `parseHHMM` → minutes-of-day; `minutesOfDay(date)` includes
  seconds + milliseconds/60 so train positions advance continuously per frame
  rather than stepping once per whole second.

## 9. Camera modifier-drag overlay (`camera.js`)

- Capture-phase `mousedown`/`mousemove`/`mouseup` on window. On mousedown with
  ⌘/Ctrl (tilt) or ⇧ (rotate), it sets `map.setStatus({dragEnable:false})` to
  suppress AMap's pan for that gesture, then restores it on mouseup.
- Tilt: `setPitch(clamp(current - dy*0.5, 0, 75), true)`. Rotate:
  `setRotation(((current - dx*0.5) % 360 + 360) % 360, true)`. The `true`
  (`immediately`) flag skips AMap smoothing for 1:1 cursor tracking.

## 10. AMap line geometry via REST (`data/loader.js`)

- Calls `https://restapi.amap.com/v3/bus/linename` **directly via `fetch`**, not
  the AMap JS plugin: the key is a "Web 服务" key, and the JS plugin sends
  `platform=JS` → `USERKEY_PLAT_NOMATCH (10009)`. REST returns
  `Access-Control-Allow-Origin: *`, so browser fetch works.
- `pickBestRecord`: AMap returns both directions and short turnback variants as
  separate records; pick the longest `polyline` among records whose `name`
  contains `<code>号线`.
- `parsePolyline` splits `"lng,lat;lng,lat;..."`; `normaliseRecord` also maps
  `busstops` to stations.
- **Rate limiting**: free-tier QPS cap (10021/CUQPS) is handled with a 350 ms
  gap between calls (failures included — they still count), and up to 2 retries
  at 1500 ms *only* on rate-limit/timeout errors; bad-key/no-data fail fast.
- **Caching**: results go to `localStorage` under `m3d:line:v3:<id>` with a
  30-day TTL. `fetchJson` races the request against an 8 s timeout.

## 11. 3D buildings (`map.js._addBuildings`)

`AMap.Buildings({zooms:[15,20]})` is overlaid with `setStyle`. AMap building
colours are **AARRGGBB (alpha first)**; `ff` alpha = fully opaque. `color1` is
the roof, `color2` the (darker) wall, scoped to a Shenzhen bounding-box `path`.
AMap's renderer depth-tests these, so opaque colours alone give correct occlusion.

## 12. Build & key injection (`rollup.config.mjs`)

- A ~20-line in-repo `.env` parser (no `dotenv` dependency) loads `M3D_AMAP_KEY`
  / `M3D_AMAP_SECURITY_CODE`, merged with `process.env`.
- `@rollup/plugin-replace` substitutes `__M3D_AMAP_KEY__` /
  `__M3D_AMAP_SECURITY_CODE__` at build time. `index.html` lets `?key=`/`?sec=`
  URL params override at runtime.
- Three outputs from `src/index.js`: UMD (`m3d` global), ESM, and minified UMD
  (terser), all with sourcemaps. CSS is extracted via `rollup-plugin-postcss`.
- `dist/` is gitignored — the source in `src/` is the truth; `index.html` loads
  the built bundle, so `pnpm build` (or `pnpm dev` = watch + serve) must run for
  source changes to appear.
