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

/** No-op: the shared table is cleared on the next {@link acquireSchema}. Kept for the `afterEach` contract. */
export async function disposeAllForTest(): Promise<void> {
    // Intentionally empty — see the module note.
}

/** Force the one-time WASM init + table creation off the first test (cycle-0 is ~1s; later ops are ms-scale). Call in `beforeAll`. */
export async function warmUp(): Promise<void> {
    await ensureTable(getSharedPgClient());
}
