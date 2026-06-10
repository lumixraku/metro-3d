/**
 * Self-managed WebGL overlay that sits above the AMap canvas.
 *
 * Why this exists: AMap's vector overlays (AMap.Polyline) coalesce their
 * redraws into the map's own throttled render loop, so calling setPath() every
 * frame does NOT repaint every frame — moving trains visibly stutter at ~1Hz.
 * To get true 60fps motion we stop using AMap overlays for the dynamic content
 * and instead draw it ourselves: every frame the layers project their
 * lng/lat points to container pixels via map.lngLatToContainer() and hand us
 * screen-space polylines, which we triangulate and draw here.
 *
 * Coordinate system: vertices are in CSS pixels matching AMap's container
 * pixels (what lngLatToContainer returns). The vertex shader maps those to
 * clip space using the CSS canvas size; the drawing buffer is scaled by
 * devicePixelRatio for crisp lines on retina displays.
 *
 * Line rendering: WebGL has no thick-line primitive, so each segment is
 * expanded into a quad of the requested pixel width and a small disc is drawn
 * at every vertex to round the joins and caps (so curved tracks read as one
 * continuous smooth stroke rather than disjoint rectangles).
 */

const VERT_SRC = `
attribute vec2 a_pos;
attribute vec4 a_color;
uniform vec2 u_size;
varying vec4 v_color;
void main() {
    vec2 ndc = vec2(a_pos.x / u_size.x * 2.0 - 1.0, 1.0 - a_pos.y / u_size.y * 2.0);
    gl_Position = vec4(ndc, 0.0, 1.0);
    v_color = a_color;
}`;

const FRAG_SRC = `
precision mediump float;
varying vec4 v_color;
void main() { gl_FragColor = v_color; }`;

const DISC_SEGMENTS = 10; // facets used to round joins/caps

function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error('[gl-overlay] shader: ' + gl.getShaderInfoLog(sh));
    }
    return sh;
}

/** Parse '#rrggbb' (or '#rgb') to [r,g,b] in 0..1. */
export function hexToRgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class GLOverlay {
    constructor(container) {
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'm3d-gl-overlay';
        // Sit above the AMap canvas; never intercept pointer events so map
        // pan/zoom/pitch interactions keep working untouched.
        Object.assign(this.canvas.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: '300'
        });
        container.appendChild(this.canvas);

        const gl = this.canvas.getContext('webgl', {alpha: true, premultipliedAlpha: false, antialias: true});
        if (!gl) throw new Error('[gl-overlay] WebGL unavailable');
        this.gl = gl;

        const prog = gl.createProgram();
        gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT_SRC));
        gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            throw new Error('[gl-overlay] link: ' + gl.getProgramInfoLog(prog));
        }
        this.prog = prog;
        this.a_pos = gl.getAttribLocation(prog, 'a_pos');
        this.a_color = gl.getAttribLocation(prog, 'a_color');
        this.u_size = gl.getUniformLocation(prog, 'u_size');
        this.posBuf = gl.createBuffer();
        this.colorBuf = gl.createBuffer();

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // Per-frame scratch arrays (reused; cleared in begin()).
        // Two geometry streams per frame: flat lines (tracks) drawn without face
        // culling, and solid box faces drawn with back-face culling so only the
        // outward-facing surfaces of each cuboid show.
        this._linePos = [];
        this._lineCol = [];
        this._solidPos = [];
        this._solidCol = [];

        gl.cullFace(gl.BACK);
        gl.frontFace(gl.CCW);

        this._resize();
        this._ro = new ResizeObserver(() => this._resize());
        this._ro.observe(container);
    }

    _resize() {
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.clientWidth || 1;
        const h = this.canvas.clientHeight || 1;
        this._cssW = w;
        this._cssH = h;
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    /** Start a frame: clear the CPU vertex buffers and the canvas. */
    begin() {
        this._linePos.length = 0;
        this._lineCol.length = 0;
        this._solidPos.length = 0;
        this._solidCol.length = 0;
    }

    /**
     * Queue a thick polyline in screen (CSS-pixel) space. Entries may be null
     * for points that are off-view / behind the 3D camera (their projection is
     * garbage); the polyline is broken at those gaps so we never draw a segment
     * connecting a visible point to a behind-camera one (the "lines into the
     * sky" artifact).
     * @param {Array<[number,number]|null>} pts
     * @param {number} width        stroke width in CSS pixels
     * @param {[number,number,number,number]} rgba
     */
    addLine(pts, width, rgba) {
        if (pts.length < 1) return;
        const r = width / 2;
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i], b = pts[i + 1];
            if (a && b) this._segment(a[0], a[1], b[0], b[1], r, rgba);
        }
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (p) this._disc(p[0], p[1], r, rgba);
        }
    }

    /**
     * Queue a filled quad (4 screen-pixel corners in order around the quad).
     * Used to build the faces of the 3D train cuboids.
     */
    addQuad(a, b, c, d, rgba) {
        this._solidPos.push(a[0], a[1], b[0], b[1], c[0], c[1], a[0], a[1], c[0], c[1], d[0], d[1]);
        this._pushColor(this._solidCol, rgba, 6);
    }

    _pushColor(arr, rgba, times) {
        for (let i = 0; i < times; i++) arr.push(rgba[0], rgba[1], rgba[2], rgba[3]);
    }

    _segment(ax, ay, bx, by, r, rgba) {
        let dx = bx - ax, dy = by - ay;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) return;
        dx /= len; dy /= len;
        const nx = -dy * r, ny = dx * r;
        const x1 = ax + nx, y1 = ay + ny;
        const x2 = ax - nx, y2 = ay - ny;
        const x3 = bx + nx, y3 = by + ny;
        const x4 = bx - nx, y4 = by - ny;
        this._linePos.push(x1, y1, x2, y2, x3, y3, x2, y2, x4, y4, x3, y3);
        this._pushColor(this._lineCol, rgba, 6);
    }

    _disc(cx, cy, r, rgba) {
        const P = this._linePos;
        for (let i = 0; i < DISC_SEGMENTS; i++) {
            const a0 = (i / DISC_SEGMENTS) * Math.PI * 2;
            const a1 = ((i + 1) / DISC_SEGMENTS) * Math.PI * 2;
            P.push(cx, cy,
                cx + Math.cos(a0) * r, cy + Math.sin(a0) * r,
                cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
            this._pushColor(this._lineCol, rgba, 3);
        }
    }

    _drawArray(pos, col) {
        const gl = this.gl;
        const count = pos.length / 2;
        if (!count) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.a_pos);
        gl.vertexAttribPointer(this.a_pos, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(col), gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.a_color);
        gl.vertexAttribPointer(this.a_color, 4, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLES, 0, count);
    }

    /** Upload the queued geometry and draw it: flat lines first, then the
     * back-face-culled solid box faces on top. */
    flush() {
        const gl = this.gl;
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(this.prog);
        gl.uniform2f(this.u_size, this._cssW, this._cssH);

        gl.disable(gl.CULL_FACE);
        this._drawArray(this._linePos, this._lineCol);

        gl.enable(gl.CULL_FACE);
        this._drawArray(this._solidPos, this._solidCol);
        gl.disable(gl.CULL_FACE);
    }

    destroy() {
        this._ro.disconnect();
        const gl = this.gl;
        gl.deleteBuffer(this.posBuf);
        gl.deleteBuffer(this.colorBuf);
        gl.deleteProgram(this.prog);
        this.canvas.remove();
    }
}
