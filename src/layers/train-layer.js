/**
 * Animated train markers. We pool one AMap.CircleMarker per active train id;
 * recycling between frames keeps GC pressure low while AMap handles the
 * rendering. Markers older than one frame (no longer in the snapshot) are
 * removed.
 *
 * Each train is a coloured dot (line colour) with a white centre — small but
 * recognisable at city zoom.
 */

export class TrainLayer {
    constructor(AMap, map) {
        this.AMap = AMap;
        this.map = map;
        this.pool = new Map(); // trainId -> marker
    }

    update(trains) {
        const seen = new Set();
        for (const t of trains) {
            seen.add(t.id);
            let m = this.pool.get(t.id);
            if (!m) {
                m = new this.AMap.CircleMarker({
                    map: this.map,
                    center: t.coord,
                    radius: 5,
                    strokeColor: '#ffffff',
                    strokeWeight: 1.5,
                    strokeOpacity: 0.9,
                    fillColor: t.color,
                    fillOpacity: 1,
                    zIndex: 200,
                    bubble: true
                });
                this.pool.set(t.id, m);
            } else {
                m.setCenter(t.coord);
            }
        }
        // Reap.
        for (const [id, marker] of this.pool) {
            if (!seen.has(id)) {
                marker.setMap(null);
                this.pool.delete(id);
            }
        }
    }

    setLineVisibility(lineId, visible) {
        // Hide/show all trains belonging to a line by toggling their map.
        // Map keys encode lineId before the first "|" — keep this in sync with
        // LineSchedule which builds ids like `${line.id}|out|${k}`.
        for (const [id, marker] of this.pool) {
            if (id.startsWith(lineId + '|')) {
                if (visible && !marker.getMap()) marker.setMap(this.map);
                else if (!visible && marker.getMap()) marker.setMap(null);
            }
        }
    }

    destroy() {
        for (const m of this.pool.values()) m.setMap(null);
        this.pool.clear();
    }
}
