/**
 * Pins MONGO-DIVERGENCES.md — slug `non-json-operands-rejected` (#9): every data and operand
 * position accepts only the portable JSON value subset. A non-JSON carrier (Date, bigint, …), an
 * explicitly-undefined operator or logic value, or an unknown operator riding a known one is
 * rejected loudly at the validity gate — the JS matcher throws, the SQL builders return a typed
 * malformed-filter rejection — never silently mis-evaluated (BSON would accept these).
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

const RowSchema = z.object({ id: z.string(), createdAt: z.string(), age: z.number(), name: z.string() });
type Row = z.infer<typeof RowSchema>;
const row: Row = { id: '1', createdAt: '2020-01-01', age: 10, name: 'Alice' };

/** The compile-time grammar omits the bare-undefined field form; the runtime treats it as valid and matching nothing (the Edge Cases table in WhereFilterDefinition). */
const asRowFilter = (filter: unknown) => filter as WhereFilterDefinition<Row>;

// Each of these is a forbidden filter shape: the type system refuses it at compile time (hence the
// quarantined @ts-expect-error escapes), and the runtime gate must refuse it loudly too.
const malformedFilters: ReadonlyArray<{ label: string; filter: WhereFilterDefinition<Row> }> = [
    {
        label: 'a Date operand (a non-JSON carrier)',
        // @ts-expect-error — a Date has no portable JSON representation, so the operand type refuses it
        filter: { createdAt: { $gt: new Date('2020-01-01') } },
    },
    {
        label: 'a bigint operand (a non-JSON carrier)',
        // @ts-expect-error — a bigint has no portable JSON representation, so the operand type refuses it
        filter: { age: { $gt: 1n } },
    },
    {
        label: 'an explicitly-undefined operator value',
        // @ts-expect-error — an operator with an undefined operand is a forbidden state
        filter: { age: { $gt: undefined } },
    },
    {
        label: 'an explicitly-undefined logic value',
        // @ts-expect-error — a logic key with an undefined operand is a forbidden state
        filter: { $or: undefined },
    },
    {
        label: 'an unknown operator riding a known one',
        // @ts-expect-error — $mod is not part of the filter grammar
        filter: { age: { $eq: 5, $mod: 3 } },
    },
];

describe('divergence `non-json-operands-rejected` (#9)', () => {

    describe.each(malformedFilters)('$label', ({ filter }) => {

        test('js throws at the validity gate', async () => {
            expect(await matchOnJs(row, filter, RowSchema)).toMatchObject({
                kind: 'threw',
                message: expect.stringContaining('not well-defined'),
            });
        });

        test.each(sqlEngines)('$name refuses with the typed malformed-filter rejection', async ({ match }) => {
            expect(await match(row, filter, RowSchema)).toMatchObject({
                kind: 'rejected',
                code: 'malformed_filter',
            });
        });
    });

    describe.each(allEngines)('on $name', ({ match }) => {

        test('a portable operand evaluates normally — the gate refuses carriers, not comparisons', async () => {
            expect(await match(row, { age: { $gt: 5 } }, RowSchema)).toEqual(matched(true));
        });

        test('a bare undefined FIELD value stays valid: it matches nothing, without a throw', async () => {
            expect(await match(row, asRowFilter({ name: undefined }), RowSchema)).toEqual(matched(false));
        });
    });
});
