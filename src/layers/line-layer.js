/**
 * One stroke per metro line in its official colour, fed to the 3D scene as
 * constant-pixel-width lines lying just above the ground. The GPU's near-plane
 * clipping handles behind-camera points, so there is no per-vertex culling or
 * segment clipping here any more — just emit the path.
 */

import {hexToRgb} from './gl-scene.js';

const NORMAL_WIDTH = 8;
const HILITE_WIDTH = 12;
const NORMAL_OPACITY = 0.95;
const DIM_OPACITY = 0.35;
const LIFT_M = 1; // metres above ground so lines don't z-fight the base map

export class LineLayer {
    constructor(AMap, map) {
        this.AMap = AMap;
        this.map = map;
        this.lines = new Map(); // lineId -> {line, path, rgb}
        this._hidden = new Set();
        this._highlightId = null;
        // Line geometry is static in world space, so it's cached in the scene and
        // only rebuilt when one of its inputs changes (set/visibility/dpr).
        this._dirty = true;
        this._builtDpr = 0;
    }

    add(line, path) {
        this.lines.set(line.id, {line, path, rgb: hexToRgb(line.color)});
        this._dirty = true;
    }

    highlight(lineId) { this._highlightId = lineId; this._dirty = true; }
    clearHighlight() { this._highlightId = null; this._dirty = true; }

    setVisible(lineId, visible) {
        if (visible) this._hidden.delete(lineId);
        else this._hidden.add(lineId);
        this._dirty = true;
    }

    /** Rebuild the scene's cached line geometry, but only when it changed. World
     *  coords are stable across frames (the camera lives in the MVP), so on an
     *  unchanged frame this is a no-op. */
    build(scene) {
        if (!this._dirty && this._builtDpr === scene.dpr) return;
        scene.rebuildLines(() => {
            const hi = this._highlightId;
            const z = LIFT_M * scene.worldPerMeter;
            for (const [id, {path, rgb}] of this.lines) {
                if (this._hidden.has(id)) continue;
                let width, opacity;
                if (!hi) { width = NORMAL_WIDTH; opacity = NORMAL_OPACITY; }
                else if (id === hi) { width = HILITE_WIDTH; opacity = 1; }
                else { width = NORMAL_WIDTH; opacity = DIM_OPACITY; }
                const rgba = [rgb[0], rgb[1], rgb[2], opacity];

                const world = new Array(path.length);
                for (let i = 0; i < path.length; i++) {
                    const w = scene.toWorld(path[i][0], path[i][1]);
                    world[i] = [w[0], w[1], z];
                }
                scene.addPolyline(world, width, rgba);
            }
        });
        this._dirty = false;
        this._builtDpr = scene.dpr;
    }

    destroy() {
        this.lines.clear();
    }
}
