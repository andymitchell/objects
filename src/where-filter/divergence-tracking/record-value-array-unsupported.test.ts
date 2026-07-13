/**
 * Pins MONGO-DIVERGENCES.md — slug `record-value-array-unsupported` (#12): a path crossing an array
 * INSIDE a record value cannot be emitted by the schema-driven SQL array spreaders, so they refuse
 * it with a typed unsupported-path error rather than crash or silently miss — while the value-driven
 * JS matcher resolves it from the runtime value (as MongoDB does).
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

const RowSchema = z.object({
    id: z.string(),
    data: z.record(z.string(), z.object({ tags: z.array(z.string()), name: z.string() })),
});
type Row = z.infer<typeof RowSchema>;
const row: Row = { id: '1', data: { k: { tags: ['a'], name: 'x' } } };

/** The compile-time path grammar cannot name a record's dynamic key; the runtime grammar accepts the path (the validity gate still checks it). */
const asRowFilter = (filter: unknown) => filter as WhereFilterDefinition<Row>;

describe('divergence `record-value-array-unsupported` (#12)', () => {

    describe.each(sqlEngines)('on $name', ({ match }) => {

        test('an array beneath a record key is a typed unsupported path — a refusal, not a crash or a silent false', async () => {
            expect(await match(row, asRowFilter({ 'data.k.tags': 'a' }), RowSchema)).toMatchObject({
                kind: 'unsupported',
                code: 'record_value_array',
            });
        });
    });

    test('js resolves the same path from the runtime value, as MongoDB does', async () => {
        expect(await matchOnJs(row, asRowFilter({ 'data.k.tags': 'a' }), RowSchema)).toEqual(matched(true));
    });

    describe.each(allEngines)('on $name', ({ match }) => {

        test('a non-array leaf beneath a record resolves and matches normally', async () => {
            expect(await match(row, asRowFilter({ 'data.k.name': 'x' }), RowSchema)).toEqual(matched(true));
        });

        test('a non-array leaf beneath a record still discriminates values', async () => {
            expect(await match(row, asRowFilter({ 'data.k.name': 'y' }), RowSchema)).toEqual(matched(false));
        });
    });
});
