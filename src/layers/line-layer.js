/**
 * Renders one AMap.Polyline per metro line in its official color.
 * Highlighted lines render thicker and on a higher z-index.
 */

export class LineLayer {
    constructor(AMap, map) {
        this.AMap = AMap;
        this.map = map;
        this.polylines = new Map(); // lineId -> {polyline, line}
    }

    add(line, path) {
        const polyline = new this.AMap.Polyline({
            map: this.map,
            path,
            strokeColor: line.color,
            strokeOpacity: 0.95,
            strokeWeight: 4,
            lineJoin: 'round',
            lineCap: 'round',
            zIndex: 50,
            showDir: false
        });
        this.polylines.set(line.id, {polyline, line});
    }

    highlight(lineId) {
        for (const [id, {polyline}] of this.polylines) {
            if (id === lineId) {
                polyline.setOptions({strokeWeight: 7, strokeOpacity: 1, zIndex: 80});
            } else {
                polyline.setOptions({strokeWeight: 4, strokeOpacity: 0.35, zIndex: 50});
            }
        }
    }

    clearHighlight() {
        for (const {polyline} of this.polylines.values()) {
            polyline.setOptions({strokeWeight: 4, strokeOpacity: 0.95, zIndex: 50});
        }
    }

    destroy() {
        for (const {polyline} of this.polylines.values()) {
            polyline.setMap(null);
        }
        this.polylines.clear();
    }
}
