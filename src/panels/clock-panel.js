/**
 * Top-right clock. Shows the real wall-clock time (HH:MM:SS). The simulation
 * always runs at real time — there is intentionally no speed or pause control.
 */

export class ClockPanel {
    constructor(container, clock) {
        this.clock = clock;
        this.el = document.createElement('div');
        this.el.className = 'm3d-clock-panel';
        this.el.innerHTML = `<div class="m3d-clock-time" data-time>--:--:--</div>`;
        container.appendChild(this.el);

        this.timeEl = this.el.querySelector('[data-time]');
        this._tick();
    }

    _tick() {
        const d = this.clock.now();
        const pad = n => String(n).padStart(2, '0');
        this.timeEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        requestAnimationFrame(() => this._tick());
    }
}
