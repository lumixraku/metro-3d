/**
 * Trains as real 3D cuboids fed to the GLScene. Each car's ground footprint is
 * offset left/right by half the car width (in metres) and lifted to the car
 * height (in metres); the scene's perspective MVP + depth buffer then render
 * and occlude them correctly. No screen-space projection, no painter sorting,
 * no behind-camera culling — the GPU does all of that.
 *
 * Two zoom modes (same as before): far = one elongated box per train, close =
 * six car boxes. Width has a small pixel floor so trains stay visible when
 * zoomed out (where they flatten into a coloured mark on the line); height
 * stays at the real car height, so the 3D massing only shows once zoomed in.
 */

import {pointAlong} from '../utils/geo.js';
import {hexToRgb} from './gl-scene.js';

const CAR_COUNT = 6;
const CAR_LENGTH_M = 18;
const CAR_GAP_M = 2;
const FULL_LENGTH_M = CAR_COUNT * CAR_LENGTH_M + (CAR_COUNT - 1) * CAR_GAP_M; // 118m
const SWITCH_ZOOM = 14.5;
const SAMPLES_PER_CAR = 2;
const SAMPLES_FAR = 5;
const MIN_APPARENT_PX_FAR = 14;
const STROKE_FAR_PX = 6;          // far-mode min apparent width in pixels
const CAR_WIDTH_M = 3.2;          // real metro car width
const TRAIN_HEIGHT_M = 4.0;       // real car height
const MIN_WIDTH_PX = 5;           // never thinner than this on screen
const SIDE_SHADE = 0.62;          // side faces darker than the top
const CAP_SHADE = 0.48;           // end faces darker still

function metersPerPixel(map) {
    if (typeof map.getResolution === 'function') {
        const r = map.getResolution();
        if (Number.isFinite(r) && r > 0) return r;
    }
    const zoom = map.getZoom();
    const center = map.getCenter();
    const lat = center && (typeof center.getLat === 'function' ? center.getLat() : center.lat) || 22.5;
    return 156543.034 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
}

function clampDist(d, total) { return d < 0 ? 0 : d > total ? total : d; }

function sampleArc(measured, fromDist, toDist, samples) {
    const path = new Array(samples + 1);
    const span = toDist - fromDist;
    for (let i = 0; i <= samples; i++) {
        path[i] = pointAlong(measured, fromDist + span * (i / samples));
    }
    return path;
}

/**
 * Centreline lng/lat samples for each car (1 strip far, 6 close).
 */
function buildTrainSegments(train, mode, mPerPx) {
    const total = train.measured.total;
    const center = train.distance;
    const bodyLen = mode === 'far'
        ? Math.max(FULL_LENGTH_M, MIN_APPARENT_PX_FAR * mPerPx)
        : FULL_LENGTH_M;

    const tail = clampDist(center - bodyLen / 2, total);
    const head = clampDist(center + bodyLen / 2, total);
    const usable = head - tail;
    if (usable <= 0) return [];

    if (mode === 'far') {
        return [sampleArc(train.measured, tail, head, SAMPLES_FAR)];
    }

    const totalUnits = CAR_COUNT * CAR_LENGTH_M + (CAR_COUNT - 1) * CAR_GAP_M;
    const segments = [];
    let cursor = tail;
    for (let c = 0; c < CAR_COUNT; c++) {
        const carSpan = (CAR_LENGTH_M / totalUnits) * usable;
        segments.push(sampleArc(train.measured, cursor, cursor + carSpan, SAMPLES_PER_CAR));
        cursor += carSpan;
        if (c < CAR_COUNT - 1) cursor += (CAR_GAP_M / totalUnits) * usable;
    }
    return segments;
}

export class TrainLayer {
    constructor(AMap, map) {
        this.AMap = AMap;
        this.map = map;
        this._hiddenLines = new Set();
        this._colorCache = new Map();
    }

    _currentMode() {
        return this.map.getZoom() >= SWITCH_ZOOM ? 'close' : 'far';
    }

    _rgb(hex) {
        let c = this._colorCache.get(hex);
        if (!c) { c = hexToRgb(hex); this._colorCache.set(hex, c); }
        return c;
    }

    /** Push every active train into the scene as 3D boxes (world coords). */
    build(scene, trains) {
        const map = this.map;
        const mode = this._currentMode();
        const mPerPx = metersPerPixel(map);
        const minPx = mode === 'close' ? MIN_WIDTH_PX : STROKE_FAR_PX;
        const halfWidthM = Math.max(CAR_WIDTH_M, minPx * mPerPx) / 2;
        const heightW = TRAIN_HEIGHT_M * scene.worldPerMeter;

        for (const t of trains) {
            if (this._hiddenLines.has(t.lineId)) continue;
            const c = this._rgb(t.color);
            const top = [c[0], c[1], c[2], 1];
            const side = [c[0] * SIDE_SHADE, c[1] * SIDE_SHADE, c[2] * SIDE_SHADE, 1];
            const cap = [c[0] * CAP_SHADE, c[1] * CAP_SHADE, c[2] * CAP_SHADE, 1];
            const segments = buildTrainSegments(t, mode, mPerPx);
            for (let i = 0; i < segments.length; i++) {
                this._box(scene, segments[i], halfWidthM, heightW, top, side, cap);
            }
        }
    }

    /**
     * Build one car: offset the centreline into ground rails (world), raise a
     * copy to the car height, and emit the top, side and end faces. Depth test
     * resolves occlusion, so faces can be emitted in any order.
     */
    _box(scene, centerline, halfWidthM, heightW, top, side, cap) {
        const n = centerline.length;
        if (n < 2) return;
        const GL = new Array(n), GR = new Array(n), TL = new Array(n), TR = new Array(n);
        for (let i = 0; i < n; i++) {
            const p = centerline[i];
            const a = centerline[Math.max(0, i - 1)];
            const b = centerline[Math.min(n - 1, i + 1)];
            const mLat = 111320;
            const mLng = 111320 * Math.cos(p[1] * Math.PI / 180);
            let dx = (b[0] - a[0]) * mLng, dy = (b[1] - a[1]) * mLat;
            const len = Math.hypot(dx, dy) || 1;
            dx /= len; dy /= len;
            const offLng = (-dy * halfWidthM) / mLng;
            const offLat = (dx * halfWidthM) / mLat;
            const l = scene.toWorld(p[0] + offLng, p[1] + offLat);
            const r = scene.toWorld(p[0] - offLng, p[1] - offLat);
            GL[i] = [l[0], l[1], 0]; GR[i] = [r[0], r[1], 0];
            TL[i] = [l[0], l[1], heightW]; TR[i] = [r[0], r[1], heightW];
        }
        for (let i = 0; i < n - 1; i++) {
            scene.solidQuad(GL[i], GL[i + 1], TL[i + 1], TL[i], side); // left wall
            scene.solidQuad(GR[i], TR[i], TR[i + 1], GR[i + 1], side); // right wall
            scene.solidQuad(TL[i], TL[i + 1], TR[i + 1], TR[i], top);  // roof
        }
        scene.solidQuad(GL[0], TL[0], TR[0], GR[0], cap);                       // front
        scene.solidQuad(GL[n - 1], GR[n - 1], TR[n - 1], TL[n - 1], cap);       // back
    }

    setLineVisibility(lineId, visible) {
        if (visible) this._hiddenLines.delete(lineId);
        else this._hiddenLines.add(lineId);
    }

    destroy() {}
}
