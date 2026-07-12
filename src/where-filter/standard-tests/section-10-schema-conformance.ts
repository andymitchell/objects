import { z } from "zod";
import type { SectionCtx } from "./harness.ts";

/** §10. Schema conformance — value-driven JS matcher vs schema-driven SQL emitter. */
export function registerSchemaConformance(ctx: SectionCtx): void {
    const { test, matchJavascriptObject, expectOrAcknowledgeUnsupported, expectOrAcknowledgeDivergence } = ctx;

    describe('10. Schema conformance (value-driven JS vs schema-driven SQL)', () => {

        // The JS matcher is value-driven and duck-types from the runtime value; the SQL emitter is
        // schema-driven and decides array-vs-scalar from the declared schema. They agree only when the data
        // conforms to a concrete schema. These two cases pin where they part — see MONGO-DIVERGENCES.md
        // "value-driven JS matcher vs schema-driven SQL emitter".

        test('array data under a scalar-declared field: JS matches by containment, schema-driven SQL does not', async () => {
            const schema = z.object({ id: z.string(), owner: z.string() });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately non-conforming: a scalar-declared field holding array data, the exact gap this documents
            const obj = { id: '1', owner: ['alice', 'bob'] } as any;
            const result = await matchJavascriptObject(obj, { owner: 'alice' }, schema);
            expectOrAcknowledgeDivergence(result, true, 'array under a scalar-declared field: value-driven JS containment vs schema-driven SQL — see MONGO-DIVERGENCES.md (value-driven JS vs schema-driven SQL)');
        });

        test('a shape-ambiguous (scalar | array) schema is unrepresentable in schema-driven SQL (rejected), while JS still duck-types', async () => {
            const schema = z.object({ id: z.string(), owner: z.union([z.string(), z.array(z.string())]) });
            const obj: z.infer<typeof schema> = { id: '1', owner: ['alice', 'bob'] };
            const result = await matchJavascriptObject(obj, { owner: 'alice' }, schema);
            expectOrAcknowledgeUnsupported(result, true, 'scalar|array ambiguous schema: schema-driven SQL cannot represent it (returns undefined); JS duck-types to true — see MONGO-DIVERGENCES.md (value-driven JS vs schema-driven SQL)');
        });

        // A nullable array (`null | array`) is the ONE array/non-array union that is not shape-ambiguous, so it
        // reaches the schema-driven SQL emitter, which decides to spread it. A row whose value is genuinely `null`
        // (a conforming value) must be EXCLUDED — exactly as the value-driven JS oracle excludes it (null is not an
        // array). The two evaluators MUST agree here (conforming data), so these assert directly: the SQL emitter
        // must neither throw (Postgres ran an array function — jsonb_array_elements / jsonb_array_length — on a JSON
        // null) nor spuriously match (SQLite json_array_length('null') is 0, which must not satisfy $size: 0).
        describe('a null-valued row under a `null | array` field is excluded by every array operator (JS = Postgres = SQLite)', () => {
            const Schema = z.object({ id: z.string(), tags: z.union([z.literal(null), z.array(z.string())]) });
            type Row = z.infer<typeof Schema>;
            const nullRow: Row = { id: 'null-row', tags: null };
            const hasShared: Row = { id: 'has', tags: ['shared', 'x'] };
            const noShared: Row = { id: 'no', tags: ['other'] };

            test('$in: a present element matches, an absent one does not, and the null row is excluded (never throws)', async () => {
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(hasShared, { tags: { $in: ['shared'] } }, Schema), true, 'nullable (null|array) field');
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(noShared, { tags: { $in: ['shared'] } }, Schema), false, 'nullable (null|array) field');
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(nullRow, { tags: { $in: ['shared'] } }, Schema), false, 'nullable (null|array) field');
            });

            test('plain containment {tags:"shared"}: the array row matches, the null row is excluded', async () => {
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(hasShared, { tags: 'shared' }, Schema), true, 'nullable (null|array) field');
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(nullRow, { tags: 'shared' }, Schema), false, 'nullable (null|array) field');
            });

            test('$elemMatch: the array row matches, the null row is excluded', async () => {
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(hasShared, { tags: { $elemMatch: 'shared' } }, Schema), true, 'nullable (null|array) field');
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(nullRow, { tags: { $elemMatch: 'shared' } }, Schema), false, 'nullable (null|array) field');
            });

            test('$all: the array row matches, the null row is excluded', async () => {
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(hasShared, { tags: { $all: ['shared'] } }, Schema), true, 'nullable (null|array) field');
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(nullRow, { tags: { $all: ['shared'] } }, Schema), false, 'nullable (null|array) field');
            });

            test('$nin: the null row is INCLUDED — null is in no exclusion list (matches the JS oracle)', async () => {
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(noShared, { tags: { $nin: ['shared'] } }, Schema), true, 'nullable (null|array) field');
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(hasShared, { tags: { $nin: ['shared'] } }, Schema), false, 'nullable (null|array) field');
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(nullRow, { tags: { $nin: ['shared'] } }, Schema), true, 'nullable (null|array) field');
            });

            test('$size: null is not an array of any length, so {$size: 0} and {$size: 1} both exclude it', async () => {
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(hasShared, { tags: { $size: 2 } }, Schema), true, 'nullable (null|array) field');
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(nullRow, { tags: { $size: 0 } }, Schema), false, 'nullable (null|array) field');
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(nullRow, { tags: { $size: 1 } }, Schema), false, 'nullable (null|array) field');
            });

            test('$not + $size: the null row matches (it is not an array of that length)', async () => {
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(hasShared, { tags: { $not: { $size: 2 } } }, Schema), false, 'nullable (null|array) field');
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(nullRow, { tags: { $not: { $size: 0 } } }, Schema), true, 'nullable (null|array) field');
            });
        });

        // The same nullable array nested under an array element, queried through $elemMatch, reaches the emitter's
        // recursive comparison path (a distinct $size emitter from the top-level array branch). A `null` element
        // value must still be excluded, not throw / spuriously match.
        describe('a null-valued `null | array` nested under an array element ($elemMatch recursion) is excluded', () => {
            const Schema = z.object({ id: z.string(), items: z.array(z.object({ tags: z.union([z.literal(null), z.array(z.string())]) })) });
            type Row = z.infer<typeof Schema>;

            test('{items:{$elemMatch:{tags:{$size:0}}}}: a null `tags` is not a 0-length array (excluded); a real [] element still matches', async () => {
                expectOrAcknowledgeUnsupported(await matchJavascriptObject({ id: 'null-el', items: [{ tags: null }] } satisfies Row, { items: { $elemMatch: { tags: { $size: 0 } } } }, Schema), false, 'nullable array nested under $elemMatch');
                expectOrAcknowledgeUnsupported(await matchJavascriptObject({ id: 'empty-el', items: [{ tags: [] }] } satisfies Row, { items: { $elemMatch: { tags: { $size: 0 } } } }, Schema), true, 'nullable array nested under $elemMatch');
            });
        });

        // A bare enum field is a single concrete scalar column — its members share one runtime type — so the
        // value-driven JS matcher and the schema-driven SQL emitter MUST agree on conforming data. A string enum is
        // a text column, a native numeric enum a numeric column; the emitter casts by the members' shared kind,
        // reproducing the JS matcher's strict `===` (a numeric member never matches a same-digit string). (A
        // mixed-scalar enum is multi-scalar and compared as a raw JSON value — pinned separately.)
        describe('a bare enum field compares by its members\' shared scalar type (JS = Postgres = SQLite)', () => {
            const StringEnum = z.object({ id: z.string(), status: z.enum(['active', 'archived']) });
            type StringRow = z.infer<typeof StringEnum>;
            const active: StringRow = { id: 'a', status: 'active' };
            const archived: StringRow = { id: 'b', status: 'archived' };

            test('string-enum equality: the active row matches { status: "active" }, the archived row does not', async () => {
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(active, { status: 'active' }, StringEnum), true, 'enum-typed field');
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(archived, { status: 'active' }, StringEnum), false, 'enum-typed field');
            });

            test('string-enum $in: the active row matches { $in: ["active"] }, the archived row does not', async () => {
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(active, { status: { $in: ['active'] } }, StringEnum), true, 'enum-typed field');
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(archived, { status: { $in: ['active'] } }, StringEnum), false, 'enum-typed field');
            });

            // eslint-disable-next-line no-shadow -- a local TS enum is the only way to produce numeric enum members
            enum Rank { Low = 0, High = 1 }
            const NumericEnum = z.object({ id: z.string(), rank: z.enum(Rank) });
            type NumericRow = z.infer<typeof NumericEnum>;

            test('numeric-enum equality matches by value, never by a same-digit string (strict ===)', async () => {
                expectOrAcknowledgeUnsupported(await matchJavascriptObject({ id: 'c', rank: Rank.Low } satisfies NumericRow, { rank: Rank.Low }, NumericEnum), true, 'enum-typed field');
                expectOrAcknowledgeUnsupported(await matchJavascriptObject({ id: 'd', rank: Rank.High } satisfies NumericRow, { rank: Rank.Low }, NumericEnum), false, 'enum-typed field');
            });
        });
    });
}
