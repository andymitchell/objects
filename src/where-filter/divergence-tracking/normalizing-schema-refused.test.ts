/**
 * Pins MONGO-DIVERGENCES.md — slug `normalizing-schema-refused` (#11): a schema that normalizes the
 * value on parse (coerce/transform/pipe/preprocess) would make the value-driven JS matcher and a
 * schema-driven SQL cast read different values, so the SQL engines refuse it with a typed
 * schema_normalizes error and `universalSchemaConformance` throws on it — while transparent
 * wrappers (refine, default) pass through (MongoDB has no schema at all).
 *
 * If this file goes red, the documented claim has stopped holding. Do NOT edit the test to green:
 * follow the failure routine in divergence-tracking/README.md (entry by slug → recent commits →
 * real MongoDB via `npm run test:mongo-truth` → present the case to the maintainer).
 */
import { describe, test, expect } from "vitest";
import { z } from "zod";
import { allEngines, matched, matchOnJs, sqlEngines, usePostgresLifecycle } from "./engine-seams.ts";

usePostgresLifecycle();

const CoerceSchema = z.object({ id: z.string(), age: z.coerce.number() });

// The register's subject is the raw stored value a coercing schema would rewrite — a state the type
// system rightly refuses to express, so the escape is quarantined here.
// @ts-expect-error — a stored string under a number-declared field is a forbidden state
const rawStoredString: z.infer<typeof CoerceSchema> = { id: '1', age: '1' };

describe('divergence `normalizing-schema-refused` (#11)', () => {

    describe('a coercing schema is a typed refusal on the schema-driven engines', () => {

        test.each(sqlEngines)('$name returns the typed schema_normalizes refusal, never a silent cast', async ({ match }) => {
            expect(await match(rawStoredString, { age: 1 }, CoerceSchema)).toMatchObject({
                kind: 'unsupported',
                code: 'schema_normalizes',
            });
        });

        test('js under universalSchemaConformance refuses the same schema', async () => {
            expect(await matchOnJs(rawStoredString, { age: 1 }, CoerceSchema,
                { universalSchemaConformance: { schema: CoerceSchema } }
            )).toMatchObject({ kind: 'threw', message: expect.stringContaining('value-normalizing') });
        });

        test("the default js matcher compares the RAW stored value with strict equality: '1' does not equal 1", async () => {
            expect(await matchOnJs(rawStoredString, { age: 1 }, CoerceSchema)).toEqual(matched(false));
        });
    });

    describe('transparent wrappers are not normalizations and pass through', () => {

        const RefineSchema = z.object({ id: z.string(), age: z.number().refine(v => v >= 0) });
        const DefaultSchema = z.object({ id: z.string(), age: z.number().default(5) });

        describe.each(allEngines)('on $name', ({ match }) => {

            test('.refine() compiles and matches normally', async () => {
                expect(await match({ id: '1', age: 1 }, { age: 1 }, RefineSchema)).toEqual(matched(true));
            });

            test('.default() compiles and matches normally', async () => {
                expect(await match({ id: '1', age: 1 }, { age: 1 }, DefaultSchema)).toEqual(matched(true));
            });
        });
    });
});
