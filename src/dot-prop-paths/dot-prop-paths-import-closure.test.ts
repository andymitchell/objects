import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guardrail for the `@andymitchell/objects` ↔ `@andymitchell/clone-to-json-safe` MUTUAL package
 * dependency. clone-to-json-safe imports `@andymitchell/objects/dot-prop-paths` (for the spreading
 * matcher), while objects imports clone-to-json-safe from OTHER subpaths (e.g. write-actions). That is
 * safe ONLY while the two used module sub-graphs stay disjoint: the day any module reachable from the
 * `dot-prop-paths` barrel imports clone-to-json-safe, the manifest cycle becomes a real *module-init*
 * cycle (clone-to-json-safe → dot-prop-paths → clone-to-json-safe) and deadlocks.
 *
 * This test traces the actual import closure of the barrel and fails loudly if clone-to-json-safe ever
 * leaks into it — the cheap tripwire that protects the whole arrangement.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** Resolve a relative import specifier (as written in source, possibly `.js`) to its real `.ts` file. */
function resolveRelative(fromFile: string, spec: string): string | undefined {
    const base = resolve(dirname(fromFile), spec);
    const candidates = [
        base,
        base.replace(/\.js$/, '.ts'),
        base.endsWith('.ts') ? base : `${base}.ts`,
        `${base}/index.ts`,
    ];
    return candidates.find(c => existsSync(c) && c.endsWith('.ts'));
}

/** BFS the relative-import graph from `entry`, returning every BARE (external package) specifier seen and the count of source files visited. */
function traceImportClosure(entry: string): { externals: string[]; filesVisited: number } {
    const specRe = /(?:from|import)\s*['"]([^'"]+)['"]/g;
    const seen = new Set<string>();
    const externals = new Set<string>();
    const stack = [entry];

    while (stack.length) {
        const file = stack.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);

        const src = readFileSync(file, 'utf8');
        for (const match of src.matchAll(specRe)) {
            const spec = match[1]!;
            if (spec.startsWith('.')) {
                const resolved = resolveRelative(file, spec);
                if (resolved) stack.push(resolved);
            } else {
                externals.add(spec);
            }
        }
    }

    return { externals: [...externals], filesVisited: seen.size };
}

describe('dot-prop-paths import closure stays free of clone-to-json-safe (acyclic module-graph guardrail)', () => {

    it('no module reachable from the barrel imports @andymitchell/clone-to-json-safe', () => {
        const { externals, filesVisited } = traceImportClosure(resolve(here, 'index.ts'));

        // Sanity: the tracer actually walked the graph (a broken resolver would visit ~1 file and
        // vacuously pass). The barrel pulls in several modules, so expect a handful at least.
        expect(filesVisited).toBeGreaterThan(3);

        const offending = externals.filter(spec => spec.includes('clone-to-json-safe'));
        expect(offending).toEqual([]);
    });

});
