import { PGlite } from '@electric-sql/pglite';

/**
 * Test-only isolation primitive for the Postgres where-clause conformance harness.
 *
 * Why: booting a fresh PGlite (WASM heap) per test costs ~1s. This module owns a single shared PGlite and
 * a single reused table, and clears the table (`TRUNCATE`) before each match call — so a
 * `SELECT ... WHERE <clause>` sees only that call's one row, without paying a fresh-WASM boot per test.
 *
 * Why a reused table rather than a fresh schema per call: `CREATE SCHEMA`/`DROP SCHEMA CASCADE` churn grows
 * PGlite's WASM heap (catalog allocations it never returns to the OS), so over a long file — and especially
 * under the fuzz load's thousands of calls — a late large insert (e.g. a 1MB value) can silently fail to
 * round-trip. `TRUNCATE` reuses the same table and reclaims row storage, keeping the heap flat so the last
 * test behaves like the first. One row at a time means schema-per-call isolation is stronger than needed.
 *
 * Usage in the harness file:
 *   beforeAll(warmUp);              // pre-pay the one-time WASM init + table creation off the first test
 *   afterEach(disposeAllForTest);   // no-op: the table is cleared on the next acquire
 * The match adapter calls `acquireSchema()` per call; it returns an already-empty table to insert into.
 */

let sharedClient: PGlite | null = null;
let tableReady = false;

const SCHEMA = 't_shared';
const TABLE = `"${SCHEMA}".test_table`;

/**
 * Rebuild the shared PGlite before inserting a payload at least this many bytes.
 *
 * PGlite's WASM heap grows with query volume and does not shrink; a *large* insert on an accumulated heap
 * trips `RuntimeError: memory access out of bounds` (a fresh instance handles the same value fine). Crucially
 * the crash needs BOTH accumulation and a large insert — thousands of small inserts (every ordinary test and
 * the entire fuzz) never trip it. So rebuilding only when a genuinely large payload is about to be inserted
 * gives that one test a fresh heap at zero cost to everything else. The harness passes the byte size it has
 * already computed for the insert.
 */
const REBUILD_BEFORE_PAYLOAD_BYTES = 200_000;

/** Lazily-constructed module-level singleton in-memory PGlite. */
export function getSharedPgClient(): PGlite {
    if (sharedClient === null) {
        sharedClient = new PGlite();
        tableReady = false;
    }
    return sharedClient;
}

/**
 * Ensure the shared schema + table exist on the current client.
 *
 * The column is created UNQUOTED (`recordColumn` → folds to `recordcolumn`) to match
 * `PropertyTranslatorPgJsonbSchema`, which emits an unquoted `recordColumn->…` accessor; a quoted
 * `"recordColumn"` column would not resolve against that folded reference.
 */
async function ensureTable(client: PGlite): Promise<void> {
    if (tableReady) return;
    await client.exec(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"; CREATE TABLE IF NOT EXISTS "${SCHEMA}".test_table (pk SERIAL PRIMARY KEY, recordColumn JSONB NOT NULL);`);
    tableReady = true;
}

/**
 * Clear the shared table and return it ready for one row.
 *
 * Recovers from a poisoned instance: a single fatal statement (e.g. inserting a JSON string containing
 * U+0000) can abort the PGlite WASM instance outright (`RuntimeError: Aborted()`). Because the instance is
 * shared, that would otherwise cascade into a failure for every subsequent test. On any failure here the
 * client is rebuilt once and the acquire retried, so the damage stays contained to the test that triggered
 * it (which still correctly reds).
 */
export async function acquireSchema(payloadBytes = 0, forceRebuild = false): Promise<{ client: PGlite; schemaName: string; table: string; dispose: () => Promise<void> }> {
    // A large insert — or, via `forceRebuild`, a large query the caller is about to run — on an accumulated heap
    // can crash the WASM instance; give it a fresh one first.
    if ((forceRebuild || payloadBytes >= REBUILD_BEFORE_PAYLOAD_BYTES) && sharedClient !== null) {
        const old = sharedClient;
        sharedClient = null;
        tableReady = false;
        try { await old.close(); } catch { /* a dead instance cannot be closed */ }
    }
    let client = getSharedPgClient();
    try {
        await ensureTable(client);
        await client.exec(`TRUNCATE ${TABLE} RESTART IDENTITY;`);
    } catch {
        // The shared instance is likely dead (a prior fatal statement aborted the WASM). Rebuild once and
        // retry; if this second attempt also fails, the error is real and propagates.
        sharedClient = null;
        tableReady = false;
        client = getSharedPgClient();
        await ensureTable(client);
        await client.exec(`TRUNCATE ${TABLE} RESTART IDENTITY;`);
    }
    return {
        client,
        schemaName: SCHEMA,
        table: TABLE,
        dispose: async () => { /* no-op: the next acquire truncates */ },
    };
}

/**
 * A query at or above this many bound arguments gets a fresh heap before it runs.
 *
 * A very wide clause (e.g. a 1000-key implicit `$and` over a record) can abort an accumulated PGlite heap at
 * query time with `memory access out of bounds`, though a fresh heap runs the identical query fine — the same
 * failure mode {@link acquireSchema} already rebuilds for on a large insert.
 */
const HEAP_GUARD_REBUILD_ARG_COUNT = 256;

/**
 * Run one prepared SELECT against the shared PGlite, rebuilding the heap first for a very wide query so its true
 * verdict surfaces rather than being swallowed into a crash. A query below the argument threshold runs on the
 * client the row was inserted into; a wide one gets a fresh instance with its single row re-inserted.
 *
 * @param client The client the single row was inserted into (used when no rebuild is needed).
 * @param table The fully-qualified shared table, so the row can be re-inserted after a rebuild.
 * @param json The single row's JSON, re-inserted verbatim after a rebuild.
 * @param queryStr The SELECT to execute.
 * @param args The clause's bound arguments; their count decides whether a rebuild is warranted.
 * @returns The query result; the caller reads `rows.length` for the match verdict.
 */
export async function runQueryWithHeapGuard(client: PGlite, table: string, json: string, queryStr: string, args: unknown[]): Promise<{ rows: unknown[] }> {
    let queryClient = client;
    if (args.length >= HEAP_GUARD_REBUILD_ARG_COUNT) {
        ({ client: queryClient } = await acquireSchema(0, true));
        await queryClient.query(`INSERT INTO ${table} (recordColumn) VALUES($1::jsonb)`, [json]);
    }
    return queryClient.query(queryStr, args);
}

/** No-op: the shared table is cleared on the next {@link acquireSchema}. Kept for the `afterEach` contract. */
export async function disposeAllForTest(): Promise<void> {
    // Intentionally empty — see the module note.
}

/** Force the one-time WASM init + table creation off the first test (cycle-0 is ~1s; later ops are ms-scale). Call in `beforeAll`. */
export async function warmUp(): Promise<void> {
    await ensureTable(getSharedPgClient());
}
