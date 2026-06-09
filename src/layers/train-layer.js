/**
 * Train rendering. Each train is drawn as one or more thick AMap.Polyline
 * segments that follow the actual track curve at the train's current position
 * — same visual idea as mini-tokyo-3d's box meshes, but using AMap primitives
 * so we don't need a Three.js overlay.
 *
 * Two zoom modes:
 *   Far  (zoom < SWITCH_ZOOM)  — single elongated strip; length scales with
 *                                pixels-per-metre so trains stay visible at
 *                                city overview.
 *   Close (zoom >= SWITCH_ZOOM) — six car-shaped strips with a small gap
 *                                between them, modelling a 6-car consist.
 *
 * Implementation:
 *   • simulation passes us `distance` (cumulative metres along the line) and
 *     the line's `measured` path, so we can sample real points along the
 *     curve between the train's tail and head positions.
 *   • Each polyline is built from several sampled points so it visibly curves
 *     through bends rather than cutting them as a straight chord.
 *   • Polylines are pooled per train id; mode changes nuke the pool.
 */

import {pointAlong} from '../utils/geo.js';

const CAR_COUNT = 6;
const CAR_LENGTH_M = 18;
const CAR_GAP_M = 2;
const FULL_LENGTH_M = CAR_COUNT * CAR_LENGTH_M + (CAR_COUNT - 1) * CAR_GAP_M; // 118m
const SWITCH_ZOOM = 14.5;
const SAMPLES_PER_CAR = 2;       // points sampled inside each car strip
const SAMPLES_FAR = 5;           // points sampled along the far-mode strip
const MIN_APPARENT_PX_FAR = 14;  // far-mode strip targets ~this many pixels long
const STROKE_FAR = 6;
const STROKE_CLOSE = 8;
const OUTLINE_COLOR = '#ffffff'; // white outline so trains read as separate
const OUTLINE_WEIGHT = 1.2;      // bodies floating above the same-coloured track

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
        this.pool = new Map();      // trainId -> Array<AMap.Polyline>
        this._lastMode = this._currentMode();
        this._hiddenLines = new Set();

        // When the zoom crosses the threshold, scrap the pool so the next
        // update() rebuilds polylines from scratch with the new segment count.
        const onZoom = () => {
            const mode = this._currentMode();
            if (mode !== this._lastMode) {
                this._reset();
                this._lastMode = mode;
            }
        };
        this._zoomHandler = onZoom;
        map.on('zoomend', onZoom);
        map.on('zoomchange', onZoom);
    }

    _currentMode() {
        return this.map.getZoom() >= SWITCH_ZOOM ? 'close' : 'far';
    }

    _reset() {
        for (const arr of this.pool.values()) {
            for (const p of arr) p.setMap(null);
        }
        this.pool.clear();
    }

    update(trains) {
        const mode = this._currentMode();
        this._lastMode = mode;
        const mPerPx = metersPerPixel(this.map);
        const strokeWeight = mode === 'close' ? STROKE_CLOSE : STROKE_FAR;
        const seen = new Set();

        for (const t of trains) {
            if (this._hiddenLines.has(t.lineId)) continue;
            seen.add(t.id);
            const segments = buildTrainSegments(t, mode, mPerPx);
            if (!segments.length) continue;

            let arr = this.pool.get(t.id);
            if (!arr) {
                arr = [];
                this.pool.set(t.id, arr);
            }

            for (let i = 0; i < segments.length; i++) {
                if (arr[i]) {
                    arr[i].setPath(segments[i]);
                } else {
                    arr[i] = new this.AMap.Polyline({
                        map: this.map,
                        path: segments[i],
                        strokeColor: t.color,
                        strokeOpacity: 1,
                        strokeWeight,
                        isOutline: true,
                        outlineColor: OUTLINE_COLOR,
                        borderWeight: OUTLINE_WEIGHT,
                        lineCap: 'round',
                        lineJoin: 'round',
                        zIndex: 200,
                        bubble: true
                    });
                }
            }
            while (arr.length > segments.length) {
                arr.pop().setMap(null);
            }
        }

        // Reap polylines for trains no longer in the snapshot.
        for (const [id, arr] of this.pool) {
            if (!seen.has(id)) {
                for (const p of arr) p.setMap(null);
                this.pool.delete(id);
            }
        }
    }

    setLineVisibility(lineId, visible) {
        if (visible) this._hiddenLines.delete(lineId);
        else this._hiddenLines.add(lineId);
        // Hide existing polylines for this line immediately; next update()
        // will skip producing new ones while hidden.
        const prefix = lineId + '|';
        for (const [id, arr] of this.pool) {
            if (!id.startsWith(prefix)) continue;
            for (const p of arr) {
                if (visible && !p.getMap()) p.setMap(this.map);
                else if (!visible && p.getMap()) p.setMap(null);
            }
        }
    }

    destroy() {
        this.map.off('zoomend', this._zoomHandler);
        this.map.off('zoomchange', this._zoomHandler);
        this._reset();
    }
}
