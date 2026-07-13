#!/usr/bin/env node
/**
 * Fails the build if a devDependency reached a published bundle.
 *
 * tsup auto-externalises `dependencies` and `peerDependencies` but BUNDLES every devDependency an entry
 * can reach. That rule is how a test runner and a MongoDB query engine ended up vendored inside production
 * entrypoints. A vendored vitest is not merely dead weight: a second copy of the runner overwrites
 * `globalThis[Symbol.for('expect-global')]`, silently stealing the consumer runner's per-test state.
 *
 * Ground truth is esbuild's metafile (`dist/metafile-esm.json`) — the post-resolution, post-tree-shake graph
 * of what actually got written. Source-level analysis cannot answer this: it would have to re-derive esbuild's
 * resolution, barrel re-export flattening, tree-shaking, and `import type` erasure by hand.
 *
 * Two rules, because they catch different failures:
 *
 *   1. No devDependency may be BUNDLED into any entry (it appears in that entry's `inputs`).
 *   2. No production entry may IMPORT the test runner, even as an external. Externals never appear in
 *      `inputs`, so rule 1 is blind to a bare `import 'vitest'` — which still breaks the consumer at runtime.
 *      `./objects-delta-testing` is the sole entry allowed to do this: it is a testing entrypoint, and a bare
 *      import there binds the consumer's own runner instance, which is exactly what it should do.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(resolve(repoRoot, p), 'utf8'));

/** Entry source paths permitted to import the test runner as an external. */
const RUNNER_IMPORT_ALLOWED_ENTRIES = new Set(['src/objects-delta/index-testing.ts']);

/** A published module that would pull the consumer's test runner in at runtime. */
const RUNNER_MODULE = /^(vitest(\/.*)?|@vitest\/.*|chai)$/;

/**
 * The owning package of a `node_modules` path, honouring nesting and scopes.
 * `node_modules/a/node_modules/@s/b/x.js` → `@s/b`.
 */
function owningPackage(inputPath) {
    const marker = 'node_modules/';
    const last = inputPath.lastIndexOf(marker);
    if (last === -1) return undefined;
    const rest = inputPath.slice(last + marker.length).split('/');
    return rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
}

const pkg = readJson('package.json');
const devDeps = new Set(Object.getOwnPropertyNames(pkg.devDependencies ?? {}));

let metafile;
try {
    metafile = readJson('dist/metafile-esm.json');
} catch {
    console.error('✖ dist/metafile-esm.json not found. Run `npm run build` first (tsup needs `metafile: true`).');
    process.exit(1);
}

/** Every output reachable from `output`, following internal (non-external) imports. Includes itself. */
function reachableOutputs(output) {
    const seen = new Set();
    const queue = [output];
    while (queue.length > 0) {
        const current = queue.pop();
        if (current === undefined || seen.has(current)) continue;
        seen.add(current);
        const meta = metafile.outputs[current];
        if (meta === undefined) continue;
        for (const imported of meta.imports ?? []) {
            if (!imported.external) queue.push(imported.path);
        }
    }
    return seen;
}

const entries = Object.getOwnPropertyNames(metafile.outputs)
    .filter((out) => metafile.outputs[out].entryPoint !== undefined)
    .map((out) => ({ out, entryPoint: metafile.outputs[out].entryPoint }));

if (entries.length === 0) {
    console.error('✖ No entry points found in the metafile — the guard would vacuously pass. Refusing.');
    process.exit(1);
}

const violations = [];

for (const { out, entryPoint } of entries) {
    const outputs = reachableOutputs(out);

    // Rule 1 — a devDependency got bundled in.
    const bundled = new Map(); // devDep -> example input path
    for (const o of outputs) {
        for (const input of Object.getOwnPropertyNames(metafile.outputs[o].inputs ?? {})) {
            const owner = owningPackage(input);
            if (owner !== undefined && devDeps.has(owner) && !bundled.has(owner)) bundled.set(owner, input);
        }
    }
    for (const [owner, example] of bundled) {
        violations.push(`${entryPoint}\n    bundles devDependency '${owner}'  (e.g. ${example})`);
    }

    // Rule 2 — a production entry imports the test runner, even externally.
    if (!RUNNER_IMPORT_ALLOWED_ENTRIES.has(entryPoint)) {
        const runners = new Set();
        for (const o of outputs) {
            for (const imported of metafile.outputs[o].imports ?? []) {
                if (imported.external && RUNNER_MODULE.test(imported.path)) runners.add(imported.path);
            }
        }
        for (const runner of runners) {
            violations.push(`${entryPoint}\n    imports test runner '${runner}' — production entries must never reach the runner`);
        }
    }
}

if (violations.length > 0) {
    console.error(`\n✖ Published bundles leak test/dev machinery (${violations.length}):\n`);
    for (const v of violations) console.error(`  ${v}\n`);
    console.error('  A devDependency in a published bundle ships a duplicate copy to every consumer.');
    console.error('  Fix by injecting the dependency as a seam, or by promoting it to `dependencies` if production code genuinely needs it.\n');
    process.exit(1);
}

console.log(`✔ no devDependency or test runner leaked into ${entries.length} published entries`);
