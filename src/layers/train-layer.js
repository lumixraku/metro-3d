/**
 * Train rendering on the self-managed WebGL overlay.
 *
 * Each train is drawn as one or more thick strips that follow the actual track
 * curve at the train's current position. We no longer use AMap.Polyline (its
 * redraws are throttled by the map, so trains stuttered at ~1Hz); instead each
 * frame we project the train's lng/lat samples to container pixels and hand the
 * screen-space strips to the GLOverlay, which repaints every animation frame.
 *
 * Two zoom modes:
 *   Far  (zoom < SWITCH_ZOOM)  — single elongated strip; length scales with
 *                                pixels-per-metre so trains stay visible at
 *                                city overview.
 *   Close (zoom >= SWITCH_ZOOM) — six car-shaped strips with a small gap
 *                                between them, modelling a 6-car consist.
 */

import {pointAlong} from '../utils/geo.js';
import {hexToRgb} from './gl-overlay.js';

const CAR_COUNT = 6;
const CAR_LENGTH_M = 18;
const CAR_GAP_M = 2;
const FULL_LENGTH_M = CAR_COUNT * CAR_LENGTH_M + (CAR_COUNT - 1) * CAR_GAP_M; // 118m
const SWITCH_ZOOM = 14.5;
const SAMPLES_PER_CAR = 2;       // points sampled inside each car strip
const SAMPLES_FAR = 5;           // points sampled along the far-mode strip
const MIN_APPARENT_PX_FAR = 14;  // far-mode strip targets ~this many pixels long
const STROKE_FAR = 6;            // far-mode box width in pixels
const CAR_WIDTH_M = 3.2;         // real metro car width — close-mode box width scales with zoom
const TRAIN_HEIGHT_M = 4.0;      // car height; extruded upward on screen for the 3D look
const MIN_WIDTH_PX = 4;
const MIN_HEIGHT_PX = 3;
const SIDE_SHADE = 0.6;          // side faces darker than the top
const CAP_SHADE = 0.45;          // end faces darker still — fakes directional lighting

function metersPerPixel(map) {
    if (typeof map.getResolution === 'function') {
        const r = map.getResolution();
        if (Number.isFinite(r) && r > 0) return r;
    }
    // Web-mercator fallback: 156543.034 m/px at zoom 0 at the equator,
    // halved per zoom level. Adjust for latitude.
    const zoom = map.getZoom();
    const center = map.getCenter();
    const lat = center && (typeof center.getLat === 'function' ? center.getLat() : center.lat) || 22.5;
    return 156543.034 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
}

function clampDist(d, total) { return d < 0 ? 0 : d > total ? total : d; }

/**
 * Sample N+1 points evenly along the path between two cumulative-distance
 * markers. Returns an array of [lng, lat] suitable for AMap.Polyline.path.
 */
function sampleArc(measured, fromDist, toDist, samples) {
    const path = new Array(samples + 1);
    const span = toDist - fromDist;
    for (let i = 0; i <= samples; i++) {
        path[i] = pointAlong(measured, fromDist + span * (i / samples));
    }
    return path;
}

/**
 * Compute the polyline path arrays that make up a single train in the given
 * mode. Returns an array of paths (length 1 in far mode, 6 in close mode).
 */
function buildTrainSegments(train, mode, mPerPx) {
    const total = train.measured.total;
    const center = train.distance;

    let bodyLen;
    if (mode === 'far') {
        bodyLen = Math.max(FULL_LENGTH_M, MIN_APPARENT_PX_FAR * mPerPx);
    } else {
        bodyLen = FULL_LENGTH_M;
    }

    const tail = clampDist(center - bodyLen / 2, total);
    const head = clampDist(center + bodyLen / 2, total);
    const usable = head - tail;
    if (usable <= 0) return [];

    if (mode === 'far') {
        return [sampleArc(train.measured, tail, head, SAMPLES_FAR)];
    }

    // Close mode: 6 cars + 5 gaps. Distribute proportionally across the
    // (possibly truncated) usable span so a train spawning at the terminus
    // still gets six visible cars.
    const totalUnits = CAR_COUNT * CAR_LENGTH_M + (CAR_COUNT - 1) * CAR_GAP_M;
    const segments = [];
    let cursor = tail;
    for (let c = 0; c < CAR_COUNT; c++) {
        const carSpan = (CAR_LENGTH_M / totalUnits) * usable;
        segments.push(sampleArc(train.measured, cursor, cursor + carSpan, SAMPLES_PER_CAR));
        cursor += carSpan;
        if (c < CAR_COUNT - 1) {
            cursor += (CAR_GAP_M / totalUnits) * usable;
        }
    }
    return segments;
}

export class TrainLayer {
    constructor(AMap, map) {
        this.AMap = AMap;
        this.map = map;
        this._hiddenLines = new Set();
        this._colorCache = new Map(); // hex -> [r,g,b]
    }

    _currentMode() {
        return this.map.getZoom() >= SWITCH_ZOOM ? 'close' : 'far';
    }

    _rgb(hex) {
        let c = this._colorCache.get(hex);
        if (!c) { c = hexToRgb(hex); this._colorCache.set(hex, c); }
        return c;
    }

    /**
     * Build the two ground rails of a car as screen points. The centreline is
     * offset left/right by half the car width *in metres, on the ground* (not in
     * screen pixels), then each rail point is projected. This is what makes the
     * box read as a real cuboid: the footprint foreshortens with perspective, so
     * the top face is a proper perspective rectangle instead of a sheared card.
     *
     * Returns {GL, GR} arrays of [x,y] (or null where a point is off-view /
     * behind the camera, where the projection would be garbage).
     */
    _railsGeo(centerline, halfWidthM, bounds) {
        const map = this.map;
        const AMap = this.AMap;
        const n = centerline.length;
        const GL = new Array(n), GR = new Array(n);
        for (let i = 0; i < n; i++) {
            const p = centerline[i];
            const a = centerline[Math.max(0, i - 1)];
            const b = centerline[Math.min(n - 1, i + 1)];
            const mLat = 111320;
            const mLng = 111320 * Math.cos(p[1] * Math.PI / 180);
            // Track direction in local metres, then its ground perpendicular.
            let dx = (b[0] - a[0]) * mLng, dy = (b[1] - a[1]) * mLat;
            const len = Math.hypot(dx, dy) || 1;
            dx /= len; dy /= len;
            const offLng = (-dy * halfWidthM) / mLng;
            const offLat = (dx * halfWidthM) / mLat;
            const lp = new AMap.LngLat(p[0] + offLng, p[1] + offLat);
            const rp = new AMap.LngLat(p[0] - offLng, p[1] - offLat);
            if (!bounds.contains(lp) || !bounds.contains(rp)) { GL[i] = null; GR[i] = null; continue; }
            const ls = map.lngLatToContainer(lp);
            const rs = map.lngLatToContainer(rp);
            GL[i] = [ls.x, ls.y]; GR[i] = [rs.x, rs.y];
        }
        return {GL, GR};
    }

    /**
     * Draw every active train onto the overlay as a 3D cuboid (one box per car
     * in close mode, one elongated box in far mode). Called each frame.
     *
     * The overlay has no depth buffer, so we paint back-to-front: every car
     * across every train is collected, sorted by screen depth (cars nearer the
     * horizon have a smaller y and are farther away), and the far ones are drawn
     * first so nearer cars correctly overlap them.
     */
    draw(overlay, trains) {
        const map = this.map;
        const mode = this._currentMode();
        const mPerPx = metersPerPixel(map);
        const bounds = map.getBounds();
        // World-up projects to screen-vertical under pitch; its apparent length
        // grows from 0 (top-down) toward full (near the horizon).
        const pitchSin = Math.sin(map.getPitch() * Math.PI / 180);

        // Footprint width in metres, but never thinner than a few screen pixels
        // so trains stay visible when zoomed out (the floor only bites at low
        // zoom, where realism doesn't matter).
        const minWidthPx = mode === 'close' ? MIN_WIDTH_PX : STROKE_FAR;
        const halfWidthM = Math.max(CAR_WIDTH_M, minWidthPx * mPerPx) / 2;
        const heightPx = Math.max(mode === 'close' ? MIN_HEIGHT_PX : 2, (TRAIN_HEIGHT_M / mPerPx) * pitchSin);

        const cars = [];
        for (const t of trains) {
            if (this._hiddenLines.has(t.lineId)) continue;
            const c = this._rgb(t.color);
            const top = [c[0], c[1], c[2], 1];
            const side = [c[0] * SIDE_SHADE, c[1] * SIDE_SHADE, c[2] * SIDE_SHADE, 1];
            const cap = [c[0] * CAP_SHADE, c[1] * CAP_SHADE, c[2] * CAP_SHADE, 1];
            const segments = buildTrainSegments(t, mode, mPerPx);
            for (let i = 0; i < segments.length; i++) {
                const {GL, GR} = this._railsGeo(segments[i], halfWidthM, bounds);
                const n = GL.length;
                if (n < 2) continue;
                let ok = true, ySum = 0;
                for (let k = 0; k < n; k++) {
                    if (!GL[k] || !GR[k]) { ok = false; break; }
                    ySum += GL[k][1] + GR[k][1];
                }
                if (!ok) continue;
                cars.push({GL, GR, depth: ySum / (n * 2), top, side, cap});
            }
        }

        cars.sort((a, b) => a.depth - b.depth); // far (small y) first
        for (const car of cars) {
            this._box(overlay, car.GL, car.GR, heightPx, car.top, car.side, car.cap);
        }
    }

    /**
     * Build a cuboid from the two projected ground rails: lift each rail point
     * straight up the screen by the height offset for the top edges, then queue
     * the side, end-cap and top faces. Sides/caps are pushed before the top so
     * the top reads as the upper surface. Skipped if any corner is off-view.
     */
    _box(overlay, GL, GR, uy, top, side, cap) {
        const n = GL.length;
        if (n < 2) return;
        for (let i = 0; i < n; i++) if (!GL[i] || !GR[i]) return;

        const TL = new Array(n), TR = new Array(n);
        for (let i = 0; i < n; i++) {
            TL[i] = [GL[i][0], GL[i][1] - uy];
            TR[i] = [GR[i][0], GR[i][1] - uy];
        }
        for (let i = 0; i < n - 1; i++) {
            overlay.addQuad(GL[i], TL[i], TL[i + 1], GL[i + 1], side);
            overlay.addQuad(GR[i], GR[i + 1], TR[i + 1], TR[i], side);
        }
        overlay.addQuad(GL[0], GR[0], TR[0], TL[0], cap);
        overlay.addQuad(GL[n - 1], TL[n - 1], TR[n - 1], GR[n - 1], cap);
        for (let i = 0; i < n - 1; i++) {
            overlay.addQuad(TL[i], TR[i], TR[i + 1], TL[i + 1], top);
        }
    }

    setLineVisibility(lineId, visible) {
        if (visible) this._hiddenLines.delete(lineId);
        else this._hiddenLines.add(lineId);
    }

    destroy() {}
}
