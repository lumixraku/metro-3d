/**
 * Geo helpers — distance, cumulative length, point-along-path.
 * Inputs are [lng, lat]; outputs are [lng, lat] or meters.
 *
 * Haversine on a sphere is precise enough at city scale (<100 km extent)
 * and avoids pulling turf into the bundle.
 */

const R = 6378137;

function toRad(d) { return d * Math.PI / 180; }

export function distanceMeters(a, b) {
    const dLat = toRad(b[1] - a[1]);
    const dLon = toRad(b[0] - a[0]);
    const la1 = toRad(a[1]);
    const la2 = toRad(b[1]);
    const s = Math.sin(dLat / 2) ** 2 +
        Math.sin(dLon / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
    return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Annotate a path with cumulative length per vertex.
 * Returns {path, cum, total}.
 */
export function measurePath(path) {
    const cum = new Float64Array(path.length);
    let total = 0;
    for (let i = 1; i < path.length; i++) {
        total += distanceMeters(path[i - 1], path[i]);
        cum[i] = total;
    }
    return {path, cum, total};
}

/**
 * Find the [lng, lat] at a given distance (meters) along a measured path.
 */
export function pointAlong(measured, dist) {
    const {path, cum, total} = measured;
    if (dist <= 0) return path[0].slice();
    if (dist >= total) return path[path.length - 1].slice();
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= dist) lo = mid; else hi = mid;
    }
    const segLen = cum[hi] - cum[lo];
    const t = segLen === 0 ? 0 : (dist - cum[lo]) / segLen;
    const a = path[lo];
    const b = path[hi];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Compute the cumulative-distance value at each station by snapping it to the
 * nearest vertex on the measured path. We do nearest-vertex rather than
 * nearest-point-on-segment because AMap line `path` is dense enough that the
 * extra precision isn't worth the complexity.
 */
export function snapStationsToPath(measured, stations) {
    const {path, cum} = measured;
    return stations.map(st => {
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < path.length; i++) {
            const d = distanceMeters(path[i], st.coord);
            if (d < bestD) { bestD = d; best = i; }
        }
        return {...st, distance: cum[best]};
    }).sort((a, b) => a.distance - b.distance);
}
