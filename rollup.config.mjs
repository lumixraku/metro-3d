import {readFileSync, existsSync} from 'node:fs';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import postcss from 'rollup-plugin-postcss';

const banner = `/*!
 * Metro 3D v0.1.0
 * A real-time 3D digital map of Shenzhen Metro.
 * Inspired by mini-tokyo-3d (Akihiko Kusanagi, MIT).
 */`;

/**
 * Minimal .env loader. Lines are `KEY=value`; lines starting with `#` and
 * blank lines are skipped. No quoting/escaping support — values are taken
 * literally. We keep this in-repo to avoid pulling in `dotenv`.
 */
function loadEnv(path) {
    if (!existsSync(path)) return {};
    const out = {};
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    return out;
}

const env = {...loadEnv('.env'), ...process.env};
const AMAP_KEY = env.M3D_AMAP_KEY || '';
const AMAP_SECURITY_CODE = env.M3D_AMAP_SECURITY_CODE || '';

if (!AMAP_KEY) {
    console.warn('[metro-3d] M3D_AMAP_KEY is empty. Copy .env.example to .env or set env vars before building.');
}

const replacements = {
    preventAssignment: true,
    values: {
        __M3D_AMAP_KEY__: JSON.stringify(AMAP_KEY),
        __M3D_AMAP_SECURITY_CODE__: JSON.stringify(AMAP_SECURITY_CODE)
    }
};

export default [
    {
        input: 'src/index.js',
        output: [
            {file: 'dist/metro-3d.js', format: 'umd', name: 'm3d', banner, sourcemap: true, exports: 'named'},
            {file: 'dist/metro-3d.esm.js', format: 'esm', banner, sourcemap: true, exports: 'named'},
            {file: 'dist/metro-3d.min.js', format: 'umd', name: 'm3d', banner, sourcemap: true, exports: 'named', plugins: [terser()]}
        ],
        plugins: [
            replace(replacements),
            resolve({browser: true}),
            commonjs(),
            json(),
            postcss({extract: 'metro-3d.css', minimize: true})
        ]
    }
];
