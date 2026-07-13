/**
 * Holds `MONGO-DIVERGENCES.md` and this directory to each other: every register entry has exactly one
 * pinning `<slug>.test.ts` file here, and every test file here pins exactly one register entry.
 *
 * If this file goes red, the register and its pins have drifted apart (an entry added without a pin,
 * an orphan/renamed file, or a broken slug line). Fix the mapping — see README.md for the conventions.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { parseDivergenceRegister } from "./registry.ts";

const registerMarkdown = readFileSync(new URL('../MONGO-DIVERGENCES.md', import.meta.url), 'utf8');
const entries = parseDivergenceRegister(registerMarkdown);

describe('the divergence register and its pinning test files stay 1:1', () => {

    test('the register parses to the frozen entry set (a new or retired entry must consciously update this pin)', () => {
        expect(entries.map(e => e.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
        expect(entries.filter(e => e.status === 'retired').map(e => e.id)).toEqual([4, 6, 13]);
    });

    test('every slug is unique kebab-case', () => {
        const slugs = entries.map(e => e.slug);
        expect(new Set(slugs).size).toBe(slugs.length);
        for (const slug of slugs) {
            expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)+$/);
        }
    });

    test('every entry has its pinning test file, and every test file pins an entry (no orphans)', () => {
        const actualFiles = readdirSync(new URL('.', import.meta.url))
            .filter(f => f.endsWith('.test.ts') && f !== 'registry.test.ts')
            .sort();
        const expectedFiles = entries.map(e => `${e.slug}.test.ts`).sort();
        expect(actualFiles).toEqual(expectedFiles);
    });

    test('every pinning file names its own slug and points at the register (the failure routine stays reachable)', () => {
        for (const entry of entries) {
            const source = readFileSync(new URL(`./${entry.slug}.test.ts`, import.meta.url), 'utf8');
            expect(source, `${entry.slug}.test.ts must name its slug`).toContain(`\`${entry.slug}\``);
            expect(source, `${entry.slug}.test.ts must point at the register`).toContain('MONGO-DIVERGENCES.md');
        }
    });
});
