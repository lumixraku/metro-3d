import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import terser from '@rollup/plugin-terser';
import postcss from 'rollup-plugin-postcss';

const banner = `/*!
 * Metro 3D v0.1.0
 * A real-time 3D digital map of Shenzhen Metro.
 * Inspired by mini-tokyo-3d (Akihiko Kusanagi, MIT).
 */`;

export default [
    {
        input: 'src/index.js',
        output: [
            {file: 'dist/metro-3d.js', format: 'umd', name: 'm3d', banner, sourcemap: true, exports: 'named'},
            {file: 'dist/metro-3d.esm.js', format: 'esm', banner, sourcemap: true, exports: 'named'},
            {file: 'dist/metro-3d.min.js', format: 'umd', name: 'm3d', banner, sourcemap: true, exports: 'named', plugins: [terser()]}
        ],
        plugins: [
            resolve({browser: true}),
            commonjs(),
            json(),
            postcss({extract: 'metro-3d.css', minimize: true})
        ]
    }
];
