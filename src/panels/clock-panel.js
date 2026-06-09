/**
 * Top-right clock and speed control.
 * Shows the simulated wall-clock time (HH:MM:SS), a 1x/30x/600x speed picker,
 * and a pause toggle. All state lives in the Clock; this is a thin view.
 */

const SPEEDS = [
    {label: '1x', value: 1},
    {label: '30x', value: 30},
    {label: '120x', value: 120},
    {label: '600x', value: 600}
];

export class ClockPanel {
    constructor(container, clock) {
        this.clock = clock;
        this.el = document.createElement('div');
        this.el.className = 'm3d-clock-panel';
        this.el.innerHTML = `
            <div class="m3d-clock-time" data-time>--:--:--</div>
            <div class="m3d-clock-controls">
                <button data-pause title="暂停/继续">⏸</button>
                <select data-speed>
                    ${SPEEDS.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}
                </select>
                <button data-now title="回到现在">现在</button>
            </div>
        `;
        container.appendChild(this.el);

        this.timeEl = this.el.querySelector('[data-time]');
        this.pauseBtn = this.el.querySelector('[data-pause]');
        this.speedSel = this.el.querySelector('[data-speed]');
        this.nowBtn = this.el.querySelector('[data-now]');

        this.speedSel.value = String(clock.speed);
        this.pauseBtn.addEventListener('click', () => {
            if (clock.paused) clock.resume(); else clock.pause();
        });
        this.speedSel.addEventListener('change', () => {
            clock.setSpeed(Number(this.speedSel.value));
        });
        this.nowBtn.addEventListener('click', () => {
            clock.setTime(new Date());
        });
        clock.onChange(c => {
            this.pauseBtn.textContent = c.paused ? '▶' : '⏸';
        });
        this._tick();
    }

    _tick() {
        const d = this.clock.now();
        const pad = n => String(n).padStart(2, '0');
        this.timeEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        requestAnimationFrame(() => this._tick());
    }
}
