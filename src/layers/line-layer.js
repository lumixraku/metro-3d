/**
 * Renders one stroke per metro line in its official colour, drawn onto the
 * self-managed WebGL overlay (not AMap.Polyline) so it shares the same crisp
 * 60fps repaint loop as the trains. Highlighted lines render thicker and
 * fully opaque; the rest dim.
 */

import {hexToRgb} from './gl-overlay.js';

const NORMAL_WIDTH = 4;
const HILITE_WIDTH = 7;
const NORMAL_OPACITY = 0.95;
const DIM_OPACITY = 0.35;

export class LineLayer {
    constructor(AMap, map) {
        this.AMap = AMap;
        this.map = map;
        this.lines = new Map();      // lineId -> {line, path, rgb}
        this._hidden = new Set();
        this._highlightId = null;
    }

    add(line, path) {
        this.lines.set(line.id, {line, path, rgb: hexToRgb(line.color)});
    }

    highlight(lineId) {
        this._highlightId = lineId;
    }

    clearHighlight() {
        this._highlightId = null;
    }

    setVisible(lineId, visible) {
        if (visible) this._hidden.delete(lineId);
        else this._hidden.add(lineId);
    }

    /**
     * Project a [lng,lat] path to screen-pixel [x,y] points. Points outside the
     * current view bounds (where 3D behind-camera points project to garbage
     * coordinates) become null so the overlay breaks the line there instead of
     * drawing it shooting off into the sky.
     */
    _project(path, bounds) {
        const map = this.map;
        const AMap = this.AMap;
        const out = new Array(path.length);
        for (let i = 0; i < path.length; i++) {
            const ll = new AMap.LngLat(path[i][0], path[i][1]);
            if (!bounds.contains(ll)) { out[i] = null; continue; }
            const p = map.lngLatToContainer(ll);
            out[i] = [p.x, p.y];
        }
        return out;
    }

    /** Draw all visible lines onto the overlay. Called each animation frame. */
    draw(overlay) {
        const hi = this._highlightId;
        const bounds = this.map.getBounds();
        for (const [id, {path, rgb}] of this.lines) {
            if (this._hidden.has(id)) continue;
            let width, opacity;
            if (!hi) {
                width = NORMAL_WIDTH; opacity = NORMAL_OPACITY;
            } else if (id === hi) {
                width = HILITE_WIDTH; opacity = 1;
            } else {
                width = NORMAL_WIDTH; opacity = DIM_OPACITY;
            }
            overlay.addLine(this._project(path, bounds), width, [rgb[0], rgb[1], rgb[2], opacity]);
        }
    }

    destroy() {
        this.lines.clear();
    }
}
