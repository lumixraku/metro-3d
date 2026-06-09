/**
 * Centred loading overlay shown while we fetch line geometries from AMap.
 * Removed once `done()` is called.
 */

export class LoadingPanel {
    constructor(container) {
        this.el = document.createElement('div');
        this.el.className = 'm3d-loading';
        this.el.innerHTML = `
            <div class="m3d-loading-card">
                <div class="m3d-loading-title">深圳地铁 3D · 正在加载</div>
                <div class="m3d-loading-status">初始化地图…</div>
                <div class="m3d-loading-bar"><div class="m3d-loading-fill"></div></div>
            </div>
        `;
        container.appendChild(this.el);
        this._status = this.el.querySelector('.m3d-loading-status');
        this._fill = this.el.querySelector('.m3d-loading-fill');
    }

    update(done, total, label) {
        const pct = total ? Math.round((done / total) * 100) : 0;
        this._fill.style.width = pct + '%';
        this._status.textContent = `(${done}/${total}) ${label || ''}`;
    }

    done() {
        this.el.classList.add('is-gone');
        setTimeout(() => this.el.remove(), 400);
    }

    fail(msg) {
        this._status.textContent = '加载失败: ' + msg;
        this._fill.style.background = '#DE0011';
    }
}
