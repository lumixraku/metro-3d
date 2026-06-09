/**
 * Resolves Shenzhen metro line geometries via AMap REST `/v3/bus/linename`.
 *
 * NOTE — key type:
 *   We deliberately call the REST endpoint directly (not via AMap JS API
 *   plugin) because the user's key is a "Web 服务" key. Routing through the
 *   JS plugin sends `platform=JS` which trips USERKEY_PLAT_NOMATCH (10009).
 *   AMap REST returns `Access-Control-Allow-Origin: *` so browser-side fetch
 *   works fine.
 *
 * Cache key:  m3d:line:v3:<line.id>
 * Cache TTL:  30 days (AMap line records rarely change)
 */

const CACHE_PREFIX = 'm3d:line:v3:';
const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;
const REST_ENDPOINT = 'https://restapi.amap.com/v3/bus/linename';
const REQUEST_TIMEOUT_MS = 8000;

function readCache(id) {
    try {
        const raw = localStorage.getItem(CACHE_PREFIX + id);
        if (!raw) return null;
        const entry = JSON.parse(raw);
        if (Date.now() - entry.ts > CACHE_TTL_MS) return null;
        return entry.data;
    } catch (_) { return null; }
}

function writeCache(id, data) {
    try {
        localStorage.setItem(CACHE_PREFIX + id, JSON.stringify({ts: Date.now(), data}));
    } catch (_) { /* quota or disabled */ }
}

function fetchJson(url) {
    return Promise.race([
        fetch(url).then(r => r.json()),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), REQUEST_TIMEOUT_MS))
    ]);
}

async function searchLine(restKey, query, city = '深圳') {
    const params = new URLSearchParams({
        key: restKey,
        keywords: query,
        city,
        extensions: 'all',
        output: 'JSON',
        offset: '5',
        page: '1'
    });
    const url = `${REST_ENDPOINT}?${params}`;
    const data = await fetchJson(url);
    if (data.status !== '1') {
        throw new Error(`${data.info || 'unknown'} (${data.infocode || '?'})`);
    }
    if (!data.buslines || !data.buslines.length) {
        throw new Error('no buslines returned');
    }
    return data.buslines;
}

function pickBestRecord(records, line) {
    // AMap returns both directions of the same line as separate records and may
    // also return short turnback variants. Pick the longest polyline among
    // those whose `name` actually contains "<id>号线".
    const tag = `${line.code}号线`;
    const candidates = records.filter(r => r.name && r.name.includes(tag));
    const pool = candidates.length ? candidates : records;
    return pool.slice().sort((a, b) => pathLen(b) - pathLen(a))[0];
}

function pathLen(rec) {
    if (!rec || !rec.polyline) return 0;
    return rec.polyline.length;
}

function parsePolyline(str) {
    // "lng1,lat1;lng2,lat2;..."  →  [[lng1,lat1], ...]
    if (!str) return [];
    return str.split(';').map(p => {
        const [a, b] = p.split(',');
        return [Number(a), Number(b)];
    }).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

function normaliseRecord(record, line) {
    const path = parsePolyline(record.polyline);
    const stops = record.busstops || [];
    const stations = stops.map((s, i) => {
        const loc = (s.location || '').split(',');
        return {
            id: `${line.id}:${i}`,
            name: s.name,
            coord: [Number(loc[0]), Number(loc[1])],
            lineId: line.id
        };
    }).filter(s => Number.isFinite(s.coord[0]) && Number.isFinite(s.coord[1]));

    return {
        lineId: line.id,
        amapName: record.name,
        path,
        stations
    };
}

/**
 * Load all lines via REST.
 * @param {string} restKey  AMap Web 服务 key
 * @param {Array}  lineDefs lines from data/lines.js
 * @param {Object} opts     {city, onProgress(done,total,label,ok)}
 */
// AMap Web 服务 free tier limits sustained QPS; pace ourselves to avoid 10021.
// Empirically 350ms between calls keeps us under the cap.
const REQUEST_GAP_MS = 350;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function loadOne(restKey, line, city) {
    let lastErr;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const records = await searchLine(restKey, line.query, city);
            const pick = pickBestRecord(records, line);
            if (!pick) throw new Error('no matching record');
            const geom = normaliseRecord(pick, line);
            if (geom.stations.length < 2 || geom.path.length < 2) {
                throw new Error('record missing geometry');
            }
            return geom;
        } catch (e) {
            lastErr = e;
            // Only retry on rate-limit errors; bad-key or no-data fail fast.
            if (!/CUQPS|10021|timeout/i.test(e.message || '')) break;
            if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
        }
    }
    throw lastErr;
}

export async function loadAllLines(restKey, lineDefs, {city = '深圳', onProgress} = {}) {
    const total = lineDefs.length;
    const results = [];
    let done = 0;
    const errors = [];

    for (let i = 0; i < lineDefs.length; i++) {
        const line = lineDefs[i];
        let geom = readCache(line.id);
        let err = null;
        if (!geom) {
            try {
                geom = await loadOne(restKey, line, city);
                writeCache(line.id, geom);
            } catch (e) {
                err = e.message || String(e);
                geom = null;
                errors.push({line: line.nameZh, err});
                console.warn(`[metro-3d] ${line.query}: ${err}`);
            }
            // Throttle even after a failure — failed responses still count against QPS.
            if (i < lineDefs.length - 1) await sleep(REQUEST_GAP_MS);
        }
        done += 1;
        onProgress?.(done, total, line.nameZh, !err);
        if (geom) results.push({line, geom});
    }

    return {results, errors};
}

export function clearCache() {
    try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
        }
        keys.forEach(k => localStorage.removeItem(k));
    } catch (_) { /* noop */ }
}
