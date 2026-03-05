/**
 * Benchmark: Direct SQL vs Read-Modify-Write (RMW) for WriteAction operations.
 *
 * Run: npx tsx src/write-actions/writeActionSqlPerf.bench.ts
 * (Optional: node --expose-gc via tsx for GC control)
 */

import { PGlite } from '@electric-sql/pglite';
import { z } from 'zod';
import postgresWhereClauseBuilder, { PropertyMapSchema } from '../where-filter/postgresWhereClauseBuilder.ts';
import type { WhereFilterDefinition } from '../where-filter/types.ts';

// ─── DB Proxy (simulated network latency) ────────────────────────────────────

/** Minimal interface matching the PGlite methods we use. */
interface Db {
    query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
    exec(sql: string): Promise<void>;
}

function sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Wraps a PGlite instance, adding a simulated network round-trip delay per query/exec call. */
function createDbProxy(db: PGlite, latencyMs: number): Db {
    if (latencyMs <= 0) return db as unknown as Db;
    return {
        async query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
            await sleep(latencyMs);
            return db.query<T>(sql, params);
        },
        async exec(sql: string): Promise<void> {
            await sleep(latencyMs);
            return db.exec(sql);
        },
    };
}

// ─── Test Data Shape ─────────────────────────────────────────────────────────

const TestItemSchema = z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    status: z.enum(['active', 'inactive', 'pending']),
    score: z.number(),
    metadata: z.object({
        created_at: z.string(),
        updated_at: z.string(),
        tags: z.array(z.string()),
        settings: z.object({
            theme: z.string(),
            notifications: z.boolean(),
            language: z.string(),
        }),
    }),
});
type TestItem = z.infer<typeof TestItemSchema>;

// ─── Data Generation ─────────────────────────────────────────────────────────

function generateItem(i: number): TestItem {
    return {
        id: `item-${i}`,
        name: `User ${i}`,
        email: `user${i}@example.com`,
        status: (['active', 'inactive', 'pending'] as const)[i % 3]!,
        score: (i * 7) % 100,
        metadata: {
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-06-15T12:00:00Z',
            tags: [`tag-${i % 5}`, `tag-${(i * 3) % 8}`],
            settings: {
                theme: i % 2 === 0 ? 'dark' : 'light',
                notifications: i % 3 !== 0,
                language: 'en',
            },
        },
    };
}

// ─── DB Helpers ──────────────────────────────────────────────────────────────

const TABLE_DDL = `
CREATE TABLE items (
    pk TEXT PRIMARY KEY,
    data JSONB NOT NULL
);
CREATE INDEX idx_items_status ON items ((data->>'status'));
CREATE INDEX idx_items_score ON items ((data->>'score'));
`;

async function seedData(db: PGlite, count: number): Promise<void> {
    const batchSize = 500;
    for (let start = 0; start < count; start += batchSize) {
        const end = Math.min(start + batchSize, count);
        const values: string[] = [];
        for (let i = start; i < end; i++) {
            const item = generateItem(i);
            values.push(`('${item.id}', '${JSON.stringify(item).replace(/'/g, "''")}'::jsonb)`);
        }
        await db.exec(`INSERT INTO items (pk, data) VALUES ${values.join(',')}`);
    }
}

// ─── WHERE Clause Builder ────────────────────────────────────────────────────

const propertyMap = new PropertyMapSchema(TestItemSchema, 'data');

function buildWhereClause(where: WhereFilterDefinition<TestItem>) {
    const result = postgresWhereClauseBuilder(where, propertyMap);
    if (!result.success) {
        throw new Error(`WHERE clause build failed: ${JSON.stringify(result.errors)}`);
    }
    return result;
}

// ─── Direct SQL Builders ─────────────────────────────────────────────────────

function buildInsertSql(item: TestItem): { sql: string; params: (string | number | boolean | null)[] } {
    return {
        sql: 'INSERT INTO items (pk, data) VALUES ($1, $2::jsonb)',
        params: [item.id, JSON.stringify(item)],
    };
}

interface LeafPath {
    pgPath: string;   // e.g. '{score}' or '{metadata,updated_at}'
    value: unknown;
}

/** Flatten a partial object to leaf paths for jsonb_set chaining. */
function flattenToLeafPaths(obj: Record<string, unknown>, prefix: string[] = []): LeafPath[] {
    const leaves: LeafPath[] = [];
    for (const [key, value] of Object.entries(obj)) {
        const path = [...prefix, key];
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            leaves.push(...flattenToLeafPaths(value as Record<string, unknown>, path));
        } else {
            leaves.push({
                pgPath: `{${path.join(',')}}`,
                value,
            });
        }
    }
    return leaves;
}

function buildUpdateSql(
    updateData: Record<string, unknown>,
    where: WhereFilterDefinition<TestItem>,
): { sql: string; params: (string | number | boolean | null)[] } {
    const clause = buildWhereClause(where);
    const leaves = flattenToLeafPaths(updateData);

    // Build nested jsonb_set chain
    // Params: leaves first, then where clause args
    const params: (string | number | boolean | null)[] = [];
    let expr = 'data';
    let paramIdx = 1;

    for (const leaf of leaves) {
        params.push(JSON.stringify(leaf.value));
        expr = `jsonb_set(${expr}, '${leaf.pgPath}', $${paramIdx}::jsonb)`;
        paramIdx++;
    }

    // Offset where clause param indices
    const whereArgs = clause.statement_arguments;
    const offsetWhereClause = clause.where_clause_statement.replace(
        /\$(\d+)/g,
        (_, n) => `$${Number(n) + paramIdx - 1}`,
    );
    params.push(...whereArgs);

    return {
        sql: `UPDATE items SET data = ${expr} WHERE ${offsetWhereClause}`,
        params,
    };
}

function buildDeleteSql(
    where: WhereFilterDefinition<TestItem>,
): { sql: string; params: (string | number | boolean | null)[] } {
    const clause = buildWhereClause(where);
    return {
        sql: `DELETE FROM items WHERE ${clause.where_clause_statement}`,
        params: [...clause.statement_arguments],
    };
}

// ─── Deep Merge (simplified, no Zod — fair comparison with SQL path) ─────────

function deepMerge<T extends Record<string, unknown>>(target: T, source: Record<string, unknown>): T {
    const result = { ...target };
    for (const [key, value] of Object.entries(source)) {
        const targetVal = (result as Record<string, unknown>)[key];
        if (
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            targetVal !== null &&
            typeof targetVal === 'object' &&
            !Array.isArray(targetVal)
        ) {
            (result as Record<string, unknown>)[key] = deepMerge(
                targetVal as Record<string, unknown>,
                value as Record<string, unknown>,
            );
        } else {
            (result as Record<string, unknown>)[key] = value;
        }
    }
    return result;
}

// ─── Scenario Runners ────────────────────────────────────────────────────────

type Scenario = 'create' | 'update' | 'delete';

const UPDATE_DATA = { score: 99, metadata: { updated_at: '2025-01-01T00:00:00Z' } };
// Use score-based WHERE filters (ZodEnum not supported by postgresWhereClauseBuilder casting map)
const UPDATE_WHERE: WhereFilterDefinition<TestItem> = { score: { $lt: 34 } };  // ~1/3 of rows
const DELETE_WHERE: WhereFilterDefinition<TestItem> = { score: { $gte: 67 } }; // ~1/3 of rows

async function runDirectSql(db: Db, scenario: Scenario, rowCount: number, iteration: number): Promise<void> {
    switch (scenario) {
        case 'create': {
            const item = generateItem(rowCount + iteration);
            const { sql, params } = buildInsertSql(item);
            await db.query(sql, params);
            break;
        }
        case 'update': {
            const { sql, params } = buildUpdateSql(UPDATE_DATA, UPDATE_WHERE);
            await db.query(sql, params);
            break;
        }
        case 'delete': {
            const { sql, params } = buildDeleteSql(DELETE_WHERE);
            await db.query(sql, params);
            break;
        }
    }
}

async function runRmw(db: Db, scenario: Scenario, rowCount: number, iteration: number): Promise<void> {
    switch (scenario) {
        case 'create': {
            // RMW create: just INSERT, rely on UNIQUE constraint for PK check
            const item = generateItem(rowCount + iteration);
            await db.query(
                'INSERT INTO items (pk, data) VALUES ($1, $2::jsonb)',
                [item.id, JSON.stringify(item)],
            );
            break;
        }
        case 'update': {
            // 1. Read matching rows
            const clause = buildWhereClause(UPDATE_WHERE);
            const readResult = await db.query<{ pk: string; data: TestItem }>(
                `SELECT pk, data FROM items WHERE ${clause.where_clause_statement}`,
                clause.statement_arguments,
            );
            const rows = readResult.rows;
            if (rows.length === 0) break;

            // 2. Apply JS deep merge
            const updated = rows.map(row => ({
                pk: row.pk,
                data: deepMerge(row.data as unknown as Record<string, unknown>, UPDATE_DATA),
            }));

            // 3. Batch write-back via UPDATE FROM VALUES
            const valuesParts: string[] = [];
            const params: (string | number | boolean | null)[] = [];
            let paramIdx = 1;
            for (const row of updated) {
                valuesParts.push(`($${paramIdx}, $${paramIdx + 1}::jsonb)`);
                params.push(row.pk, JSON.stringify(row.data));
                paramIdx += 2;
            }
            await db.query(
                `UPDATE items SET data = v.data FROM (VALUES ${valuesParts.join(',')}) AS v(pk, data) WHERE items.pk = v.pk`,
                params,
            );
            break;
        }
        case 'delete': {
            // 1. Read matching PKs
            const clause = buildWhereClause(DELETE_WHERE);
            const readResult = await db.query<{ pk: string }>(
                `SELECT pk FROM items WHERE ${clause.where_clause_statement}`,
                clause.statement_arguments,
            );
            const pks = readResult.rows.map(r => r.pk);
            if (pks.length === 0) break;

            // 2. Batch delete
            await db.query('DELETE FROM items WHERE pk = ANY($1)', [pks]);
            break;
        }
    }
}

/** RMW variant: per-row writes instead of batched (the naive approach). */
async function runRmwPerRow(db: Db, scenario: Scenario, rowCount: number, iteration: number): Promise<void> {
    switch (scenario) {
        case 'create': {
            // Same as batched — single INSERT either way
            const item = generateItem(rowCount + iteration);
            await db.query(
                'INSERT INTO items (pk, data) VALUES ($1, $2::jsonb)',
                [item.id, JSON.stringify(item)],
            );
            break;
        }
        case 'update': {
            // 1. Read matching rows
            const clause = buildWhereClause(UPDATE_WHERE);
            const readResult = await db.query<{ pk: string; data: TestItem }>(
                `SELECT pk, data FROM items WHERE ${clause.where_clause_statement}`,
                clause.statement_arguments,
            );
            const rows = readResult.rows;
            if (rows.length === 0) break;

            // 2. Apply JS deep merge
            const updated = rows.map(row => ({
                pk: row.pk,
                data: deepMerge(row.data as unknown as Record<string, unknown>, UPDATE_DATA),
            }));

            // 3. Per-row write-back (N separate UPDATE statements)
            for (const row of updated) {
                await db.query(
                    'UPDATE items SET data = $1::jsonb WHERE pk = $2',
                    [JSON.stringify(row.data), row.pk],
                );
            }
            break;
        }
        case 'delete': {
            // 1. Read matching PKs
            const clause = buildWhereClause(DELETE_WHERE);
            const readResult = await db.query<{ pk: string }>(
                `SELECT pk FROM items WHERE ${clause.where_clause_statement}`,
                clause.statement_arguments,
            );
            const pks = readResult.rows.map(r => r.pk);
            if (pks.length === 0) break;

            // 2. Per-row delete (N separate DELETE statements)
            for (const pk of pks) {
                await db.query('DELETE FROM items WHERE pk = $1', [pk]);
            }
            break;
        }
    }
}

// ─── Measurement & Statistics ────────────────────────────────────────────────

async function measure(fn: () => Promise<void>): Promise<number> {
    const start = performance.now();
    await fn();
    return performance.now() - start;
}

interface Stats {
    median: number;
    p75: number;
    p95: number;
    mean: number;
    stddev: number;
    count: number;
}

function analyzeResults(times: number[]): Stats {
    const sorted = [...times].sort((a, b) => a - b);
    const trimCount = Math.floor(sorted.length * 0.05);
    const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
    const mean = trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
    const variance = trimmed.reduce((s, v) => s + (v - mean) ** 2, 0) / trimmed.length;
    return {
        median: sorted[Math.floor(sorted.length / 2)]!,
        p75: sorted[Math.floor(sorted.length * 0.75)]!,
        p95: sorted[Math.floor(sorted.length * 0.95)]!,
        mean: +mean.toFixed(3),
        stddev: +Math.sqrt(variance).toFixed(3),
        count: trimmed.length,
    };
}

// ─── Correctness Validation ──────────────────────────────────────────────────

async function validateCorrectness(db: Db, scenario: Scenario, rowCount: number): Promise<void> {
    console.log(`  Validating correctness for ${scenario}...`);

    // Run direct SQL path, capture state
    await runDirectSql(db, scenario, rowCount, 999_000);
    const resultA = await db.query<{ pk: string; data: TestItem }>('SELECT pk, data FROM items ORDER BY pk');
    const setA = resultA.rows;
    await db.exec('ROLLBACK TO SAVEPOINT bench_reset');

    // Run RMW path, capture state
    await runRmw(db, scenario, rowCount, 999_000);
    const resultB = await db.query<{ pk: string; data: TestItem }>('SELECT pk, data FROM items ORDER BY pk');
    const setB = resultB.rows;
    await db.exec('ROLLBACK TO SAVEPOINT bench_reset');

    // Compare
    if (setA.length !== setB.length) {
        throw new Error(
            `CORRECTNESS FAILURE [${scenario}]: Row count mismatch. Direct SQL: ${setA.length}, RMW: ${setB.length}`,
        );
    }
    for (let i = 0; i < setA.length; i++) {
        const a = JSON.stringify(setA[i]!.data);
        const b = JSON.stringify(setB[i]!.data);
        if (a !== b) {
            throw new Error(
                `CORRECTNESS FAILURE [${scenario}]: Row ${i} differs.\nDirect SQL: ${a}\nRMW:        ${b}`,
            );
        }
    }
    console.log(`  ✓ Correctness validated for ${scenario}`);
}

// ─── Output Formatting ──────────────────────────────────────────────────────

interface BenchmarkResult {
    scenario: string;
    rowCount: number;
    latencyMs: number;
    directSql: Stats;
    rmwBatched: Stats;
    rmwPerRow: Stats;
    ratioBatched: number;
    ratioPerRow: number;
}

function printResults(results: BenchmarkResult[], latencyMs: number): void {
    const label = latencyMs === 0 ? 'NO LATENCY (in-process WASM)' : `SIMULATED ${latencyMs}ms NETWORK LATENCY per query`;
    console.log(`\n\n=== ${label} ===`);
    console.log('╔══════════╦══════╦════════════════════════╦════════════════════════╦════════════════════════╦═══════════════╦═══════════════╗');
    console.log('║ Scenario ║ Rows ║ Direct SQL (med)       ║ RMW Batched (med)      ║ RMW Per-Row (med)      ║ vs Batched    ║ vs Per-Row    ║');
    console.log('╠══════════╬══════╬════════════════════════╬════════════════════════╬════════════════════════╬═══════════════╬═══════════════╣');

    for (const r of results) {
        const scen = r.scenario.toUpperCase().padEnd(8);
        const rows = String(r.rowCount).padEnd(4);
        const sqlMs = `${r.directSql.median.toFixed(3)}ms`.padEnd(22);
        const batchMs = `${r.rmwBatched.median.toFixed(3)}ms`.padEnd(22);
        const perRowMs = `${r.rmwPerRow.median.toFixed(3)}ms`.padEnd(22);
        const ratioBatch = `${r.ratioBatched.toFixed(2)}x`.padEnd(13);
        const ratioPerRow = `${r.ratioPerRow.toFixed(2)}x`.padEnd(13);
        console.log(`║ ${scen} ║ ${rows} ║ ${sqlMs} ║ ${batchMs} ║ ${perRowMs} ║ ${ratioBatch} ║ ${ratioPerRow} ║`);
    }

    console.log('╚══════════╩══════╩════════════════════════╩════════════════════════╩════════════════════════╩═══════════════╩═══════════════╝');
    console.log('\nRatios = path median / Direct SQL median (higher = Direct SQL is faster)');
}

// ─── Main ────────────────────────────────────────────────────────────────────

const WARMUP = 200;
const ITERATIONS = 200;
const ROW_COUNTS = [10, 100, 500, 1000];
const SCENARIOS: Scenario[] = ['create', 'update', 'delete'];
// 0ms = in-process WASM (current). 0.5ms ≈ localhost Postgres. 2ms ≈ same-region cloud DB.
const LATENCIES_MS = [0, 0.5, 2];
// Reduce iterations for latency runs (they're slow — N×latency per iteration)
const LATENCY_WARMUP = 50;
const LATENCY_ITERATIONS = 100;

async function runBenchmarkSuite(latencyMs: number): Promise<BenchmarkResult[]> {
    const warmup = latencyMs > 0 ? LATENCY_WARMUP : WARMUP;
    const iterations = latencyMs > 0 ? LATENCY_ITERATIONS : ITERATIONS;
    const latencyLabel = latencyMs === 0 ? 'no latency' : `${latencyMs}ms latency`;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  SUITE: ${latencyLabel} | warmup=${warmup} | iterations=${iterations}`);
    console.log(`${'═'.repeat(60)}`);

    const allResults: BenchmarkResult[] = [];

    for (const scenario of SCENARIOS) {
        for (const rowCount of ROW_COUNTS) {
            console.log(`\n--- ${scenario.toUpperCase()} | ${rowCount} rows | ${latencyLabel} ---`);

            const rawDb = new PGlite('memory://');
            await rawDb.waitReady;
            await rawDb.exec(TABLE_DDL);
            await seedData(rawDb, rowCount);

            // Set up savepoint for instant reset (always use raw db for control commands)
            await rawDb.exec('BEGIN');
            await rawDb.exec('SAVEPOINT bench_reset');

            // Proxy adds latency to query/exec calls used by the scenario runners
            const db = createDbProxy(rawDb, latencyMs);

            // Correctness validation (no latency needed — just checking results match)
            const rawNoLatency = createDbProxy(rawDb, 0);
            await validateCorrectness(rawNoLatency, scenario, rowCount);

            // Warmup all three paths
            console.log(`  Warming up (${warmup} iterations)...`);
            for (let i = 0; i < warmup; i++) {
                await runDirectSql(db, scenario, rowCount, i);
                await rawDb.exec('ROLLBACK TO SAVEPOINT bench_reset');
                await runRmw(db, scenario, rowCount, i);
                await rawDb.exec('ROLLBACK TO SAVEPOINT bench_reset');
                await runRmwPerRow(db, scenario, rowCount, i);
                await rawDb.exec('ROLLBACK TO SAVEPOINT bench_reset');
            }

            // Measure (interleaved, rotating order across 3 paths)
            console.log(`  Measuring (${iterations} iterations, interleaved)...`);
            const results = { directSql: [] as number[], rmwBatched: [] as number[], rmwPerRow: [] as number[] };

            for (let i = 0; i < iterations; i++) {
                if (typeof globalThis.gc === 'function') globalThis.gc();

                // Rotate starting path: 0→SQL first, 1→Batched first, 2→PerRow first
                const order = i % 3;
                const paths = [
                    async () => { results.directSql.push(await measure(() => runDirectSql(db, scenario, rowCount, warmup + i))); },
                    async () => { results.rmwBatched.push(await measure(() => runRmw(db, scenario, rowCount, warmup + i))); },
                    async () => { results.rmwPerRow.push(await measure(() => runRmwPerRow(db, scenario, rowCount, warmup + i))); },
                ];
                const rotated = [...paths.slice(order), ...paths.slice(0, order)];

                for (const run of rotated) {
                    await run();
                    await rawDb.exec('ROLLBACK TO SAVEPOINT bench_reset');
                }
            }

            await rawDb.exec('ROLLBACK');

            const statsSql = analyzeResults(results.directSql);
            const statsBatched = analyzeResults(results.rmwBatched);
            const statsPerRow = analyzeResults(results.rmwPerRow);
            const ratioBatched = statsBatched.median / statsSql.median;
            const ratioPerRow = statsPerRow.median / statsSql.median;

            console.log(`  Direct SQL:   median=${statsSql.median.toFixed(3)}ms  p95=${statsSql.p95.toFixed(3)}ms`);
            console.log(`  RMW Batched:  median=${statsBatched.median.toFixed(3)}ms  p95=${statsBatched.p95.toFixed(3)}ms  (${ratioBatched.toFixed(2)}x)`);
            console.log(`  RMW Per-Row:  median=${statsPerRow.median.toFixed(3)}ms  p95=${statsPerRow.p95.toFixed(3)}ms  (${ratioPerRow.toFixed(2)}x)`);

            allResults.push({
                scenario,
                rowCount,
                latencyMs,
                directSql: statsSql,
                rmwBatched: statsBatched,
                rmwPerRow: statsPerRow,
                ratioBatched,
                ratioPerRow,
            });

            await rawDb.close();
        }
    }

    return allResults;
}

async function main(): Promise<void> {
    console.log(`Benchmark: Direct SQL vs RMW (Batched) vs RMW (Per-Row)`);
    console.log(`Row counts: ${ROW_COUNTS.join(', ')} | Latencies: ${LATENCIES_MS.map(l => l === 0 ? '0 (WASM)' : `${l}ms`).join(', ')}`);

    const allResults: BenchmarkResult[] = [];

    for (const latencyMs of LATENCIES_MS) {
        const suiteResults = await runBenchmarkSuite(latencyMs);
        allResults.push(...suiteResults);
        printResults(suiteResults, latencyMs);
    }
}

main().catch(err => {
    console.error('Benchmark failed:', err);
    process.exit(1);
});
