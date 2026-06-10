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
    mapStyle: 'amap://styles/light',
    showHint: true
};
