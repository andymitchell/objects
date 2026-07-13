import { ContactSchema, NullableAgeContactSchema, BooleanContactSchema } from "./fixtures.ts";
import type { SectionCtx } from "./harness.ts";

/** §2 (part B) Scalar value comparisons — $in, $nin, $not, $exists, $type, exact null, numeric edges. */
export function registerScalarComparisonsB(ctx: SectionCtx): void {
    const { test, matchJavascriptObject, expectOrAcknowledgeUnsupported, expectOrAcknowledgeDivergence } = ctx;

        describe('$in (scalar)', () => {
            test('$in string: passes when value in list', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $in: ['Andy', 'Bob'] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$in string: fails when value not in list', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $in: ['Bob', 'Carol'] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$in number: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $in: [25, 30, 35] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$in number: fails', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $in: [25, 35] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$in with empty list: always fails', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $in: [] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$in on missing/undefined property: returns false', async () => {
                // Spec nullish table: $in → false on undefined/null
                // SQL: `NULL IN (25, 30)` → UNKNOWN (falsy), must explicitly handle
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.age': { $in: [25, 30] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });
        });

        describe('$nin (scalar)', () => {
            test('$nin string: passes when value not in list', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $nin: ['Bob', 'Carol'] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$nin string: fails when value in list', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $nin: ['Andy', 'Bob'] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$nin number: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $nin: [25, 35] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$nin number: fails', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $nin: [25, 30, 35] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$nin with empty list: always passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $nin: [] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$nin on missing/undefined property: returns true', async () => {
                // Spec nullish table: $nin → true on undefined/null (matches missing)
                // SQL: `NULL NOT IN (25, 30)` → UNKNOWN (falsy), must use `IS NULL OR col NOT IN (...)`
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.age': { $nin: [25, 30] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });
        });

        describe('$not (field-level negation)', () => {
            test('$not with $gt: passes when value does not exceed', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 20 } },
                    { 'contact.age': { $not: { $gt: 25 } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$not with $gt: fails when value exceeds', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $not: { $gt: 25 } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$not on missing optional field: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.age': { $not: { $gt: 0 } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$not with $ne (double negation = equals): passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $not: { $ne: 'Andy' } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$not with $in: passes when not in list', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $not: { $in: ['Bob', 'Carol'] } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$not with $in: fails when in list', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $not: { $in: ['Andy', 'Bob'] } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$not with $regex: passes when pattern does not match', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $not: { $regex: '^Bob' } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$not with $regex: fails when pattern matches', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $not: { $regex: '^And' } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$not with $nin: passes when value is in excluded list', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $not: { $nin: ['Andy', 'Bob'] } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$not with $nin: fails when value is not in excluded list', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $not: { $nin: ['Bob', 'Carol'] } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$not with $exists: passes when field is missing', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.age': { $not: { $exists: true } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$not with $exists: fails when field exists', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $not: { $exists: true } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$not with $type: passes when field is not a string', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $not: { $type: 'string' } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$not with $type: fails when field matches type', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $not: { $type: 'string' } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$not with $eq: passes when not equal (double negation)', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $not: { $eq: 'Bob' } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$not with $eq: fails when equal', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $not: { $eq: 'Andy' } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$not with $size: passes when array is different length', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London', 'NYC'] } },
                    { 'contact.locations': { $not: { $size: 3 } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$not with $size: fails when array matches length', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London', 'NYC'] } },
                    { 'contact.locations': { $not: { $size: 2 } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });
        });

        describe('$exists', () => {
            test('$exists true on existing field: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $exists: true } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$exists true on missing field: fails', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.age': { $exists: true } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$exists false on missing field: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.age': { $exists: false } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$exists false on existing field: fails', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $exists: false } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$exists true on existing array: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London'] } },
                    { 'contact.locations': { $exists: true } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$exists false on missing array: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.locations': { $exists: false } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$exists true on field with explicit null: passes (null is a present value)', async () => {
                // MongoDB-aligned: null is a present value, distinct from a missing key.
                // JS uses `!== undefined`; SQL builders use jsonb_typeof / json_type to
                // preserve the JSON-null vs missing-path distinction.
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: null } },
                    { 'contact.age': { $exists: true } },
                    NullableAgeContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$exists false on field with explicit null: fails (null is a present value)', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: null } },
                    { 'contact.age': { $exists: false } },
                    NullableAgeContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });
        });

        describe('$type', () => {
            test('$type "string": passes on string field', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $type: 'string' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$type "string": fails on number field', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $type: 'string' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$type "number": passes on number field', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $type: 'number' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$type "number": fails on string field', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $type: 'number' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$type "array": passes on array field', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London'] } },
                    { 'contact.locations': { $type: 'array' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$type on missing field: fails', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.age': { $type: 'number' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$type "null" on a missing optional field: an absent field has no type, so it does not match', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.age': { $type: 'null' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$type "object": passes on object field', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact': { $type: 'object' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$type "string" on array of strings: fails (checks field type, not element types)', async () => {
                // Divergence from MongoDB: Mongo's $type checks array elements, so
                // { $type: 'string' } would return true if any element is a string.
                // Our implementation checks the field's own type (array ≠ string → false).
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London'] } },
                    { 'contact.locations': { $type: 'string' } },
                    ContactSchema
                );
                expectOrAcknowledgeDivergence(result, false, '$type checks field type not element types; MongoDB would return true here');
            });

            test('$type "bool": passes on boolean field', async () => {
                // SQLite quirk: json_type returns 'true'/'false' not 'bool',
                // so the SQLite engine must map these to match $type: 'bool'.
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', isVIP: true } },
                    { 'contact.isVIP': { $type: 'bool' } },
                    BooleanContactSchema
                );
                expectOrAcknowledgeDivergence(result, true, '$type bool: SQLite json_type returns true/false not bool');
            });
        });

        describe('Exact scalar null', () => {
            test('exact scalar null matches explicitly null field', async () => {
                // Spec: exact scalar uses strict equality (===). null === null → true.
                // SQL must translate this to IS NULL, not `= NULL` (which yields UNKNOWN).
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: null } },
                    // @ts-expect-error — TODO: ValueComparisonFlexi doesn't include null for nullable fields
                    { 'contact.age': null },
                    NullableAgeContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });
        });

        describe('Numeric edge values (NaN, Infinity, -0)', () => {
            test('NaN equality never matches (NaN !== NaN in JS)', async () => {
                // An impl using Object.is or a deep-equals lib would silently return true.
                // SQL impls short-circuit filter-side NaN to `1=0` (Mongo-aligned) — see MONGO-DIVERGENCES.md §7.
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: NaN } },
                    { 'contact.age': { $eq: NaN } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('NaN range comparison never matches (all NaN comparisons return false)', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: NaN } },
                    { 'contact.age': { $gt: 0 } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$exists: true on stored NaN: passes (NaN serializes to JSON null, which $exists treats as present)', async () => {
                // Outcome conforms with MongoDB even though the storage representation differs:
                // JSON.stringify drops NaN to null, but the $exists fix treats JSON null as present.
                // See MONGO-DIVERGENCES.md §7.
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: NaN } },
                    { 'contact.age': { $exists: true } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            // Filter-side NaN — proves SQL builders short-circuit `NaN` filter values to constant SQL
            // booleans (1=0 / 1=1) instead of binding NaN as a parameter (driver-dependent behaviour).
            // All assertions below are uniform across JS, SQLite, and Postgres after the Phase 1 fix.

            test('$eq: NaN against finite value: never matches (Mongo: nothing equals NaN)', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $eq: NaN } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$eq: NaN against missing field: never matches', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.age': { $eq: NaN } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$ne: NaN matches any present value (NaN equals nothing, so != is always true)', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $ne: NaN } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$ne: NaN matches missing field (Mongo: $ne also matches missing)', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.age': { $ne: NaN } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$gt: NaN never matches (all NaN comparisons are false)', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $gt: NaN } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$lt: NaN never matches', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $lt: NaN } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$gte: NaN never matches', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $gte: NaN } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$lte: NaN never matches', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $lte: NaN } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('Infinity exceeds any finite bound', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: Infinity } },
                    { 'contact.age': { $gt: 1e308 } },
                    ContactSchema
                );
                expectOrAcknowledgeDivergence(result, true, 'Infinity in stored data: see MONGO-DIVERGENCES.md §7 — JSON spec excludes Infinity, lost at JSON.stringify boundary');
            });

            // Companion tests for the documented Infinity divergence (MONGO-DIVERGENCES.md §7).
            // These cases happen to conform across JS and SQL even though the stored representation
            // differs — pin them so a future change to either path can't silently regress.

            test('$eq: 0 against stored Infinity: never matches (Mongo + SQL agree, by accident in SQL)', async () => {
                // Mongo: Infinity !== 0 → false. JS: false. SQL: Infinity → JSON null at storage; null = 0 is NULL → false.
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: Infinity } },
                    { 'contact.age': { $eq: 0 } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$exists: true on stored Infinity: matches (Infinity → JSON null, treated as present)', async () => {
                // Mongo: true (Infinity is present). JS: true (Infinity !== undefined). SQL: true (JSON null is present after $exists fix).
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: Infinity } },
                    { 'contact.age': { $exists: true } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('-0 equals +0 under $eq (JS strict equality)', async () => {
                // -0 === 0 is true in JS. Object.is(−0, 0) is false — pin so an impl
                // that switches matchers doesn't silently change semantics.
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: -0 } },
                    { 'contact.age': { $eq: 0 } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });
        });
}
