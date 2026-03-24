import { describe, test, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { z } from "zod";
import { prepareOwnershipWhereClause } from "./prepareOwnershipWhereClause.ts";
import { standardOwnershipTests, type OwnershipTestAdapter } from "../standardTests.ts";
import type { OwnershipRule } from "../types.ts";
import type { IUser } from "../auth.ts";

// ═══════════════════════════════════════════════════════════════════
// SQLite Integration Adapter for Standard Tests
// ═══════════════════════════════════════════════════════════════════

function createSqliteAdapter(): OwnershipTestAdapter {
    return {
        canWrite: async <T extends Record<string, any>>(config: {
            item: T,
            ownershipRule: OwnershipRule<T>,
            user: IUser,
            schema: z.ZodType<T>,
        }) => {
            const db = new Database(':memory:');
            try {
                db.exec('CREATE TABLE items (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
                const itemId = (config.item as any).id ?? 'test-id';
                db.prepare('INSERT INTO items (id, data) VALUES (?, ?)').run(itemId, JSON.stringify(config.item));

                const result = prepareOwnershipWhereClause(
                    config.ownershipRule,
                    config.user,
                    { mode: 'object_column', columnName: 'data', schema: config.schema },
                    'sqlite',
                );

                if (!result.ok) return false;
                if (!result.result.where_clause) return true; // type: 'none'

                const fromExtra = result.result.from_clause ? `, ${result.result.from_clause}` : '';
                const sql = `SELECT id FROM items${fromExtra} WHERE ${result.result.where_clause}`;
                const rows = db.prepare(sql).all(...result.result.parameters) as any[];
                return rows.length > 0;
            } finally {
                db.close();
            }
        },

        filterByOwner: async <T extends Record<string, any>>(config: {
            items: T[],
            ownershipRule: OwnershipRule<T>,
            user: IUser,
            schema: z.ZodType<T>,
            primaryKey: keyof T & string,
        }) => {
            const db = new Database(':memory:');
            try {
                db.exec('CREATE TABLE items (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
                const insert = db.prepare('INSERT INTO items (id, data) VALUES (?, ?)');
                for (const item of config.items) {
                    insert.run((item as any)[config.primaryKey], JSON.stringify(item));
                }

                const result = prepareOwnershipWhereClause(
                    config.ownershipRule,
                    config.user,
                    { mode: 'object_column', columnName: 'data', schema: config.schema },
                    'sqlite',
                );

                if (!result.ok) return [];
                if (!result.result.where_clause) {
                    // type: 'none' — return all
                    const rows = db.prepare('SELECT data FROM items').all() as any[];
                    return rows.map(r => JSON.parse(r.data));
                }

                const fromExtra = result.result.from_clause ? `, ${result.result.from_clause}` : '';
                const sql = `SELECT DISTINCT data FROM items${fromExtra} WHERE ${result.result.where_clause}`;
                const rows = db.prepare(sql).all(...result.result.parameters) as any[];
                return rows.map(r => JSON.parse(r.data));
            } finally {
                db.close();
            }
        },
    };
}

describe('prepareOwnershipWhereClause (SQLite integration)', () => {
    standardOwnershipTests({
        test,
        expect,
        createAdapter: createSqliteAdapter,
        implementationName: 'SQLite prepareOwnershipWhereClause',
    });
});

// ═══════════════════════════════════════════════════════════════════
// SQL-Specific Tests
// ═══════════════════════════════════════════════════════════════════

const SimpleSchema = z.object({ id: z.string(), owner_id: z.string(), name: z.string() });
const ArrayOwnerSchema = z.object({ id: z.string(), owner_ids: z.array(z.string()), name: z.string() });
const TransferSchema = z.object({ id: z.string(), owner_id: z.string(), pending_owner_id: z.string().optional(), name: z.string() });

const mockUser = (uuid?: string, email?: string): IUser => ({
    getID: () => uuid,
    getUuid: () => uuid,
    getEmail: () => email,
});

describe('SQL-specific behaviour', () => {

    describe('parameter rebasing (startingArgIndex)', () => {
        test('pg placeholders start at given index', () => {
            const rule: OwnershipRule<z.infer<typeof SimpleSchema>> = { type: 'basic', property_type: 'id', path: 'owner_id', format: 'uuid' };
            const result = prepareOwnershipWhereClause(rule, mockUser('u1'), { mode: 'object_column', columnName: 'data', schema: SimpleSchema }, 'pg', 5);
            expect(result.ok).toBe(true);
            if (result.ok && result.result.where_clause) {
                expect(result.result.where_clause).toContain('$5');
                expect(result.result.where_clause).not.toContain('$1');
            }
        });

        test('transfer path uses next index after primary', () => {
            const rule: OwnershipRule<z.infer<typeof TransferSchema>> = { type: 'basic', property_type: 'id', path: 'owner_id', format: 'uuid', transferring_to_path: 'pending_owner_id' };
            const result = prepareOwnershipWhereClause(rule, mockUser('u1'), { mode: 'object_column', columnName: 'data', schema: TransferSchema }, 'pg', 3);
            expect(result.ok).toBe(true);
            if (result.ok && result.result.where_clause) {
                expect(result.result.where_clause).toContain('$3');
                expect(result.result.where_clause).toContain('$4');
                expect(result.result.parameters).toHaveLength(2);
            }
        });

        test('sqlite ignores startingArgIndex (uses ?)', () => {
            const rule: OwnershipRule<z.infer<typeof SimpleSchema>> = { type: 'basic', property_type: 'id', path: 'owner_id', format: 'uuid' };
            const result = prepareOwnershipWhereClause(rule, mockUser('u1'), { mode: 'object_column', columnName: 'data', schema: SimpleSchema }, 'sqlite', 5);
            expect(result.ok).toBe(true);
            if (result.ok && result.result.where_clause) {
                expect(result.result.where_clause).toContain('?');
                // SQLite json_extract uses $.path syntax, so $ appears — just verify no $N placeholders
                expect(result.result.where_clause).not.toMatch(/\$\d/);
            }
        });
    });

    describe('column_table mode', () => {
        test('generates simple column equality', () => {
            const rule: OwnershipRule = { type: 'basic', property_type: 'id', path: 'owner_id', format: 'uuid' };
            const result = prepareOwnershipWhereClause(rule, mockUser('u1'), { mode: 'column_table', allowedColumns: ['owner_id'] }, 'pg');
            expect(result.ok).toBe(true);
            if (result.ok && result.result.where_clause) {
                expect(result.result.where_clause).toBe('"owner_id" = $1');
                expect(result.result.parameters).toEqual(['u1']);
            }
        });

        test('rejects column not in allowedColumns', () => {
            const rule: OwnershipRule = { type: 'basic', property_type: 'id', path: 'evil_col', format: 'uuid' };
            const result = prepareOwnershipWhereClause(rule, mockUser('u1'), { mode: 'column_table', allowedColumns: ['owner_id'] }, 'pg');
            expect(result.ok).toBe(false);
        });

        test('rejects nested paths in column_table mode', () => {
            const rule: OwnershipRule = { type: 'basic', property_type: 'id', path: 'meta.owner_id' as any, format: 'uuid' };
            const result = prepareOwnershipWhereClause(rule, mockUser('u1'), { mode: 'column_table', allowedColumns: ['meta.owner_id'] }, 'pg');
            expect(result.ok).toBe(false);
        });
    });

    describe('dialect correctness', () => {
        test('pg uses JSONB operators', () => {
            const rule: OwnershipRule<z.infer<typeof SimpleSchema>> = { type: 'basic', property_type: 'id', path: 'owner_id', format: 'uuid' };
            const result = prepareOwnershipWhereClause(rule, mockUser('u1'), { mode: 'object_column', columnName: 'data', schema: SimpleSchema }, 'pg');
            expect(result.ok).toBe(true);
            if (result.ok && result.result.where_clause) {
                expect(result.result.where_clause).toContain('->>');
            }
        });

        test('sqlite uses json_extract', () => {
            const rule: OwnershipRule<z.infer<typeof SimpleSchema>> = { type: 'basic', property_type: 'id', path: 'owner_id', format: 'uuid' };
            const result = prepareOwnershipWhereClause(rule, mockUser('u1'), { mode: 'object_column', columnName: 'data', schema: SimpleSchema }, 'sqlite');
            expect(result.ok).toBe(true);
            if (result.ok && result.result.where_clause) {
                expect(result.result.where_clause).toContain('json_extract');
            }
        });

        test('pg id_in_scalar_array uses jsonb_array_elements_text', () => {
            const rule: OwnershipRule<z.infer<typeof ArrayOwnerSchema>> = { type: 'basic', property_type: 'id_in_scalar_array', path: 'owner_ids', format: 'uuid' };
            const result = prepareOwnershipWhereClause(rule, mockUser('u1'), { mode: 'object_column', columnName: 'data', schema: ArrayOwnerSchema }, 'pg');
            expect(result.ok).toBe(true);
            if (result.ok && result.result.where_clause) {
                expect(result.result.where_clause).toContain('jsonb_array_elements_text');
            }
        });

        test('sqlite id_in_scalar_array uses json_each', () => {
            const rule: OwnershipRule<z.infer<typeof ArrayOwnerSchema>> = { type: 'basic', property_type: 'id_in_scalar_array', path: 'owner_ids', format: 'uuid' };
            const result = prepareOwnershipWhereClause(rule, mockUser('u1'), { mode: 'object_column', columnName: 'data', schema: ArrayOwnerSchema }, 'sqlite');
            expect(result.ok).toBe(true);
            if (result.ok && result.result.where_clause) {
                expect(result.result.where_clause).toContain('json_each');
            }
        });
    });

    describe('type: none returns null where_clause', () => {
        test('no filtering needed', () => {
            const rule: OwnershipRule = { type: 'none' };
            const result = prepareOwnershipWhereClause(rule, mockUser('u1'), { mode: 'object_column', columnName: 'data', schema: SimpleSchema }, 'pg');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.result.where_clause).toBeNull();
                expect(result.result.parameters).toEqual([]);
            }
        });
    });

    describe('no user claim returns 1=0', () => {
        test('user with no uuid for uuid rule', () => {
            const rule: OwnershipRule<z.infer<typeof SimpleSchema>> = { type: 'basic', property_type: 'id', path: 'owner_id', format: 'uuid' };
            const result = prepareOwnershipWhereClause(rule, mockUser(undefined), { mode: 'object_column', columnName: 'data', schema: SimpleSchema }, 'pg');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.result.where_clause).toBe('1 = 0');
            }
        });
    });
});
