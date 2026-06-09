/**
 * Metro 3D public entry. UMD build attaches `m3d` to window.
 *
 * AMAP_KEY / AMAP_SECURITY_CODE are injected at build time from `.env`
 * (see rollup.config.mjs). They're empty strings when no key was configured.
 */

import './css/metro-3d.css';
import MetroMap from './map.js';
import Clock from './clock.js';
import {LINES, findLine, SHENZHEN_CENTER, DEFAULT_BOUNDS} from './data/lines.js';
import {clearCache} from './data/loader.js';

export const AMAP_KEY = __M3D_AMAP_KEY__;
export const AMAP_SECURITY_CODE = __M3D_AMAP_SECURITY_CODE__;

export {MetroMap, Clock, LINES, findLine, SHENZHEN_CENTER, DEFAULT_BOUNDS, clearCache};
export default MetroMap;
