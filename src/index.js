/**
 * Metro 3D public entry. UMD build attaches `m3d` to window.
 */

import './css/metro-3d.css';
import MetroMap from './map.js';
import Clock from './clock.js';
import {LINES, findLine, SHENZHEN_CENTER, DEFAULT_BOUNDS} from './data/lines.js';
import {clearCache} from './data/loader.js';

export {MetroMap, Clock, LINES, findLine, SHENZHEN_CENTER, DEFAULT_BOUNDS, clearCache};
export default MetroMap;
