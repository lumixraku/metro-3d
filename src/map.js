/**
 * MetroMap — public class that boots the entire app.
 *
 *   const map = new m3d.MetroMap({
 *       container: 'map',
 *       amapKey: 'XXXX',
 *       center: [114.0579, 22.5431],
 *   });
 *
 * Responsibilities:
 *   1. Load the AMap JS API (caller can pre-load it, we detect window.AMap)
 *   2. Create the 3D map instance with dark style
 *   3. Fetch all line geometries (via data/loader)
 *   4. Build the Simulation
 *   5. Wire up layers, panels, camera controls
 *   6. Run the render loop
 */

import {DEFAULTS} from './configs.js';
import {LINES} from './data/lines.js';
import {loadAllLines} from './data/loader.js';
import Clock from './clock.js';
import {Simulation} from './simulation.js';
import {GLOverlay} from './layers/gl-overlay.js';
import {LineLayer} from './layers/line-layer.js';
import {StationLayer} from './layers/station-layer.js';
import {TrainLayer} from './layers/train-layer.js';
import {LinePanel} from './panels/line-panel.js';
import {ClockPanel} from './panels/clock-panel.js';
import {LoadingPanel} from './panels/loading-panel.js';
import {CameraController} from './camera.js';

export default class MetroMap {
    constructor(opts = {}) {
        this.options = {...DEFAULTS, ...opts};
        if (!this.options.amapKey) throw new Error('[metro-3d] amapKey is required');

        this.container = typeof this.options.container === 'string'
            ? document.getElementById(this.options.container)
            : this.options.container;
        if (!this.container) throw new Error('[metro-3d] container not found');

        this.container.classList.add('m3d-root');
        this._mapEl = document.createElement('div');
        this._mapEl.className = 'm3d-map';
        this.container.appendChild(this._mapEl);

        this.loadingPanel = new LoadingPanel(this.container);

        this._boot().catch(err => {
            console.error('[metro-3d] boot failed:', err);
            this.loadingPanel.fail(err.message || String(err));
        });
    }

    async _boot() {
        const AMap = await ensureAMap(this.options.amapKey, this.options.amapVersion, this.options.amapSecurityJsCode);
        this.AMap = AMap;

        this.loadingPanel.update(0, LINES.length, '正在创建 3D 地图…');

        this.map = new AMap.Map(this._mapEl, {
            viewMode: '3D',
            center: this.options.center,
            zoom: this.options.zoom,
            pitch: this.options.pitch,
            rotation: this.options.rotation,
            mapStyle: this.options.mapStyle,
            pitchEnable: true,
            rotateEnable: true,
            showLabel: true,
            buildingAnimation: false,
            features: ['bg', 'road', 'building', 'point'],
            jogEnable: false,
            doubleClickZoom: true
        });

        // AMap default: right-mouse drag pitches/rotates; we keep that and add
        // cmd/shift-drag on top.
        this.camera = new CameraController(this.map, this._mapEl);

        const {results: lineGeoms, errors} = await loadAllLines(this.options.amapKey, LINES, {
            onProgress: (done, total, label) => {
                this.loadingPanel.update(done, total, label);
            }
        });

        if (!lineGeoms.length) {
            const sample = errors.slice(0, 3).map(e => `${e.line}: ${e.err}`).join('; ');
            throw new Error(`AMap 未返回任何线路数据 (${sample})`);
        }
        if (errors.length) {
            console.warn(`[metro-3d] ${errors.length}/${LINES.length} lines failed to load`, errors);
        }

        this.simulation = new Simulation(lineGeoms);

        // Lines and trains draw onto our own WebGL canvas (overlaying AMap) so
        // they repaint every animation frame; AMap.Polyline would throttle them.
        this.overlay = new GLOverlay(this._mapEl);
        this.lineLayer = new LineLayer(AMap, this.map);
        this.stationLayer = new StationLayer(AMap, this.map);
        this.trainLayer = new TrainLayer(AMap, this.map);

        for (const {line, geom} of lineGeoms) {
            this.lineLayer.add(line, geom.path);
        }
        this.stationLayer.rebuild(lineGeoms.map(({line, geom}) => ({line, stations: geom.stations})));

        // Real wall-clock time. The simulation always runs at 1x.
        this.clock = new Clock({startAt: Date.now()});

        // Side panels.
        this.linePanel = new LinePanel(this.container, LINES.filter(l => lineGeoms.some(lg => lg.line.id === l.id)), {
            onHighlight: id => {
                if (id) this.lineLayer.highlight(id);
                else this.lineLayer.clearHighlight();
            },
            onToggleVisible: (id, visible) => {
                this.lineLayer.setVisible(id, visible);
                this.trainLayer.setLineVisibility(id, visible);
            }
        });
        this.clockPanel = new ClockPanel(this.container, this.clock);

        if (this.options.showHint) this._addHint();

        this.loadingPanel.done();
        this._startLoop();
    }

    _addHint() {
        const hint = document.createElement('div');
        hint.className = 'm3d-hint';
        hint.innerHTML = '<kbd>⌘</kbd>+拖动 调整俯仰 &nbsp;·&nbsp; <kbd>⇧</kbd>+拖动 旋转视角 &nbsp;·&nbsp; 滚轮 缩放';
        this.container.appendChild(hint);
    }

    _startLoop() {
        // Every animation frame (~16ms at 60Hz) we recompute train positions
        // from the real-time clock, project all geometry to screen pixels, and
        // repaint the overlay ourselves — bypassing AMap's throttled redraw.
        const tick = () => {
            const now = this.clock.now();
            const trains = this.simulation.snapshot(now);
            this.overlay.begin();
            this.lineLayer.draw(this.overlay);
            this.trainLayer.draw(this.overlay, trains);
            this.overlay.flush();
            this._raf = requestAnimationFrame(tick);
        };
        tick();
    }

    destroy() {
        if (this._raf) cancelAnimationFrame(this._raf);
        this.camera?.destroy();
        this.trainLayer?.destroy();
        this.stationLayer?.destroy();
        this.lineLayer?.destroy();
        this.overlay?.destroy();
        this.map?.destroy();
    }
}

/**
 * Load AMap JS API on demand. If it's already on window (loaded via <script>),
 * we use it directly. Otherwise we inject the loader script.
 */
function ensureAMap(key, version, securityJsCode) {
    if (window.AMap) return Promise.resolve(window.AMap);
    if (securityJsCode) {
        window._AMapSecurityConfig = {securityJsCode};
    }
    return new Promise((resolve, reject) => {
        const cb = `__amap_cb_${Math.random().toString(36).slice(2)}`;
        window[cb] = () => {
            delete window[cb];
            if (window.AMap) resolve(window.AMap);
            else reject(new Error('AMap loaded but global missing'));
        };
        const s = document.createElement('script');
        s.src = `https://webapi.amap.com/maps?v=${version}&key=${key}&callback=${cb}`;
        s.onerror = () => reject(new Error('AMap script failed to load'));
        document.head.appendChild(s);
    });
}
