/**
 * Build (esbuild):
 *  - Server:   dist/server/index.js (Node 22, keine npm-Laufzeitabhängigkeiten)
 *  - Frontend: dist/frontend/ (Formular index.html/index.js, Admin admin/index.html/admin.js, formular.svg)
 *  - Bridge:   dist/bridge/bridge.js (chayns.codes-Funktion mit Platzhaltern, siehe make-bridge.mjs)
 *
 * Aufruf: node scripts/build.mjs [--server] [--frontend] [--bridge] [--watch]
 */
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');
const selected = ['--bridge', '--server', '--frontend'].filter((flag) => args.has(flag));
const wants = (flag) => selected.length === 0 || selected.includes(flag);

/** @type {import('esbuild').BuildOptions} */
const bridgeOptions = {
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    outdir: resolve(root, 'dist/bridge'),
    entryNames: '[name]',
    entryPoints: { bridge: resolve(root, 'bridge/src/bridge.ts') },
    legalComments: 'none',
    minify: false,
    // ASCII-Ausgabe: der chayns.codes-Editor verfälscht sonst Umlaute (Erfahrung Montageplan).
    charset: 'ascii',
    logLevel: 'info',
    banner: {
        js: [
            '// Bautagesbericht LANSING - Bridge fuer chayns.codes. Generiert durch scripts/make-bridge.mjs aus bridge/src; nicht manuell bearbeiten.',
            '// Trigger: HTTPS. Timeout: 60 s. Aktionen: assert (Anmeldung), ai (Diktat), ping.',
        ].join('\n'),
    },
};

/** @type {import('esbuild').BuildOptions} */
const serverOptions = {
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    outdir: resolve(root, 'dist/server'),
    entryNames: '[name]',
    entryPoints: { index: resolve(root, 'server/src/index.ts') },
    packages: 'external',
    legalComments: 'none',
    minify: false,
    sourcemap: 'inline',
    logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const frontendOptions = {
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    outdir: resolve(root, 'dist/frontend'),
    // Ausgabe: index.js (Formular) und admin.js (Admin-Bereich, eingebunden von admin/index.html).
    entryNames: '[name]',
    entryPoints: {
        index: resolve(root, 'frontend/src/form/main.tsx'),
        admin: resolve(root, 'frontend/src/admin/main.tsx'),
    },
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.css': 'css' },
    legalComments: 'none',
    minify: true,
    sourcemap: false,
    logLevel: 'info',
};

function copyPublic() {
    const src = resolve(root, 'frontend/public');
    const dest = resolve(root, 'dist/frontend');
    mkdirSync(dest, { recursive: true });
    if (!existsSync(src)) return;
    for (const file of readdirSync(src)) cpSync(resolve(src, file), resolve(dest, file), { recursive: true });
}

async function run() {
    if (!watch) {
        for (const [flag, dir] of [
            ['--bridge', 'dist/bridge'],
            ['--server', 'dist/server'],
            ['--frontend', 'dist/frontend'],
        ]) {
            if (wants(flag)) rmSync(resolve(root, dir), { recursive: true, force: true });
        }
    }
    const tasks = [];
    const go = (options) => (watch ? esbuild.context(options).then((ctx) => ctx.watch()) : esbuild.build(options));
    if (wants('--bridge')) tasks.push(go(bridgeOptions));
    if (wants('--server')) tasks.push(go(serverOptions));
    if (wants('--frontend')) {
        copyPublic();
        tasks.push(go(frontendOptions));
    }
    await Promise.all(tasks);
    console.log(watch ? 'Watching for changes ...' : 'Build fertig: dist/');
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
