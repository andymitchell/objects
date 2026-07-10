import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SQLITE_MANIFEST } from "./sqlite.manifest.ts";
import { POSTGRES_MANIFEST } from "./postgres.manifest.ts";

/**
 * Guards on the capability manifests themselves — separate from the per-engine drift-guard, which checks a run
 * against its manifest. These check the manifests are well-formed and that every divergence id they cite is real.
 */

const ALL_ENTRIES = [...SQLITE_MANIFEST, ...POSTGRES_MANIFEST];

describe('capability manifests are well-formed', () => {
    test.each(ALL_ENTRIES)('an entry is a `kind ::: reason ::: testName` line with a known kind: %s', (entry) => {
        const parts = entry.split(' ::: ');
        expect(parts.length).toBe(3);
        expect(['unsupported', 'divergence']).toContain(parts[0]);
        expect(parts[1]!.length).toBeGreaterThan(0);
        expect(parts[2]!.length).toBeGreaterThan(0);
    });
});

describe('every divergence id a manifest cites exists in MONGO-DIVERGENCES.md', () => {
    const divergencesDoc = readFileSync(new URL('../../MONGO-DIVERGENCES.md', import.meta.url), 'utf8');

    // The manifests reference documented divergences as `#N` tokens (e.g. `#4`); the register titles them `## N.`.
    const citedIds = [...new Set(ALL_ENTRIES.flatMap(e => [...e.matchAll(/#(\d+)/g)].map(m => m[1]!)))].sort();

    test('the manifests actually cite some divergence ids (the guard is not vacuous)', () => {
        expect(citedIds.length).toBeGreaterThan(0);
    });

    test.each(citedIds)('divergence #%s has an entry in the register', (id) => {
        expect(divergencesDoc).toContain(`## ${id}.`);
    });
});
