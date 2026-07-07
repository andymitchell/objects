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

/** Lazily-constructed module-level singleton in-memory PGlite. */
export function getSharedPgClient(): PGlite {
    if (sharedClient === null) {
        sharedClient = new PGlite();
    }
    return sharedClient;
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
    const client = getSharedPgClient();
    const schemaName = `t_${crypto.randomUUID().replaceAll('-', '')}`;
    await client.exec(`CREATE SCHEMA "${schemaName}"; CREATE TABLE "${schemaName}".test_table (pk SERIAL PRIMARY KEY, recordColumn JSONB NOT NULL);`);
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
