/**
 * Renders station markers — small white circles with a coloured ring per line.
 * Hovering a station shows a popup with its name and the lines that serve it.
 *
 * Stations that share coordinates (transfers) are merged into a single marker
 * that lists every line that passes through.
 */

const STATION_MERGE_RADIUS_M = 80; // stations within 80m collapse to one transfer point

function dist2(a, b) {
    const dx = (a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180);
    const dy = (a[1] - b[1]) * 110540;
    return dx * dx + dy * dy;
}

export class StationLayer {
    constructor(AMap, map) {
        this.AMap = AMap;
        this.map = map;
        this.markers = [];
        this.infoWindow = new AMap.InfoWindow({
            isCustom: true,
            offset: new AMap.Pixel(0, -16),
            anchor: 'bottom-center',
            content: ''
        });
    }

    /** stationsByLine: Array<{line, stations: Array<{name, coord, lineId}>}> */
    rebuild(stationsByLine) {
        this.destroy();
        const merged = mergeStations(stationsByLine);
        for (const m of merged) {
            const transfer = m.lines.size > 1;
            const ringColor = transfer ? '#1a1a1a' : m.color;
            const marker = new this.AMap.CircleMarker({
                map: this.map,
                center: m.coord,
                radius: transfer ? 6 : 4,
                strokeColor: ringColor,
                strokeWeight: transfer ? 2.5 : 2,
                strokeOpacity: 1,
                fillColor: '#ffffff',
                fillOpacity: 1,
                zIndex: 90,
                cursor: 'pointer'
            });
            marker.on('mouseover', () => this._showInfo(m));
            marker.on('mouseout', () => this.infoWindow.close());
            this.markers.push(marker);
        }
    }

    _showInfo(m) {
        const lineChips = [...m.lines].map(l =>
            `<span style="display:inline-block;background:${l.color};color:${l.textColor || '#fff'};
            padding:1px 6px;border-radius:8px;font-size:11px;margin-right:4px;">${l.code}</span>`
        ).join('');
        this.infoWindow.setContent(
            `<div class="m3d-station-popup">
                <div class="m3d-station-name">${m.name}</div>
                <div class="m3d-station-lines">${lineChips}</div>
            </div>`
        );
        this.infoWindow.open(this.map, m.coord);
    }

    destroy() {
        for (const mk of this.markers) mk.setMap(null);
        this.markers = [];
    }
}

function mergeStations(stationsByLine) {
    const groups = []; // {name, coord, lines:Set, color}
    const threshold = STATION_MERGE_RADIUS_M * STATION_MERGE_RADIUS_M;
    for (const {line, stations} of stationsByLine) {
        for (const st of stations) {
            // Same name OR within radius merges. Same name dominates because
            // AMap occasionally drifts coordinates of identical transfers by
            // ~100m between line records.
            let hit = groups.find(g => g.name === st.name);
            if (!hit) {
                hit = groups.find(g => dist2(g.coord, st.coord) < threshold);
            }
            if (hit) {
                hit.lines.add(line);
            } else {
                groups.push({
                    name: st.name,
                    coord: st.coord,
                    color: line.color,
                    lines: new Set([line])
                });
            }
        }
    }
    return groups;
}
