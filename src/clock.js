/**
 * Accelerated simulation clock.
 *
 * Wall-clock time can be scaled (1x, 60x, etc.) and paused. All other modules
 * read simulated time from clock.now(); never from Date.now() directly.
 */

export default class Clock {
    constructor({speed = 1, startAt = Date.now()} = {}) {
        this._speed = speed;
        this._paused = false;
        this._lastReal = Date.now();
        this._simTime = startAt;
        this._listeners = new Set();
    }

    /** Current simulated wall-clock as a Date. */
    now() {
        if (!this._paused) {
            const realNow = Date.now();
            this._simTime += (realNow - this._lastReal) * this._speed;
            this._lastReal = realNow;
        }
        return new Date(this._simTime);
    }

    setSpeed(s) {
        this.now(); // flush accumulated drift
        this._speed = s;
        this._emit();
    }

    setTime(date) {
        this._simTime = (date instanceof Date ? date.getTime() : date);
        this._lastReal = Date.now();
        this._emit();
    }

    pause() {
        this.now();
        this._paused = true;
        this._emit();
    }

    resume() {
        this._lastReal = Date.now();
        this._paused = false;
        this._emit();
    }

    get speed() { return this._speed; }
    get paused() { return this._paused; }

    onChange(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    _emit() {
        for (const fn of this._listeners) fn(this);
    }
}

/**
 * Parse "HH:MM" to minutes-of-day. Values past 24:00 (e.g. "25:30") are
 * handled by callers — Shenzhen Metro doesn't currently run past midnight on
 * normal days, but the parser is permissive in case schedules change.
 */
export function parseHHMM(s) {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
}

/** Minute-of-day at the local Asia/Shanghai timezone for the given Date. */
export function minutesOfDay(date) {
    // We assume the browser/runtime is in CST or the user accepts local time.
    // Include milliseconds so train positions advance continuously every frame
    // rather than stepping once per whole second (the "second hand" stutter).
    const local = new Date(date.getTime());
    return local.getHours() * 60 + local.getMinutes() +
        (local.getSeconds() + local.getMilliseconds() / 1000) / 60;
}
