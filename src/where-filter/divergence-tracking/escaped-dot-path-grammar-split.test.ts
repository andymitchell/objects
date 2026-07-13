/**
 * Pins MONGO-DIVERGENCES.md — slug `escaped-dot-path-grammar-split` (#14): both path readers agree
 * that `\.` escapes a literal dot in a key, but the JS matcher's reader (the dot-prop package)
 * additionally decodes `\\` (and bracket escapes) while the SQL reader treats a backslash before
 * anything but a dot as part of the key — so a path using those extra escapes is read differently
 * by the two engines (MongoDB has no dot-escaping grammar at all).
 *
 * If this file goes red, the documented claim has stopped holding. Do NOT edit the test to green:
 * follow the failure routine in divergence-tracking/README.md (entry by slug → recent commits →
 * real MongoDB via `npm run test:mongo-truth` → present the case to the maintainer).
 */
import { describe, test, expect } from "vitest";
import { z } from "zod";
import type { WhereFilterDefinition } from "../types.ts";
import { allEngines, matched, matchOnJs, sqlEngines, usePostgresLifecycle } from "./engine-seams.ts";

usePostgresLifecycle();

const DottedKeySchema = z.object({ id: z.string(), rows: z.object({ 'a.b': z.number() }) });
const dottedKeyRow = { id: '1', rows: { 'a.b': 1 } };

const BackslashKeySchema = z.object({ id: z.string(), rows: z.object({ 'a\\': z.object({ b: z.number() }) }) });
const backslashKeyRow = { id: '1', rows: { 'a\\': { b: 1 } } };

/** The compile-time path grammar cannot name an escaped-dot key; the runtime grammar accepts the path (the validity gate still checks it). */
const asDottedKeyFilter = (filter: unknown) => filter as WhereFilterDefinition<z.infer<typeof DottedKeySchema>>;
const asBackslashKeyFilter = (filter: unknown) => filter as WhereFilterDefinition<z.infer<typeof BackslashKeySchema>>;

describe('divergence `escaped-dot-path-grammar-split` (#14)', () => {

    describe.each(allEngines)('on $name', ({ match }) => {

        test('the common ground: an escaped dot names a dotted key identically everywhere', async () => {
            expect(await match(dottedKeyRow, asDottedKeyFilter({ 'rows.a\\.b': 1 }), DottedKeySchema)).toEqual(matched(true));
        });
    });

    describe('the split: a double-backslash before a dot is read as two different paths', () => {

        test('js decodes the backslash escape and reaches the backslash-holding key', async () => {
            expect(await matchOnJs(backslashKeyRow, asBackslashKeyFilter({ 'rows.a\\\\.b': 1 }), BackslashKeySchema)).toEqual(matched(true));
        });

        test.each(sqlEngines)('$name keeps the backslash literal, reads one key the row does not have, and fails', async ({ match }) => {
            expect(await match(backslashKeyRow, asBackslashKeyFilter({ 'rows.a\\\\.b': 1 }), BackslashKeySchema)).toEqual(matched(false));
        });
    });

    describe("the shared grammar cannot name a backslash-holding key at all", () => {

        test.each(allEngines)("$name reads the renderer's output as the dotted key 'a.b', which the row does not have", async ({ match }) => {
            expect(await match(backslashKeyRow, asBackslashKeyFilter({ 'rows.a\\.b': 1 }), BackslashKeySchema)).toEqual(matched(false));
        });
    });
});
