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
 * Each train cruises end-to-end with a 30s dwell at each station. When it
 * reaches the far terminus it reverses direction immediately (a real train
 * has a longer turn-around, but we hide that by spawning the next train at
 * a constant headway, which is what riders perceive).
 *
 * Returns lightweight objects suitable for marker updates each frame.
 */

import {parseHHMM, minutesOfDay} from './clock.js';
import {measurePath, snapStationsToPath, pointAlong} from './utils/geo.js';

const DWELL_SECONDS = 30;

export class LineSchedule {
    /**
     * @param {Object} line     entry from data/lines.js
     * @param {Object} geom     {path, stations} from data loader
     */
    constructor(line, geom) {
        this.line = line;
        this.measured = measurePath(geom.path);
        this.stations = snapStationsToPath(this.measured, geom.stations);

        // End-to-end run time (seconds): total distance / cruise speed + dwell at
        // each intermediate station. Terminal dwells are absorbed into headway.
        const cruiseMs = (line.cruiseKmh * 1000) / 3600;
        const cruiseSec = this.measured.total / cruiseMs;
        const intermediateDwells = Math.max(0, this.stations.length - 2) * DWELL_SECONDS;
        this.runtimeSec = cruiseSec + intermediateDwells;

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
     * Position of a single virtual train along the measured path at sim time t
     * (seconds since the train's own dispatch). `direction` is +1 (toward end)
     * or -1 (toward start, departing from far terminus).
     *
     * Returns [lng, lat] or null if t is outside [0, runtime).
     */
    _positionAt(tSec, direction) {
        if (tSec < 0 || tSec >= this.runtimeSec) return null;
        const progress = tSec / this.runtimeSec;
        const dist = direction > 0
            ? progress * this.measured.total
            : (1 - progress) * this.measured.total;
        return pointAlong(this.measured, dist);
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
            const coord = this._positionAt(t, +1);
            if (coord) {
                out.push({
                    id: `${this.line.id}|out|${k}`,
                    lineId: this.line.id,
                    color: this.line.color,
                    coord,
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
                const coord = this._positionAt(t, -1);
                if (coord) {
                    out.push({
                        id: `${this.line.id}|ret|${k}`,
                        lineId: this.line.id,
                        color: this.line.color,
                        coord,
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
