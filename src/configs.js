/**
 * Tunable constants. Values that don't belong to a single line definition
 * live here so they can be overridden by callers via `new MetroMap({...})`.
 */

export const DEFAULTS = {
    container: 'map',
    amapKey: null,
    amapVersion: '2.0',
    amapSecurityJsCode: null,    // optional; only required if AMap account enforces it
    center: [114.0579, 22.5431], // 深圳市中心
    zoom: 12,
    pitch: 55,
    rotation: 0,
    mapStyle: 'amap://styles/dark',
    speed: 1,                    // 1 = wall-clock time. Trains run iff the line is actually operating now.
    frameMs: 200,                // how often to refresh train positions; 200ms ≈ smooth at 60-300x speed
    showHint: true
};

// Frame budget for sim ticks. Faster speeds need more frequent ticks to avoid
// trains visibly teleporting between updates.
export function tickInterval(speed) {
    if (speed >= 600) return 33;  // ~30fps
    if (speed >= 120) return 80;
    if (speed >= 30)  return 150;
    return 250;
}
