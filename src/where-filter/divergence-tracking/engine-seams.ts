/**
 * Runs one `(object, filter, schema)` triple against each where-filter engine and returns a typed
 * `EngineVerdict`, so a divergence-pinning test can assert not only *whether* an engine matched but
 * *how* it declined — a typed refusal code, an environmental limit, or a throw.
 *
 * The conformance battery's engine adapters (`sql/sqlite/prepareWhereClauseForSqlite.test.ts`,
 * `sql/postgres/prepareWhereClauseForPg.test.ts`) are the narrower siblings of these seams: they
 * collapse the same classification to `boolean | undefined` for the battery's seam contract, which
 * would erase exactly the refusal kinds the divergence tests pin.
 */
import Database from "better-sqlite3";
import { beforeAll, afterEach } from "vitest";
import type { ZodSchema } from "zod";
import matchJavascriptObject from "../matchJavascriptObject.ts";
import type { MatchJavascriptObjectOptions, WhereFilterDefinition } from "../types.ts";
import { prepareWhereClauseForSqlite, PropertyTranslatorSqliteJsonSchema } from "../sql/sqlite/index.ts";
import { prepareWhereClauseForPg, PropertyTranslatorPgJsonbSchema } from "../sql/postgres/index.ts";
import { acquireSchema, warmUp, disposeAllForTest, runQueryWithHeapGuard } from "../sql/postgres/testSchemaPartition.ts";
import { classifyWhereClauseErrors, classifyInsertError, type ConformanceOutcome } from "../standard-tests/outcomes.ts";
import type { PreparedWhereClauseResult } from "../sql/types.ts";

/**
 * What one engine answered for one `(object, filter, schema)` triple: a `ConformanceOutcome`
 * (`matched` / `unsupported` / `rejected` / `environmental`), or `threw` when the engine raised
 * instead of returning a typed result (the value-driven matcher's loud-rejection channel).
 */
export type EngineVerdict = ConformanceOutcome | { readonly kind: 'threw'; readonly message: string };

export type EngineName = 'js' | 'sqlite' | 'postgres';

/** Shorthand for the `matched` verdict, keeping assertions like `expect(v).toEqual(matched(true))` readable. */
export function matched(value: boolean): EngineVerdict & { kind: 'matched' } {
    return { kind: 'matched', value };
}

function threw(e: unknown): EngineVerdict & { kind: 'threw' } {
    return { kind: 'threw', message: e instanceof Error ? e.message : String(e) };
}

/**
 * The value-driven JS matcher. The schema parameter is accepted for seam uniformity but ignored
 * unless `options.universalSchemaConformance` is passed explicitly by the caller.
 */
export async function matchOnJs<T extends Record<string, unknown>>(
    object: T,
    filter: WhereFilterDefinition<T>,
    _schema: ZodSchema<T>,
    options?: MatchJavascriptObjectOptions<T>
): Promise<EngineVerdict> {
    try {
        return matched(matchJavascriptObject(object, filter, options));
    } catch (e) {
        return threw(e);
    }
}

/** The schema-driven SQLite engine: insert into an in-memory table, compile the filter, run it. */
export async function matchOnSqlite<T extends Record<string, unknown>>(
    object: T,
    filter: WhereFilterDefinition<T>,
    schema: ZodSchema<T>
): Promise<EngineVerdict> {
    const db = new Database(':memory:');
    try {
        db.exec('CREATE TABLE test_table (pk INTEGER PRIMARY KEY AUTOINCREMENT, recordColumn TEXT NOT NULL)');
        db.prepare('INSERT INTO test_table (recordColumn) VALUES (?)').run(JSON.stringify(object));

        let clause: PreparedWhereClauseResult;
        try {
            const pm = new PropertyTranslatorSqliteJsonSchema(schema, 'recordColumn');
            clause = prepareWhereClauseForSqlite(filter, pm);
        } catch (e) {
            return threw(e);
        }
        if (!clause.success) {
            return classifyWhereClauseErrors(clause.errors);
        }

        const queryStr = clause.where_clause_statement
            ? `SELECT * FROM test_table WHERE ${clause.where_clause_statement}`
            : `SELECT * FROM test_table`;
        const rows = db.prepare(queryStr).all(...clause.statement_arguments);
        return matched(rows.length > 0);
    } finally {
        db.close();
    }
}

/** The schema-driven Postgres engine, on the shared PGlite instance (see `usePostgresLifecycle`). */
export async function matchOnPostgres<T extends Record<string, unknown>>(
    object: T,
    filter: WhereFilterDefinition<T>,
    schema: ZodSchema<T>
): Promise<EngineVerdict> {
    const json = JSON.stringify(object);
    const { client, table } = await acquireSchema(json.length);

    try {
        await client.query(`INSERT INTO ${table} (recordColumn) VALUES($1::jsonb)`, [json]);
    } catch (e) {
        // A recognised platform limit (U+0000 unstorable) is a typed environmental verdict; any other
        // insert failure is a real fault.
        const env = classifyInsertError(e);
        if (env) return env;
        throw e;
    }

    let clause: PreparedWhereClauseResult;
    try {
        const pm = new PropertyTranslatorPgJsonbSchema(schema, 'recordColumn');
        clause = prepareWhereClauseForPg(filter, pm);
    } catch (e) {
        return threw(e);
    }
    if (!clause.success) {
        return classifyWhereClauseErrors(clause.errors);
    }

    const queryStr = clause.where_clause_statement
        ? `SELECT * FROM ${table} WHERE ${clause.where_clause_statement}`
        : `SELECT * FROM ${table}`;
    const result = await runQueryWithHeapGuard(client, table, json, queryStr, clause.statement_arguments);
    return matched(result.rows.length > 0);
}

type EngineSeam = {
    readonly name: EngineName;
    readonly match: <T extends Record<string, unknown>>(
        object: T,
        filter: WhereFilterDefinition<T>,
        schema: ZodSchema<T>
    ) => Promise<EngineVerdict>;
};

/** Every engine, for `test.each` sweeps where a divergence is uniform across them. */
export const allEngines: readonly EngineSeam[] = [
    { name: 'js', match: matchOnJs },
    { name: 'sqlite', match: matchOnSqlite },
    { name: 'postgres', match: matchOnPostgres },
];

/** The SQL engines only, for pinning the value-driven-JS vs schema-driven-SQL side of a split. */
export const sqlEngines: readonly EngineSeam[] = allEngines.filter(e => e.name !== 'js');

/**
 * Registers the shared-PGlite lifecycle hooks for the current test file. Call once at module scope
 * in any file whose tests reach `matchOnPostgres` (directly or via `allEngines`): PGlite is a
 * singleton for the file that must be warmed once, never cold-booted per test.
 */
export function usePostgresLifecycle(): void {
    beforeAll(warmUp);
    afterEach(disposeAllForTest);
}
