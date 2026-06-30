import { z } from "zod";
import { prepareWhereClauseForPg, PropertyTranslatorPgJsonbSchema } from "./index.ts";
import type { PreparedWhereClauseResult } from "../types.ts";
import matchJavascriptObject from "../../matchJavascriptObject.ts";
import type { WhereFilterDefinition } from "../../types.ts";

import { standardTests, type MatchJavascriptObjectInTesting } from "../../standardTests.ts";

import { DbMultipleTestsRunner } from "@andyrmitchell/pg-testable";
import { UNSAFE_WARNING } from "./convertDotPropPathToPostgresJsonPath.ts";




describe('postgres where clause builder', () => {

    let runner:DbMultipleTestsRunner;
    beforeAll(async () => {
        runner = new DbMultipleTestsRunner({type:'pglite'});
        runner.sequentialTest(async (runner, db) => {
            await db.query("select 'Hello world' as message;");
        })
    })
    afterAll(async () => {
        await runner.dispose();
        console.log("Db shutdown OK");
    })



    const matchJavascriptObjectInDb:MatchJavascriptObjectInTesting = async (object, filter, schema) => {

        return await runner.sequentialTest(async (runner, db, schemaName, schemaScope) => {

            const pm = new PropertyTranslatorPgJsonbSchema(schema, 'recordColumn');

            await db.exec(`CREATE TABLE IF NOT EXISTS ${schemaScope('test_table_123')} (pk SERIAL PRIMARY KEY, recordColumn JSONB NOT NULL)`);

            await db.query(`INSERT INTO ${schemaScope('test_table_123')} (recordColumn) VALUES($1::jsonb)`, [JSON.stringify(object)]);

            let clause:PreparedWhereClauseResult | undefined;
            try {
                clause = prepareWhereClauseForPg(filter, pm);

            } catch(e) {
                if( e instanceof Error ) {
                    if( e.message.toLowerCase().indexOf('unsupported')>-1 ) {
                        return undefined;
                    }
                }
                debugger;
                throw e;
            }

            if( !clause.success ) {
                // Check for path conversion errors (previously thrown as UNSAFE_WARNING)
                const msg = clause.errors.map(e => e.message).join('; ');
                if( msg.includes(UNSAFE_WARNING) ) {
                    return false;
                }
                // Re-throw validation errors so standardTests error-handling tests still work.
                // Capability-gap errors (e.g. $regex on SQLite) return undefined to skip.
                if( msg.toLowerCase().includes('not well-defined') ) {
                    throw new Error(msg);
                }
                return undefined;
            }

            let queryStr:string;
            if( clause.where_clause_statement ) {
                queryStr = `SELECT * FROM ${schemaScope('test_table_123')} WHERE ${clause.where_clause_statement}`;
            } else {
                queryStr = `SELECT * FROM ${schemaScope('test_table_123')}`;
            }

            try {
                const result = await db.query(queryStr, clause.statement_arguments);

                const rows = result.rows;

                return rows.length>0;
            } catch(e) {
                debugger;
                throw e;
            }
        } )

    }

    standardTests({
        test,
        expect,
        matchJavascriptObject:matchJavascriptObjectInDb,
        implementationName: 'postgres'
    })

    // A multi-scalar union field (boolean|number|string|null) must compare by strict JSON value-equality —
    // JSON `true` ≠ `1` ≠ `"true"` — reproducing matchJavascriptObject's `===`. A first-arm typed cast
    // (`::boolean`) would coerce `1`/`"true"` to true and cast-error on other strings. The standard battery's
    // one-object-per-call adapter cannot express this, so it is pinned directly here.
    describe('multi-scalar union field compares by strict JSON value-equality', () => {
        const SecretSchema = z.object({ id: z.string(), secret: z.union([z.boolean(), z.number(), z.string(), z.null()]) });

        test('the boolean-true row matches { secret: true }', async () => {
            expect(await matchJavascriptObjectInDb({ id: '1', secret: true }, { secret: true }, SecretSchema)).toBe(true);
        });
        test('the numeric-1 row does NOT match { secret: true } (no loose boolean coercion)', async () => {
            expect(await matchJavascriptObjectInDb({ id: '2', secret: 1 }, { secret: true }, SecretSchema)).toBe(false);
        });
        test('the string-"true" row does NOT match { secret: true }', async () => {
            expect(await matchJavascriptObjectInDb({ id: '3', secret: 'true' }, { secret: true }, SecretSchema)).toBe(false);
        });
        test('an arbitrary string row does NOT match and does NOT cast-error', async () => {
            expect(await matchJavascriptObjectInDb({ id: '4', secret: 'classified' }, { secret: true }, SecretSchema)).toBe(false);
        });
        test('the boolean-false row does NOT match { secret: true }', async () => {
            expect(await matchJavascriptObjectInDb({ id: '5', secret: false }, { secret: true }, SecretSchema)).toBe(false);
        });
        test('the null row does NOT match { secret: true } (and does not error)', async () => {
            expect(await matchJavascriptObjectInDb({ id: '6', secret: null }, { secret: true }, SecretSchema)).toBe(false);
        });
        test('a string row matches the same-typed string filter (strict per-type equality)', async () => {
            expect(await matchJavascriptObjectInDb({ id: '7', secret: 'hush' }, { secret: 'hush' }, SecretSchema)).toBe(true);
        });
        test('a numeric row matches the same-typed numeric filter', async () => {
            expect(await matchJavascriptObjectInDb({ id: '8', secret: 7 }, { secret: 7 }, SecretSchema)).toBe(true);
        });
        test('$in over mixed scalar types matches only the exact-typed value', async () => {
            // { secret: { $in: ['hush', 7] } }: a string-"hush" row and a numeric-7 row match; a string-"7" row does not.
            expect(await matchJavascriptObjectInDb({ id: '9', secret: 'hush' }, { secret: { $in: ['hush', 7] } }, SecretSchema)).toBe(true);
            expect(await matchJavascriptObjectInDb({ id: '10', secret: 7 }, { secret: { $in: ['hush', 7] } }, SecretSchema)).toBe(true);
            expect(await matchJavascriptObjectInDb({ id: '11', secret: '7' }, { secret: { $in: ['hush', 7] } }, SecretSchema)).toBe(false);
        });
    });

    // A scalar|object union has NO array arm, so the emitter never faces the irreversible spread-vs-cast choice that
    // makes a field unrepresentable — which is precisely why findShapeAmbiguousPaths does NOT reject it. The standing
    // proof of that decision: for such a field the SQL result must AGREE with the value-driven matcher, or fail
    // LOUDLY (a rejected filter / a database error) — it must NEVER silently return a different boolean. Tested in
    // both arm orders, because the emitter (unlike the order-invariant detector) could be sensitive to arm order. A
    // silent disagreement here would mean scalar|object must be flagged after all — this guards the rule choice.
    describe('a scalar|object union is never silently wrong (the reason it is deliberately not rejected)', () => {
        const ScalarThenObject = z.object({ id: z.string(), k: z.union([z.string(), z.object({ a: z.string() })]) });
        const ObjectThenScalar = z.object({ id: z.string(), k: z.union([z.object({ a: z.string() }), z.string()]) });
        type Row = z.infer<typeof ScalarThenObject>;

        const stringRow: Row = { id: '1', k: 'foo' };
        const objectRow: Row = { id: '2', k: { a: '1' } };
        const stringFilter: WhereFilterDefinition<Row> = { k: 'foo' };
        const objectFilter: WhereFilterDefinition<Row> = { k: { a: '1' } };

        // The SQL verdict, or 'loud' when the filter is rejected at compile time or the query errors — both acceptable.
        const sqlVerdict = (object: Row, filter: WhereFilterDefinition<Row>, schema: z.ZodType<Row>): Promise<boolean | 'loud'> =>
            runner.sequentialTest(async (runner, db, schemaName, schemaScope) => {
                const pm = new PropertyTranslatorPgJsonbSchema(schema, 'recordColumn');
                await db.exec(`CREATE TABLE IF NOT EXISTS ${schemaScope('test_table_123')} (pk SERIAL PRIMARY KEY, recordColumn JSONB NOT NULL)`);
                await db.query(`INSERT INTO ${schemaScope('test_table_123')} (recordColumn) VALUES($1::jsonb)`, [JSON.stringify(object)]);
                let clause: PreparedWhereClauseResult;
                try { clause = prepareWhereClauseForPg(filter, pm); } catch { return 'loud'; }
                if (!clause.success) return 'loud';
                const sql = clause.where_clause_statement
                    ? `SELECT * FROM ${schemaScope('test_table_123')} WHERE ${clause.where_clause_statement}`
                    : `SELECT * FROM ${schemaScope('test_table_123')}`;
                try {
                    const result = await db.query(sql, clause.statement_arguments);
                    return result.rows.length > 0;
                } catch { return 'loud'; }
            });

        const assertAgreesOrLoud = async (object: Row, filter: WhereFilterDefinition<Row>, schema: z.ZodType<Row>): Promise<void> => {
            const js = matchJavascriptObject(object, filter);
            const sql = await sqlVerdict(object, filter, schema);
            if (sql !== 'loud') expect(sql).toBe(js);
        };

        for (const [order, schema] of [['scalar arm first', ScalarThenObject], ['object arm first', ObjectThenScalar]] as const) {
            test(`a string-valued row agrees-or-loud against the string and the object filter (${order})`, async () => {
                await assertAgreesOrLoud(stringRow, stringFilter, schema);
                await assertAgreesOrLoud(stringRow, objectFilter, schema);
            });
            test(`an object-valued row agrees-or-loud against the object and the string filter (${order})`, async () => {
                await assertAgreesOrLoud(objectRow, objectFilter, schema);
                await assertAgreesOrLoud(objectRow, stringFilter, schema);
            });
        }
    });

    // The cross-arm fix makes the detector report a NESTED multi-scalar path: `k.a` is a string in one object arm
    // and a number in the other. The emitter must build the strict JSON value-equality comparison for that nested
    // path just as it does for a top-level one — a numeric `7` must not match a string `"7"` row, and vice versa.
    describe('a nested cross-arm multi-scalar path compares by strict JSON value-equality', () => {
        const NestedMultiScalar = z.object({ k: z.union([z.object({ a: z.string() }), z.object({ a: z.number() })]) });

        test('a numeric nested value matches a same-typed numeric filter', async () => {
            expect(await matchJavascriptObjectInDb({ k: { a: 7 } }, { 'k.a': 7 }, NestedMultiScalar)).toBe(true);
        });
        test('a string nested value of the same digits does NOT match the numeric filter', async () => {
            expect(await matchJavascriptObjectInDb({ k: { a: '7' } }, { 'k.a': 7 }, NestedMultiScalar)).toBe(false);
        });
    });

    // A nullable array (a union of a null/literal-null arm and an array arm) is the one array/non-array union
    // that is NOT shape-ambiguous, so it reaches the emitter. The schema-tree's flat map must keep the array
    // shape regardless of which arm the union declares first; otherwise a leading null arm masks the array, the
    // field looks scalar, and PG errors on the unsupported literal path — diverging from the value-driven JS
    // matcher, which spreads the array and matches by containment.
    describe('a nullable array does array containment regardless of union arm order', () => {
        const NullFirst = z.object({ id: z.string(), tags: z.union([z.literal(null), z.array(z.string())]) });
        const ArrayFirst = z.object({ id: z.string(), tags: z.union([z.array(z.string()), z.literal(null)]) });

        test('an array row matches element containment when the null arm is declared first', async () => {
            expect(await matchJavascriptObjectInDb({ id: '1', tags: ['a', 'b'] }, { tags: { $elemMatch: 'a' } }, NullFirst)).toBe(true);
            expect(await matchJavascriptObjectInDb({ id: '2', tags: ['a', 'b'] }, { tags: { $elemMatch: 'z' } }, NullFirst)).toBe(false);
        });
        test('an array row matches element containment when the array arm is declared first (regression: always worked)', async () => {
            expect(await matchJavascriptObjectInDb({ id: '3', tags: ['a', 'b'] }, { tags: { $elemMatch: 'a' } }, ArrayFirst)).toBe(true);
        });
    });

    // A multi-scalar union BELOW an array is reached via the array spread, which supplies a spread-element
    // identifier. The strict raw-JSON value comparison (JSON true ≠ 1 ≠ "true", 7 ≠ "7") must apply to that
    // spread element too — matching matchJavascriptObject's `===`. Without it the spread falls back to a typed
    // cast: a boolean filter emits an invalid `text = boolean`, and a numeric filter coerces a string element.
    describe('a multi-scalar value inside an array compares by strict JSON value-equality through the spread', () => {
        const Schema = z.object({ id: z.string(), secrets: z.array(z.union([z.boolean(), z.number(), z.string(), z.null()])) });
        type Row = z.infer<typeof Schema>;

        test('a boolean-true element matches an $eq boolean filter; numeric 1 and string "true" do not', async () => {
            // Boolean is only expressible via $eq (a bare scalar filter value is string|number); this still
            // exercises the spread→strict path that previously emitted an invalid `text = boolean`.
            expect(await matchJavascriptObjectInDb<Row>({ id: '1', secrets: [true] }, { secrets: { $elemMatch: { $eq: true } } }, Schema)).toBe(true);
            expect(await matchJavascriptObjectInDb<Row>({ id: '2', secrets: [1] }, { secrets: { $elemMatch: { $eq: true } } }, Schema)).toBe(false);
            expect(await matchJavascriptObjectInDb<Row>({ id: '3', secrets: ['true'] }, { secrets: { $elemMatch: { $eq: true } } }, Schema)).toBe(false);
        });
        test('a numeric element matches an $elemMatch numeric filter; a string of the same digits does not', async () => {
            expect(await matchJavascriptObjectInDb<Row>({ id: '4', secrets: [7] }, { secrets: { $elemMatch: 7 } }, Schema)).toBe(true);
            expect(await matchJavascriptObjectInDb<Row>({ id: '5', secrets: ['7'] }, { secrets: { $elemMatch: 7 } }, Schema)).toBe(false);
        });
        test('a plain-scalar containment filter on the array is also strict (numeric 7 does not match a string "7" element)', async () => {
            expect(await matchJavascriptObjectInDb<Row>({ id: '6', secrets: [7] }, { secrets: 7 }, Schema)).toBe(true);
            expect(await matchJavascriptObjectInDb<Row>({ id: '7', secrets: ['7'] }, { secrets: 7 }, Schema)).toBe(false);
        });
    });

    // The array operators $in/$nin/$all return from the array-spread branch via the text identifier, BEFORE the
    // multi-scalar raw path — so for a mixed-scalar element array `['7']` would wrongly match `{ $in: [7] }`. When
    // the element path is multi-scalar they must compare the raw JSON element value (numeric 7 ≠ string "7"),
    // matching matchJavascriptObject's intersection/`===` semantics.
    describe('mixed-scalar array operators ($in/$nin/$all) compare the raw element value', () => {
        const Schema = z.object({ id: z.string(), tags: z.array(z.union([z.number(), z.string()])) });
        type Row = z.infer<typeof Schema>;

        test('$in: a numeric element matches { $in: [7] }; a string "7" element does not', async () => {
            expect(await matchJavascriptObjectInDb<Row>({ id: '1', tags: [7] }, { tags: { $in: [7] } }, Schema)).toBe(true);
            expect(await matchJavascriptObjectInDb<Row>({ id: '2', tags: ['7'] }, { tags: { $in: [7] } }, Schema)).toBe(false);
            // and symmetrically, the string element matches the string filter
            expect(await matchJavascriptObjectInDb<Row>({ id: '3', tags: ['7'] }, { tags: { $in: ['7'] } }, Schema)).toBe(true);
        });

        test('$nin: a numeric element is excluded by { $nin: [7] }; a string "7" element is not', async () => {
            expect(await matchJavascriptObjectInDb<Row>({ id: '4', tags: [7] }, { tags: { $nin: [7] } }, Schema)).toBe(false);
            expect(await matchJavascriptObjectInDb<Row>({ id: '5', tags: ['7'] }, { tags: { $nin: [7] } }, Schema)).toBe(true);
        });

        test('$all: a numeric element satisfies { $all: [7] }; a string "7" element does not', async () => {
            expect(await matchJavascriptObjectInDb<Row>({ id: '6', tags: [7] }, { tags: { $all: [7] } }, Schema)).toBe(true);
            expect(await matchJavascriptObjectInDb<Row>({ id: '7', tags: ['7'] }, { tags: { $all: [7] } }, Schema)).toBe(false);
        });
    });

    // G2: a `string | enum(numericEnum)` field is multi-scalar (a numeric enum is a number, not a string), so a
    // numeric member must not match a string of the same digits, matching matchJavascriptObject's `===`.
    describe('a string | numeric-enum field compares by strict JSON value-equality', () => {
        enum Code { Zero = 0, One = 1 }
        const Schema = z.object({ id: z.string(), kind: z.union([z.string(), z.enum(Code)]) });
        type Row = z.infer<typeof Schema>;

        test('a numeric-enum 0 row matches { kind: 0 } but not a string "0" row', async () => {
            expect(await matchJavascriptObjectInDb<Row>({ id: '1', kind: 0 }, { kind: 0 }, Schema)).toBe(true);
            expect(await matchJavascriptObjectInDb<Row>({ id: '2', kind: '0' }, { kind: 0 }, Schema)).toBe(false);
        });
        test('a string "0" row matches { kind: "0" } but the numeric-enum 0 row does not', async () => {
            expect(await matchJavascriptObjectInDb<Row>({ id: '3', kind: '0' }, { kind: '0' }, Schema)).toBe(true);
            expect(await matchJavascriptObjectInDb<Row>({ id: '4', kind: 0 }, { kind: '0' }, Schema)).toBe(false);
        });
    });

    // A bare `{ secret: null }` filter arrives as `filter === null`, not `{ $eq: null }`, so it misses the
    // multi-scalar branch's operator guards and falls through to the first-arm typed cast — e.g.
    // `((col->>'secret')::boolean) IS NULL`, which cast-errors on a string/number row. A null filter on a
    // multi-scalar field must match JSON null (and a missing path) and return false for any other type,
    // never erroring — matching matchJavascriptObject.
    describe('a bare null filter on a multi-scalar field matches null without cast-erroring on other types', () => {
        const SecretSchema = z.object({ id: z.string(), secret: z.union([z.boolean(), z.number(), z.string(), z.null()]) });
        type Row = z.infer<typeof SecretSchema>;
        // where-filter's type narrows null out of a field's filter value, but the runtime accepts a bare
        // Mongo-style `{ field: null }` (the exact F4 path); cast through unknown to exercise that contract.
        const nullFilter = { secret: null } as unknown as WhereFilterDefinition<Row>;

        test('a null row matches { secret: null }', async () => {
            expect(await matchJavascriptObjectInDb<Row>({ id: '1', secret: null }, nullFilter, SecretSchema)).toBe(true);
        });
        test('a string row does NOT match { secret: null } and does not cast-error', async () => {
            expect(await matchJavascriptObjectInDb<Row>({ id: '2', secret: 'hush' }, nullFilter, SecretSchema)).toBe(false);
        });
        test('a boolean row does NOT match { secret: null } and does not cast-error', async () => {
            expect(await matchJavascriptObjectInDb<Row>({ id: '3', secret: true }, nullFilter, SecretSchema)).toBe(false);
        });
        test('a numeric row does NOT match { secret: null }', async () => {
            expect(await matchJavascriptObjectInDb<Row>({ id: '4', secret: 7 }, nullFilter, SecretSchema)).toBe(false);
        });
    });

    // The multi-scalar strict branch handles $ne/$eq before the existing NaN short-circuit, so it must apply the
    // same rule (MONGO-DIVERGENCES §7): NaN equals nothing, so { $ne: NaN } matches every row and { $eq: NaN }
    // matches none. Without it the branch builds `!= to_jsonb(NaN)` — NULL/erroring — and wrongly rejects rows.
    describe('a NaN filter on a multi-scalar field follows the NaN short-circuit contract', () => {
        const SecretSchema = z.object({ id: z.string(), secret: z.union([z.boolean(), z.number(), z.string(), z.null()]) });
        type Row = z.infer<typeof SecretSchema>;

        test('{ $ne: NaN } matches every row (NaN equals nothing, so nothing is excluded) — including a JSON-null row', async () => {
            expect(await matchJavascriptObjectInDb<Row>({ id: '1', secret: 7 }, { secret: { $ne: NaN } }, SecretSchema)).toBe(true);
            expect(await matchJavascriptObjectInDb<Row>({ id: '2', secret: 'hush' }, { secret: { $ne: NaN } }, SecretSchema)).toBe(true);
            expect(await matchJavascriptObjectInDb<Row>({ id: '3', secret: true }, { secret: { $ne: NaN } }, SecretSchema)).toBe(true);
            expect(await matchJavascriptObjectInDb<Row>({ id: '5', secret: null }, { secret: { $ne: NaN } }, SecretSchema)).toBe(true);
        });
        test('{ $eq: NaN } matches no row (nothing equals NaN) — including a JSON-null row', async () => {
            expect(await matchJavascriptObjectInDb<Row>({ id: '4', secret: 7 }, { secret: { $eq: NaN } }, SecretSchema)).toBe(false);
            expect(await matchJavascriptObjectInDb<Row>({ id: '6', secret: null }, { secret: { $eq: NaN } }, SecretSchema)).toBe(false);
        });
    });

    // The $not handler builds its outer null-guard from the first-arm cast (e.g. `((col->>'secret')::boolean) IS
    // NULL`), which cast-errors on a row of another scalar kind — even though the inner comparison is already raw.
    // On a multi-scalar field the guard must read the raw (uncast) JSONB, mirroring the bare-null fix.
    describe('a $not on a multi-scalar field does not cast-error on a row of another scalar kind', () => {
        const BoolFirst = z.object({ id: z.string(), secret: z.union([z.boolean(), z.number(), z.string(), z.null()]) });
        const StringFirst = z.object({ id: z.string(), secret: z.union([z.string(), z.number(), z.boolean(), z.null()]) });
        type Row = z.infer<typeof BoolFirst>;

        test('boolean-first union: { $not: { $eq: true } } matches a string row (without cast-erroring) and excludes the true row', async () => {
            expect(await matchJavascriptObjectInDb<Row>({ id: '1', secret: 'hush' }, { secret: { $not: { $eq: true } } }, BoolFirst)).toBe(true);
            expect(await matchJavascriptObjectInDb<Row>({ id: '2', secret: 7 }, { secret: { $not: { $eq: true } } }, BoolFirst)).toBe(true);
            expect(await matchJavascriptObjectInDb<Row>({ id: '3', secret: true }, { secret: { $not: { $eq: true } } }, BoolFirst)).toBe(false);
        });

        test('string-first union (the other arm order): { $not: { $eq: true } } matches a numeric row and excludes the true row', async () => {
            expect(await matchJavascriptObjectInDb<Row>({ id: '4', secret: 7 }, { secret: { $not: { $eq: true } } }, StringFirst)).toBe(true);
            expect(await matchJavascriptObjectInDb<Row>({ id: '5', secret: true }, { secret: { $not: { $eq: true } } }, StringFirst)).toBe(false);
        });
    });

})
