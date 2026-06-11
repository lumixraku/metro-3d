/**
 * Operating-hour + headway simulation.
 *
 * For each line, when the sim clock is inside [firstTrain, lastTrain] we
 * derive a continuous schedule using the line's cruise speed and the
 * appropriate headway (peak vs off-peak). For sim time T past first-train,
 * an "outbound" train k departed at firstTrain + k*headway and a "return"
 * train k departed at firstTrain + 0.5*headway + k*headway (offset for visual
 * balance — terminals don't actually run inverted offsets, this is a
 * simplification for visualisation).
 *
 * Each train follows a realistic motion profile between stations: it
 * accelerates from rest at ACCEL_MS2, cruises at the line speed, decelerates
 * back to rest into the platform, then dwells DWELL_SECONDS. Short hops where
 * cruise can't be reached use a triangular accelerate-then-brake profile. The
 * two termini get no dwell (it's absorbed into the headway). When a train
 * reaches the far terminus it reverses immediately — the constant headway hides
 * the real turn-around, which is what riders perceive.
 *
 * Returns lightweight objects suitable for marker updates each frame.
 */

import {parseHHMM, minutesOfDay} from './clock.js';
import {measurePath, snapStationsToPath, pointAlong} from './utils/geo.js';

const DWELL_SECONDS = 30;
const ACCEL_MS2 = 1.0;          // comfortable metro service accel = decel (m/s²)
const MIN_GAP_M = 1;            // merge stations snapped closer than this

/**
 * Build a time→distance motion profile over an increasing list of stop
 * distances. Each inter-stop hop is a trapezoid (accel / cruise / decel) — or a
 * triangle if the hop is too short to reach `vCruise` — followed by a dwell at
 * every intermediate stop (not the final one). Returns {runtime, phases} where
 * each phase carries the closed-form distance(τ) for its time window.
 */
function buildProfile(stops, accel, vCruise) {
    const phases = [];
    const m = stops.length;
    const dAcc = (vCruise * vCruise) / (2 * accel); // distance to reach cruise
    let t = 0;
    for (let i = 0; i < m - 1; i++) {
        const s0 = stops[i];
        const L = stops[i + 1] - s0;
        if (L >= 2 * dAcc) {
            const tAcc = vCruise / accel;
            const dCruise = L - 2 * dAcc;
            const tCruise = dCruise / vCruise;
            const T = 2 * tAcc + tCruise;
            phases.push({t0: t, t1: t + T, kind: 'trap', s0, accel, v: vCruise, tAcc, dAcc, tCruise, dCruise});
            t += T;
        } else {
            // Triangular: peak speed vp = sqrt(accel·L), reached at the midpoint.
            const th = Math.sqrt(L / accel);
            const T = 2 * th;
            phases.push({t0: t, t1: t + T, kind: 'tri', s0, accel, th, dHalf: 0.5 * accel * th * th});
            t += T;
        }
        // Dwell on arrival at every intermediate stop, but not the terminus.
        if (i < m - 2) {
            phases.push({t0: t, t1: t + DWELL_SECONDS, kind: 'dwell', s0: stops[i + 1]});
            t += DWELL_SECONDS;
        }
    }
    return {runtime: t, phases};
}

/** Cumulative distance along the profile at time tSec (0 ≤ tSec < runtime). */
function distAt(profile, tSec) {
    const phases = profile.phases;
    // Binary search for the phase whose [t0, t1) contains tSec.
    let lo = 0, hi = phases.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tSec < phases[mid].t1) hi = mid; else lo = mid + 1;
    }
    const p = phases[lo];
    const tau = tSec - p.t0;
    if (p.kind === 'dwell') return p.s0;
    if (p.kind === 'tri') {
        if (tau < p.th) return p.s0 + 0.5 * p.accel * tau * tau;
        const t2 = tau - p.th;
        const vp = p.accel * p.th;
        return p.s0 + p.dHalf + vp * t2 - 0.5 * p.accel * t2 * t2;
    }
    // trapezoid
    if (tau < p.tAcc) return p.s0 + 0.5 * p.accel * tau * tau;
    if (tau < p.tAcc + p.tCruise) return p.s0 + p.dAcc + p.v * (tau - p.tAcc);
    const t3 = tau - p.tAcc - p.tCruise;
    return p.s0 + p.dAcc + p.dCruise + p.v * t3 - 0.5 * p.accel * t3 * t3;
}

export class LineSchedule {
    /**
     * @param {Object} line     entry from data/lines.js
     * @param {Object} geom     {path, stations} from data loader
     */
    constructor(line, geom) {
        this.line = line;
        this.measured = measurePath(geom.path);
        this.stations = snapStationsToPath(this.measured, geom.stations);

        // Stop distances anchored to the drawn path: termini pinned to [0, total],
        // intermediate stations deduped so coincident snaps don't double-dwell.
        const total = this.measured.total;
        const stops = [];
        for (const st of this.stations) {
            const d = Math.min(total, Math.max(0, st.distance));
            if (stops.length === 0 || d - stops[stops.length - 1] > MIN_GAP_M) stops.push(d);
        }
        if (stops.length < 2) { stops.length = 0; stops.push(0, total); }
        else { stops[0] = 0; stops[stops.length - 1] = total; }

        // Two motion profiles: outbound walks the stops as-is; the return train
        // walks the same line mirrored (distances total−s, reversed to ascending),
        // so it dwells at the same physical stations in reverse order.
        const vCruise = (line.cruiseKmh * 1000) / 3600;
        this.outProfile = buildProfile(stops, ACCEL_MS2, vCruise);
        const retStops = stops.map(s => total - s).reverse();
        this.retProfile = buildProfile(retStops, ACCEL_MS2, vCruise);
        this.runtimeSec = this.outProfile.runtime; // identical for both directions

        this.firstMin = parseHHMM(line.firstTrain);
        this.lastMin = parseHHMM(line.lastTrain);
        this.peakWindowsMin = (line.peakWindows || []).map(w => [parseHHMM(w.start), parseHHMM(w.end)]);
    }

    isPeak(minOfDay) {
        return this.peakWindowsMin.some(([s, e]) => minOfDay >= s && minOfDay <= e);
    }

    headwaySec(minOfDay) {
        return (this.isPeak(minOfDay) ? this.line.peakHeadway : this.line.headway) * 60;
    }

    /**
     * Position state of a virtual train along the measured path at sim time t
     * (seconds since the train's own dispatch). `direction` is +1 (toward end)
     * or -1 (toward start, departing from far terminus).
     *
     * Returns {coord, distance} where `distance` is cumulative metres along
     * the path (independent of direction), or null if t is outside [0, runtime).
     */
    _stateAt(tSec, direction) {
        if (tSec < 0 || tSec >= this.runtimeSec) return null;
        const distance = direction > 0
            ? distAt(this.outProfile, tSec)
            : this.measured.total - distAt(this.retProfile, tSec);
        return {coord: pointAlong(this.measured, distance), distance};
    }

    /**
     * Compute all active trains for the given simulated Date.
     * @returns Array<{id, lineId, color, coord, direction, progress}>
     */
    trainsAt(simDate) {
        const minOfDay = minutesOfDay(simDate);
        if (minOfDay < this.firstMin || minOfDay > this.lastMin) return [];

        const out = [];
        const headway = this.headwaySec(minOfDay);
        const sinceFirstSec = (minOfDay - this.firstMin) * 60;
        const runtime = this.runtimeSec;

        // Outbound trains dispatched at 0, h, 2h, ...
        // We only need trains whose run window [k*h, k*h + runtime] covers now.
        const earliestK = Math.floor((sinceFirstSec - runtime) / headway);
        const latestK   = Math.floor(sinceFirstSec / headway);
        for (let k = Math.max(0, earliestK); k <= latestK; k++) {
            const t = sinceFirstSec - k * headway;
            const state = this._stateAt(t, +1);
            if (state) {
                out.push({
                    id: `${this.line.id}|out|${k}`,
                    lineId: this.line.id,
                    color: this.line.color,
                    coord: state.coord,
                    distance: state.distance,
                    measured: this.measured,
                    direction: +1,
                    progress: t / runtime
                });
            }
        }

        // Return trains: offset by half a headway
        const offset = headway / 2;
        const sinceRetSec = sinceFirstSec - offset;
        if (sinceRetSec >= 0) {
            const ek = Math.floor((sinceRetSec - runtime) / headway);
            const lk = Math.floor(sinceRetSec / headway);
            for (let k = Math.max(0, ek); k <= lk; k++) {
                const t = sinceRetSec - k * headway;
                const state = this._stateAt(t, -1);
                if (state) {
                    out.push({
                        id: `${this.line.id}|ret|${k}`,
                        lineId: this.line.id,
                        color: this.line.color,
                        coord: state.coord,
                        distance: state.distance,
                        measured: this.measured,
                        direction: -1,
                        progress: 1 - t / runtime
                    });
                }
            }
        }
        return out;
    }
}

export class Simulation {
    constructor(lineGeoms /* Array<{line, geom}> */) {
        this.schedules = lineGeoms.map(({line, geom}) => new LineSchedule(line, geom));
    }

    /** Flat array of all active trains across all lines. */
    snapshot(simDate) {
        const all = [];
        for (const sch of this.schedules) {
            const t = sch.trainsAt(simDate);
            for (let i = 0; i < t.length; i++) all.push(t[i]);
        }
        return all;
    }
}
