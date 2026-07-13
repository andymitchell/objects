/**
 * Pins MONGO-DIVERGENCES.md — slug `value-driven-js-vs-schema-driven-sql` (#8): the JS matcher
 * duck-types the runtime value (as MongoDB does), while the SQL emitters decide scalar-vs-array
 * purely from the declared schema. They diverge on data that does not conform to its schema, and a
 * shape-ambiguous (scalar|array) schema is refused by the SQL side rather than guessed. The
 * documented resolution — `universalSchemaConformance` — holds the JS matcher to the same
 * lowest-common-denominator contract.
 *
 * If this file goes red, the documented claim has stopped holding. Do NOT edit the test to green:
 * follow the failure routine in divergence-tracking/README.md (entry by slug → recent commits →
 * real MongoDB via `npm run test:mongo-truth` → present the case to the maintainer).
 */
import { describe, test, expect } from "vitest";
import { z } from "zod";
import { allEngines, matched, matchOnJs, sqlEngines, usePostgresLifecycle } from "./engine-seams.ts";

usePostgresLifecycle();

const ScalarSchema = z.object({ id: z.string(), owner: z.string() });
type Scalar = z.infer<typeof ScalarSchema>;

// The register's subject is data that escaped its declared schema — a state the type system rightly
// refuses to express, so the escape is quarantined here.
// @ts-expect-error — an array row under a scalar-declared field is a forbidden state
const nonConformingRow: Scalar = { id: '1', owner: ['a', 'b'] };
const conformingRow: Scalar = { id: '2', owner: 'a' };

const AmbiguousSchema = z.object({ id: z.string(), owner: z.union([z.string(), z.array(z.string())]) });
const ambiguousSchemaRow: z.infer<typeof AmbiguousSchema> = { id: '3', owner: 'a' };

describe('divergence `value-driven-js-vs-schema-driven-sql` (#8)', () => {

    describe('the split: an array row under a scalar-declared field', () => {

        test('js duck-types the runtime value and matches by array containment, as MongoDB does', async () => {
            expect(await matchOnJs(nonConformingRow, { owner: 'a' }, ScalarSchema)).toEqual(matched(true));
        });

        test.each(sqlEngines)('$name is bound to the declared scalar and does not match', async ({ match }) => {
            expect(await match(nonConformingRow, { owner: 'a' }, ScalarSchema)).toEqual(matched(false));
        });
    });

    describe('a shape-ambiguous (scalar|array) schema is refused, not guessed', () => {

        test.each(sqlEngines)('$name returns the typed schema_ambiguous refusal', async ({ match }) => {
            expect(await match(ambiguousSchemaRow, { owner: 'a' }, AmbiguousSchema)).toMatchObject({
                kind: 'unsupported',
                code: 'schema_ambiguous',
            });
        });

        test('js under universalSchemaConformance refuses the same schema', async () => {
            expect(await matchOnJs(ambiguousSchemaRow, { owner: 'a' }, AmbiguousSchema,
                { universalSchemaConformance: { schema: AmbiguousSchema } }
            )).toMatchObject({ kind: 'threw', message: expect.stringContaining('shape-ambiguous') });
        });
    });

    describe('the documented resolution closes the gap', () => {

        test('js under universalSchemaConformance refuses to duck-type a non-conforming row', async () => {
            expect(await matchOnJs(nonConformingRow, { owner: 'a' }, ScalarSchema,
                { universalSchemaConformance: { schema: ScalarSchema } }
            )).toMatchObject({ kind: 'threw', message: expect.stringContaining('does not conform') });
        });
    });

    describe.each(allEngines)('on $name', ({ match }) => {

        test('the engines agree when the data conforms: a matching scalar matches', async () => {
            expect(await match(conformingRow, { owner: 'a' }, ScalarSchema)).toEqual(matched(true));
        });

        test('the engines agree when the data conforms: a non-matching scalar fails', async () => {
            expect(await match(conformingRow, { owner: 'b' }, ScalarSchema)).toEqual(matched(false));
        });
    });
});
