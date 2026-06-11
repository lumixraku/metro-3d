/**
 * Real 3D scene renderer built on AMap.GLCustomLayer.
 *
 * Unlike the old screen-space overlay (which projected each lng/lat to pixels
 * with lngLatToContainer and drew flat 2D), this shares AMap's actual WebGL
 * context, camera MVP matrix and depth buffer:
 *   • geometry is fed in world coordinates (metres east/north + metres up),
 *     transformed by the real perspective MVP from customCoords.getMVPMatrix();
 *   • the GPU clips primitives at the near plane, so points behind the camera
 *     simply vanish — no more "fly lines" shooting across the sky;
 *   • the depth buffer resolves occlusion for free — no painter sorting, no
 *     back-face culling, no interior faces showing through.
 *
 * The layer's render() runs inside AMap's pipeline; we drive it every animation
 * frame from the main loop via map.render() so trains move at 60fps.
 *
 * Build order each frame:  beginFrame() → layers push geometry → commit()
 * → map.render() → our render(gl) uploads the buffers and draws.
 */

const VERT_SOLID = `
attribute vec3 a_pos;
attribute vec4 a_color;
uniform mat4 u_mvp;
varying vec4 v_color;
void main() {
    gl_Position = u_mvp * vec4(a_pos, 1.0);
    v_color = a_color;
}`;

const FRAG = `
precision mediump float;
varying vec4 v_color;
void main() { gl_FragColor = v_color; }`;

// Constant pixel-width lines with miter joins: each vertex knows its previous
// and next neighbour, so the offset direction bisects the turn (miter) and
// consecutive segments share the seam — no gaps/sawtooth at curves. The offset
// is computed in screen space then scaled back by clip.w so perspective and
// near-plane clipping still hold. The miter length is clamped to avoid spikes
// at sharp angles.
const VERT_LINE = `
attribute vec3 a_pos;
attribute vec3 a_prev;
attribute vec3 a_next;
attribute float a_side;
attribute float a_width;
attribute vec4 a_color;
uniform mat4 u_mvp;
uniform vec2 u_viewport;
varying vec4 v_color;
void main() {
    vec4 cp = u_mvp * vec4(a_pos, 1.0);
    vec4 cpv = u_mvp * vec4(a_prev, 1.0);
    vec4 cnx = u_mvp * vec4(a_next, 1.0);
    vec2 sp = cp.xy / cp.w;
    vec2 dA = (sp - cpv.xy / cpv.w) * u_viewport;
    vec2 dB = (cnx.xy / cnx.w - sp) * u_viewport;
    float lA = length(dA), lB = length(dB);
    vec2 dirA = lA > 1e-5 ? dA / lA : (lB > 1e-5 ? dB / lB : vec2(1.0, 0.0));
    vec2 dirB = lB > 1e-5 ? dB / lB : dirA;
    vec2 nA = vec2(-dirA.y, dirA.x);
    vec2 nB = vec2(-dirB.y, dirB.x);
    vec2 miter = normalize(nA + nB);
    float scale = 1.0 / max(abs(dot(miter, nA)), 0.35);
    vec2 off = miter * a_side * (a_width * 0.5 * scale) / u_viewport * 2.0;
    gl_Position = vec4((sp + off) * cp.w, cp.z, cp.w);
    v_color = a_color;
}`;

const SOLID_STRIDE = 7;  // pos(3) + color(4)
const LINE_STRIDE = 15;  // pos(3) + prev(3) + next(3) + side(1) + width(1) + color(4)

function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error('[gl-scene] shader: ' + gl.getShaderInfoLog(s));
    }
    return s;
}

function link(gl, vsSrc, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error('[gl-scene] link: ' + gl.getProgramInfoLog(p));
    }
    return p;
}

export class GLScene {
    constructor(AMap, map, center) {
        this.AMap = AMap;
        this.map = map;
        this.cc = map.customCoords;
        this.center = center; // fixed [lng,lat] projection origin
        // Trains move every frame, so their geometry is rebuilt each frame —
        // but into a persistent, growable typed array (no per-frame allocation)
        // and uploaded with bufferSubData (the GL store is reused, not realloced).
        this._solidArr = new Float32Array(4096);
        this._solidLen = 0;     // floats written this frame
        this._solidCap = 0;     // GPU buffer byte capacity (grows with _solidArr)
        // Lines are static in world space (the camera lives in the MVP, not the
        // geometry), so they are built once and rebuilt only when highlight /
        // visibility / dpr change — see LineLayer. _lineUploadPending tracks when
        // the GPU copy is stale.
        this._line = [];
        this._lineArr = new Float32Array(0);
        this._lineUploadPending = false;
        this._worldPerMeter = 1;
        this._dpr = window.devicePixelRatio || 1;

        this.layer = new AMap.GLCustomLayer({
            zIndex: 220,
            init: (gl) => this._init(gl),
            render: (gl) => this._render(gl)
        });
        map.add(this.layer);
    }

    _init(gl) {
        this.gl = gl;
        this.solidProg = link(gl, VERT_SOLID, FRAG);
        this.lineProg = link(gl, VERT_LINE, FRAG);
        this.solidBuf = gl.createBuffer();
        this.lineBuf = gl.createBuffer();

        this.s_pos = gl.getAttribLocation(this.solidProg, 'a_pos');
        this.s_color = gl.getAttribLocation(this.solidProg, 'a_color');
        this.s_mvp = gl.getUniformLocation(this.solidProg, 'u_mvp');

        this.l_pos = gl.getAttribLocation(this.lineProg, 'a_pos');
        this.l_prev = gl.getAttribLocation(this.lineProg, 'a_prev');
        this.l_next = gl.getAttribLocation(this.lineProg, 'a_next');
        this.l_side = gl.getAttribLocation(this.lineProg, 'a_side');
        this.l_width = gl.getAttribLocation(this.lineProg, 'a_width');
        this.l_color = gl.getAttribLocation(this.lineProg, 'a_color');
        this.l_mvp = gl.getUniformLocation(this.lineProg, 'u_mvp');
        this.l_viewport = gl.getUniformLocation(this.lineProg, 'u_viewport');
    }

    /** Start a frame: reset the train scratch and refresh the world scale.
     *  (Line geometry is cached across frames and not touched here.) */
    beginFrame() {
        this._solidLen = 0;
        this._dpr = window.devicePixelRatio || 1;
        this.cc.setCenter(this.center);
        // world units per metre (Mercator stretch ≈ 1/cos(lat))
        const o = this.cc.lngLatToCoord(this.center);
        const n = this.cc.lngLatToCoord([this.center[0], this.center[1] + 0.001]);
        const worldPerDegLat = Math.hypot(n[0] - o[0], n[1] - o[1]) / 0.001;
        this._worldPerMeter = worldPerDegLat / 110574;
    }

    get worldPerMeter() { return this._worldPerMeter; }
    get dpr() { return this._dpr; }

    /** Convert [lng,lat] to world [x,y] (z added by the caller). */
    toWorld(lng, lat) {
        return this.cc.lngLatToCoord([lng, lat]);
    }

    /** Grow the train scratch array if `extra` more floats won't fit. */
    _ensureSolid(extra) {
        const need = this._solidLen + extra;
        if (need <= this._solidArr.length) return;
        let cap = this._solidArr.length || 4096;
        while (cap < need) cap *= 2;
        const next = new Float32Array(cap);
        next.set(this._solidArr.subarray(0, this._solidLen));
        this._solidArr = next;
    }

    /** Queue a filled triangle-quad (a,b,c,d are world [x,y,z]). */
    solidQuad(a, b, c, d, rgba) {
        this._ensureSolid(42); // 6 verts × 7 floats — reserve so writes never grow mid-quad
        const A = this._solidArr;
        let n = this._solidLen;
        const v = (p) => {
            A[n] = p[0]; A[n + 1] = p[1]; A[n + 2] = p[2];
            A[n + 3] = rgba[0]; A[n + 4] = rgba[1]; A[n + 5] = rgba[2]; A[n + 6] = rgba[3];
            n += 7;
        };
        v(a); v(b); v(c); v(a); v(c); v(d);
        this._solidLen = n;
    }

    /**
     * Queue a thick miter-joined polyline. `pts` is an array of world [x,y,z];
     * each segment emits two triangles whose vertices carry their prev/next
     * neighbours so the shader can bevel the joins.
     */
    addPolyline(pts, widthCss, rgba) {
        if (pts.length < 2) return;
        const w = widthCss * this._dpr;
        const L = this._line;
        const v = (pos, prev, next, side) => L.push(
            pos[0], pos[1], pos[2], prev[0], prev[1], prev[2], next[0], next[1], next[2],
            side, w, rgba[0], rgba[1], rgba[2], rgba[3]);
        for (let i = 0; i < pts.length - 1; i++) {
            const A = pts[i], B = pts[i + 1];
            const pa = pts[i - 1] || A;       // A's previous neighbour
            const nb = pts[i + 2] || B;       // B's next neighbour
            v(A, pa, B, -1); v(A, pa, B, 1); v(B, A, nb, -1);
            v(B, A, nb, -1); v(A, pa, B, 1); v(B, A, nb, 1);
        }
    }

    /** Rebuild the cached line geometry. `fn` pushes via addPolyline. Called by
     *  LineLayer only when the lines actually change, not every frame. */
    rebuildLines(fn) {
        this._line.length = 0;
        fn();
        this._lineArr = new Float32Array(this._line);
        this._lineUploadPending = true;
    }

    _render(gl) {
        this.cc.setCenter(this.center);
        const mvp = this.cc.getMVPMatrix();
        const vw = gl.drawingBufferWidth, vh = gl.drawingBufferHeight;

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // Solid 3D boxes first (opaque, write depth). The geometry changes every
        // frame, so we reuse one GPU store: re-allocate it only when it must grow,
        // otherwise just bufferSubData the used portion (a subarray view, no copy).
        if (this._solidLen) {
            gl.useProgram(this.solidProg);
            gl.uniformMatrix4fv(this.s_mvp, false, mvp);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.solidBuf);
            const bytes = this._solidLen * 4;
            if (bytes > this._solidCap) {
                gl.bufferData(gl.ARRAY_BUFFER, this._solidArr.byteLength, gl.DYNAMIC_DRAW);
                this._solidCap = this._solidArr.byteLength;
            }
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._solidArr.subarray(0, this._solidLen));
            const fb = SOLID_STRIDE * 4;
            gl.enableVertexAttribArray(this.s_pos);
            gl.vertexAttribPointer(this.s_pos, 3, gl.FLOAT, false, fb, 0);
            gl.enableVertexAttribArray(this.s_color);
            gl.vertexAttribPointer(this.s_color, 4, gl.FLOAT, false, fb, 12);
            gl.drawArrays(gl.TRIANGLES, 0, this._solidLen / SOLID_STRIDE);
        }

        // Lines on top (ground level), depth-tested against the boxes. The
        // geometry is static, so it's only re-uploaded when rebuilt; every frame
        // we just re-bind and redraw with the live MVP.
        if (this._lineArr.length) {
            gl.useProgram(this.lineProg);
            gl.uniformMatrix4fv(this.l_mvp, false, mvp);
            gl.uniform2f(this.l_viewport, vw, vh);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
            if (this._lineUploadPending) {
                gl.bufferData(gl.ARRAY_BUFFER, this._lineArr, gl.STATIC_DRAW);
                this._lineUploadPending = false;
            }
            const fb = LINE_STRIDE * 4;
            gl.enableVertexAttribArray(this.l_pos);
            gl.vertexAttribPointer(this.l_pos, 3, gl.FLOAT, false, fb, 0);
            gl.enableVertexAttribArray(this.l_prev);
            gl.vertexAttribPointer(this.l_prev, 3, gl.FLOAT, false, fb, 12);
            gl.enableVertexAttribArray(this.l_next);
            gl.vertexAttribPointer(this.l_next, 3, gl.FLOAT, false, fb, 24);
            gl.enableVertexAttribArray(this.l_side);
            gl.vertexAttribPointer(this.l_side, 1, gl.FLOAT, false, fb, 36);
            gl.enableVertexAttribArray(this.l_width);
            gl.vertexAttribPointer(this.l_width, 1, gl.FLOAT, false, fb, 40);
            gl.enableVertexAttribArray(this.l_color);
            gl.vertexAttribPointer(this.l_color, 4, gl.FLOAT, false, fb, 44);
            gl.drawArrays(gl.TRIANGLES, 0, this._lineArr.length / LINE_STRIDE);
        }
    }

    destroy() {
        this.map.remove(this.layer);
    }
}

/** Parse '#rrggbb' (or '#rgb') to [r,g,b] in 0..1. */
export function hexToRgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
