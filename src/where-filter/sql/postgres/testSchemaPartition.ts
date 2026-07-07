import { PGlite } from '@electric-sql/pglite';

/**
 * Test-only isolation primitive for the Postgres where-clause conformance harness.
 *
 * Why: booting a fresh PGlite (WASM heap) per test costs ~1s; minting a fresh PG schema over a
 * single shared PGlite is ~40× faster. This module owns the singleton and hands each match call an
 * isolated schema holding one row, so a `SELECT ... WHERE <clause>` sees only that call's object.
 *
 * Usage in the harness file:
 *   beforeAll(warmUp);              // pre-pay the one-time WASM init off the first test
 *   afterEach(disposeAllForTest);   // DROP every schema acquired during the test
 * The match adapter calls `acquireSchema()` per call; cleanup is tracked centrally so callers never
 * have to manage it.
 */

let sharedClient: PGlite | null = null;
const acquired: string[] = [];
let acquireCount = 0;

/**
 * Recycle the shared PGlite after this many acquisitions.
 *
 * Why: PGlite runs in a WASM heap that grows with churn and does not return memory to the OS after a
 * `DROP SCHEMA`. Over a long file, a large insert (e.g. a 1MB value) on an accumulated heap can silently
 * fail to round-trip — the row does not come back and an otherwise-correct match reads as `false`.
 * Recycling every N acquisitions caps the peak heap so late tests behave like early ones. N trades a
 * ~one-off rebuild cost against how much accumulation any single test can face.
 */
const RECYCLE_EVERY = 50;

/** Lazily-constructed module-level singleton in-memory PGlite. */
export function getSharedPgClient(): PGlite {
    if (sharedClient === null) {
        sharedClient = new PGlite();
    }
    return sharedClient;
}

/**
 * Drop the shared PGlite reference so the next {@link getSharedPgClient} builds a fresh one.
 *
 * Why: a single fatal statement (e.g. inserting a JSON string containing U+0000) can abort the PGlite
 * WASM instance outright (`RuntimeError: Aborted()`), leaving the shared singleton unusable. Because the
 * instance is shared across every test in the file, that one poisoning would otherwise cascade into a
 * failure for every subsequent test. Resetting lets the next acquire rebuild a clean instance so the
 * damage stays contained to the test that triggered it. The dead instance's schemas died with it, so the
 * pending-cleanup list is cleared too. Does NOT close the old instance — the caller is a poison-recovery
 * path where the instance is already dead; use {@link recycleSharedClient} to retire a live instance.
 */
function resetSharedClient(): void {
    sharedClient = null;
    acquired.length = 0;
}

/** Retire a still-live shared instance (closing it to free its WASM heap) so the next acquire rebuilds. */
async function recycleSharedClient(): Promise<void> {
    const old = sharedClient;
    resetSharedClient();
    if (old) {
        try { await old.close(); } catch { /* best-effort; a dead instance cannot be closed */ }
    }
}

/**
 * Mint a fresh schema (`t_<uuid_no_dashes>`) with an empty `test_table`, and return the shared
 * client, the schema-qualified table name, and a dispose closure.
 *
 * The column is created UNQUOTED (`recordColumn` → folds to `recordcolumn`) to match
 * `PropertyTranslatorPgJsonbSchema`, which emits an unquoted `recordColumn->…` accessor; a quoted
 * `"recordColumn"` column would not resolve against that folded reference.
 *
 * Schema name = `t_` + 32 hex chars = 34 chars: satisfies `/^[A-Za-z_][A-Za-z0-9_]*$/` and stays
 * under PG's 63-char identifier limit. The dispose closure is tracked centrally so
 * {@link disposeAllForTest} cleans up even when a caller forgets to dispose.
 */
export async function acquireSchema(): Promise<{ client: PGlite; schemaName: string; table: string; dispose: () => Promise<void> }> {
    // Bound the WASM heap by retiring a live instance every RECYCLE_EVERY acquisitions (between tests, so no
    // in-flight schema is lost). Keeps late, large-payload tests behaving like early ones.
    if (acquireCount > 0 && acquireCount % RECYCLE_EVERY === 0) {
        await recycleSharedClient();
    }
    acquireCount++;
    const schemaName = `t_${crypto.randomUUID().replaceAll('-', '')}`;
    const ddl = `CREATE SCHEMA "${schemaName}"; CREATE TABLE "${schemaName}".test_table (pk SERIAL PRIMARY KEY, recordColumn JSONB NOT NULL);`;
    let client = getSharedPgClient();
    try {
        await client.exec(ddl);
    } catch {
        // The shared instance is likely dead (a prior fatal statement aborted the WASM). Rebuild once and retry;
        // if this second attempt also fails, the error is real and propagates.
        resetSharedClient();
        client = getSharedPgClient();
        await client.exec(ddl);
    }
    acquired.push(schemaName);
    return {
        client,
        schemaName,
        table: `"${schemaName}".test_table`,
        dispose: async () => {
            await client.query(`DROP SCHEMA "${schemaName}" CASCADE`);
            const idx = acquired.indexOf(schemaName);
            if (idx !== -1) acquired.splice(idx, 1);
        },
    };
}

/**
 * Drop every schema acquired since the last call. Best-effort: per-schema failures are swallowed so
 * `afterEach` never throws and the next test still starts cleanly.
 */
export async function disposeAllForTest(): Promise<void> {
    if (sharedClient === null || acquired.length === 0) return;
    const client = sharedClient;
    const toDrop = acquired.splice(0, acquired.length);
    for (const schemaName of toDrop) {
        try {
            await client.query(`DROP SCHEMA "${schemaName}" CASCADE`);
        } catch {
            // Swallowed — best-effort cleanup; the next test starts fresh regardless.
        }
    }
}

/** Force the one-time WASM init cost off the first test (cycle-0 is ~1s; later cycles are ms-scale). Call in `beforeAll`. */
export async function warmUp(): Promise<void> {
    await getSharedPgClient().query('SELECT 1');
}
