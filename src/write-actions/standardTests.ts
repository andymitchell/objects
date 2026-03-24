import { z } from "zod";
import type { WriteAction, WriteResult } from "./types.ts";
import type { WriteChanges, DDL } from "./writeToItemsArray/types.ts";
import type { IUser } from "./auth/types.ts";
import { getWriteFailures, getWriteSuccesses, getWriteErrors, assertWriteArrayScope } from "./helpers.ts";

// ═══════════════════════════════════════════════════════════════════
// Adapter Types
// ═══════════════════════════════════════════════════════════════════

/** Result of a single adapter.apply() call. Return undefined if the implementation doesn't support this operation. */
export type WriteTestAdapterResult<T extends Record<string, any>> = {
    result: WriteResult<T>,
    changes: WriteChanges<T>,
    /** Independent read of the data source AFTER execution (NOT from WriteResult) */
    finalItems: T[],
} | undefined;

export type WriteTestAdapter<T extends Record<string, any>> = {
    apply: (config: {
        initialItems: T[],
        writeActions: WriteAction<T>[],
        schema: z.ZodType<T, any, any>,
        ddl: DDL<T>,
        user?: IUser,
        options?: { atomic?: boolean, attempt_recover_duplicate_create?: 'never' | 'if-convergent' | 'always-update' },
    }) => Promise<WriteTestAdapterResult<T>>
}

export type AdapterFactory = <T extends Record<string, any>>(
    schema: z.ZodType<T, any, any>,
    ddl: DDL<T>
) => WriteTestAdapter<T>;

export type StandardTestConfig = {
    test: typeof test,
    expect: typeof expect,
    createAdapter: AdapterFactory,
    implementationName?: string,
}

// ═══════════════════════════════════════════════════════════════════
// Test Schemas & DDLs
// ═══════════════════════════════════════════════════════════════════

const FlatSchema = z.object({
    id: z.string(),
    text: z.string().optional(),
    count: z.number().optional(),
    tags: z.array(z.string()).optional(),
}).strict();
type Flat = z.infer<typeof FlatSchema>;

const flatDdl: DDL<Flat> = {
    version: 1,
    lists: {
        '.': { primary_key: 'id' },
    },
    permissions: { type: 'none' },
};

const NestedSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    children: z.array(
        z.object({
            cid: z.string(),
            label: z.string().optional(),
            items: z.array(
                z.object({
                    iid: z.string(),
                    value: z.number().optional(),
                }).strict()
            ),
        }).strict()
    ).optional(),
}).strict();
type Nested = z.infer<typeof NestedSchema>;

const nestedDdl: DDL<Nested> = {
    version: 1,
    lists: {
        '.': { primary_key: 'id' },
        'children': { primary_key: 'cid' },
        'children.items': { primary_key: 'iid' },
    },
    permissions: { type: 'none' },
};

const OwnerSchema = z.object({
    id: z.string(),
    text: z.string().optional(),
    owner_id: z.string().optional(),
}).strict();
type Owner = z.infer<typeof OwnerSchema>;

const ownerDdl: DDL<Owner> = {
    version: 1,
    lists: {
        '.': { primary_key: 'id' },
    },
    permissions: {
        type: 'basic_ownership_property',
        property_type: 'id',
        path: 'owner_id',
        format: 'uuid',
    },
};

const OwnerEmailSchema = z.object({
    id: z.string(),
    text: z.string().optional(),
    owner_email: z.string().optional(),
}).strict();
type OwnerEmail = z.infer<typeof OwnerEmailSchema>;

const ownerEmailDdl: DDL<OwnerEmail> = {
    version: 1,
    lists: {
        '.': { primary_key: 'id' },
    },
    permissions: {
        type: 'basic_ownership_property',
        property_type: 'id',
        path: 'owner_email',
        format: 'email',
    },
};

const FlatWithSubItemsSchema = z.object({
    id: z.string(),
    text: z.string().optional(),
    count: z.number().optional(),
    tags: z.array(z.string()).optional(),
    sub_items: z.array(z.object({
        sid: z.string(),
        val: z.number().optional(),
    }).strict()).optional(),
}).strict();
type FlatWithSubItems = z.infer<typeof FlatWithSubItemsSchema>;

const flatWithSubItemsDdl: DDL<FlatWithSubItems> = {
    version: 1,
    lists: {
        '.': { primary_key: 'id' },
        'sub_items': { primary_key: 'sid' },
    },
    permissions: { type: 'none' },
};

const OwnerScalarArraySchema = z.object({
    id: z.string(),
    owner_ids: z.array(z.string()).optional(),
}).strict();
type OwnerScalarArray = z.infer<typeof OwnerScalarArraySchema>;

const ownerScalarArrayDdl: DDL<OwnerScalarArray> = {
    version: 1,
    lists: {
        '.': { primary_key: 'id' },
    },
    permissions: {
        type: 'basic_ownership_property',
        property_type: 'id_in_scalar_array',
        path: 'owner_ids',
        format: 'uuid',
    },
};

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function makeAction<T extends Record<string, any>>(uuid: string, payload: WriteAction<T>['payload']): WriteAction<T> {
    return { type: 'write', ts: Date.now(), uuid, payload };
}

function makeUser(uuid: string, email?: string): IUser {
    return {
        getID: () => uuid,
        getUuid: () => uuid,
        getEmail: () => email ?? `${uuid}@test.com`,
    };
}

/** If adapter returned undefined (unsupported), log + skip. Else run assertion. */
function expectOrAcknowledgeUnsupported<T>(
    result: T | undefined,
    assertion: (r: T) => void,
    implementationName: string,
    reason?: string
): void {
    if (result === undefined) {
        console.warn(`[ACKNOWLEDGED UNSUPPORTED: ${implementationName}] ${reason ?? 'not supported'}`);
        return;
    }
    assertion(result);
}

// ═══════════════════════════════════════════════════════════════════
// Standard Tests
// ═══════════════════════════════════════════════════════════════════

export function standardTests(testConfig: StandardTestConfig) {
    const { test, expect, createAdapter } = testConfig;
    const implName = testConfig.implementationName ?? 'unknown';

    // ───────────────────────────────────────────────────────────────
    // 1. Core Verbs
    // ───────────────────────────────────────────────────────────────

    describe('1. Core Verbs', () => {

        describe('1.1 Create', () => {

            test('creates a new item', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '2', text: 'hello' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems).toHaveLength(2);
                    expect(r.finalItems.find(x => x.id === '2')).toBeDefined();
                    expect(r.changes.insert).toHaveLength(1);
                    expect(r.changes.insert[0]!.id).toBe('2');
                }, implName);
            });

            test('create with all optional fields populated', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1', text: 'hi', count: 5, tags: ['a', 'b'] } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]).toEqual({ id: '1', text: 'hi', count: 5, tags: ['a', 'b'] });
                }, implName);
            });

            test('create with only required fields (PK)', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.id).toBe('1');
                }, implName);
            });

            test('multiple creates in one batch', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '1' } }),
                        makeAction('a2', { type: 'create', data: { id: '2' } }),
                        makeAction('a3', { type: 'create', data: { id: '3' } }),
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems).toHaveLength(3);
                }, implName);
            });
        });

        describe('1.2 Update', () => {

            test('updates matching item', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'old' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'new' }, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.text).toBe('new');
                    expect(r.changes.update).toHaveLength(1);
                }, implName);
            });

            test('update with where-filter matching multiple items: all updated', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'same' }, { id: '2', text: 'same' }, { id: '3', text: 'other' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'changed' }, where: { text: 'same' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems.filter(x => x.text === 'changed')).toHaveLength(2);
                    expect(r.finalItems.find(x => x.id === '3')!.text).toBe('other');
                }, implName);
            });

            test('update with where-filter matching zero items: no changes, still ok', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'keep' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'changed' }, where: { id: 'nonexistent' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.text).toBe('keep');
                    expect(r.changes.update).toHaveLength(0);
                }, implName);
            });

            test('partial update merges (default merge method): untouched fields preserved', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'hello', count: 42 }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'world' }, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.text).toBe('world');
                    expect(r.finalItems[0]!.count).toBe(42);
                }, implName);
            });

            test('update method assign: shallow replacement', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'hello', count: 42 }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'world' }, where: { id: '1' }, method: 'assign' })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.text).toBe('world');
                    // assign replaces top-level props but doesn't remove untouched ones via Object.assign
                    expect(r.finalItems[0]!.count).toBe(42);
                }, implName, 'assign update method');
            });

            test('scalar array property can be set via update (full replacement)', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a', 'b'] }],
                    writeActions: [makeAction('a1', { type: 'update', data: { tags: ['z'] }, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['z']);
                }, implName, 'scalar array update');
            });
        });

        describe('1.3 Delete', () => {

            test('deletes matching item', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }, { id: '2' }],
                    writeActions: [makeAction('a1', { type: 'delete', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems).toHaveLength(1);
                    expect(r.finalItems[0]!.id).toBe('2');
                    expect(r.changes.remove_keys).toHaveLength(1);
                }, implName);
            });

            test('delete with where-filter matching multiple items: all removed', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'rm' }, { id: '2', text: 'rm' }, { id: '3', text: 'keep' }],
                    writeActions: [makeAction('a1', { type: 'delete', where: { text: 'rm' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems).toHaveLength(1);
                    expect(r.finalItems[0]!.id).toBe('3');
                }, implName);
            });

            test('delete with where-filter matching zero items: no changes, still ok', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', { type: 'delete', where: { id: 'nonexistent' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems).toHaveLength(1);
                    expect(r.changes.remove_keys).toHaveLength(0);
                }, implName);
            });
        });

        describe('1.4 Array Scope', () => {

            test('creates item in nested object-array', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', children: [{ cid: 'c1', items: [] }] }],
                    writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                        type: 'array_scope',
                        scope: 'children',
                        action: { type: 'create', data: { cid: 'c2', items: [] } },
                        where: { id: '1' },
                    }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.children).toHaveLength(2);
                    expect(r.finalItems[0]!.children![1]!.cid).toBe('c2');
                }, implName);
            });

            test('updates item in nested object-array', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', children: [{ cid: 'c1', label: 'old', items: [] }] }],
                    writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                        type: 'array_scope',
                        scope: 'children',
                        action: { type: 'update', data: { label: 'new' }, where: { cid: 'c1' } },
                        where: { id: '1' },
                    }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.children![0]!.label).toBe('new');
                }, implName);
            });

            test('deletes item from nested object-array', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', children: [{ cid: 'c1', items: [] }, { cid: 'c2', items: [] }] }],
                    writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                        type: 'array_scope',
                        scope: 'children',
                        action: { type: 'delete', where: { cid: 'c1' } },
                        where: { id: '1' },
                    }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.children).toHaveLength(1);
                    expect(r.finalItems[0]!.children![0]!.cid).toBe('c2');
                }, implName);
            });

            test('deeply nested array_scope (2+ levels: children.items)', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', children: [{ cid: 'c1', items: [] }] }],
                    writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children.items'>({
                        type: 'array_scope',
                        scope: 'children.items',
                        action: { type: 'create', data: { iid: 'i1', value: 99 } },
                        where: { id: '1' },
                    }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.children![0]!.items).toHaveLength(1);
                    expect(r.finalItems[0]!.children![0]!.items[0]!.iid).toBe('i1');
                    expect(r.finalItems[0]!.children![0]!.items[0]!.value).toBe(99);
                }, implName);
            });

            test('array_scope on empty nested array: no-op, still ok', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', children: [] }],
                    writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                        type: 'array_scope',
                        scope: 'children',
                        action: { type: 'update', data: { label: 'new' }, where: { cid: 'c1' } },
                        where: { id: '1' },
                    }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.children).toHaveLength(0);
                }, implName);
            });

            test('array_scope where-filter matches zero parent items: no-op, still ok', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', children: [{ cid: 'c1', items: [] }] }],
                    writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                        type: 'array_scope',
                        scope: 'children',
                        action: { type: 'create', data: { cid: 'c2', items: [] } },
                        where: { id: 'nonexistent' },
                    }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.children).toHaveLength(1);
                }, implName);
            });

            test('array_scope where-filter matches multiple parent items: sub-action applied to all', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [
                        { id: '1', name: 'target', children: [{ cid: 'c1', items: [] }] },
                        { id: '2', name: 'target', children: [{ cid: 'c2', items: [] }] },
                    ],
                    writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                        type: 'array_scope',
                        scope: 'children',
                        action: { type: 'create', data: { cid: 'new', items: [] } },
                        where: { name: 'target' },
                    }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.children).toHaveLength(2);
                    expect(r.finalItems[1]!.children).toHaveLength(2);
                }, implName);
            });

            test('constraint violation inside array_scope (duplicate PK in nested array): halts parent execution', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', children: [{ cid: 'c1', items: [] }] }],
                    writeActions: [
                        makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                            type: 'array_scope',
                            scope: 'children',
                            action: { type: 'create', data: { cid: 'c1', items: [] } }, // duplicate PK
                            where: { id: '1' },
                        })),
                        makeAction<Nested>('a2', { type: 'create', data: { id: '2' } }), // should be blocked
                    ],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    const failures = getWriteFailures(r.result);
                    expect(failures.length).toBeGreaterThanOrEqual(1);
                    // Second action should be blocked
                    const blocked = failures.find(f => f.action.uuid === 'a2');
                    if (blocked) {
                        expect(blocked.blocked_by_action_uuid).toBe('a1');
                    }
                }, implName);
            });
        });

        // ─────────────────────────────────────────────────────────
        // 1.5 AddToSet
        // ─────────────────────────────────────────────────────────

        describe('1.5 AddToSet', () => {

            describe('scalar deep_equals', () => {
                test('adds item to existing scalar array', async () => {
                    const adapter = createAdapter(FlatSchema, flatDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', tags: ['a'] }],
                        writeActions: [makeAction<Flat>('a1', { type: 'add_to_set', path: 'tags', items: ['b'], unique_by: 'deep_equals', where: { id: '1' } })],
                        schema: FlatSchema,
                        ddl: flatDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.tags).toEqual(['a', 'b']);
                    }, implName);
                });

                test('empty items: no-op', async () => {
                    const adapter = createAdapter(FlatSchema, flatDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', tags: ['a'] }],
                        writeActions: [makeAction<Flat>('a1', { type: 'add_to_set', path: 'tags', items: [], unique_by: 'deep_equals', where: { id: '1' } })],
                        schema: FlatSchema,
                        ddl: flatDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.tags).toEqual(['a']);
                    }, implName);
                });

                test('multiple new items all added', async () => {
                    const adapter = createAdapter(FlatSchema, flatDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', tags: ['a'] }],
                        writeActions: [makeAction<Flat>('a1', { type: 'add_to_set', path: 'tags', items: ['b', 'c'], unique_by: 'deep_equals', where: { id: '1' } })],
                        schema: FlatSchema,
                        ddl: flatDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.tags).toEqual(['a', 'b', 'c']);
                    }, implName);
                });

                test('some items already present: only new ones added', async () => {
                    const adapter = createAdapter(FlatSchema, flatDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', tags: ['a', 'b'] }],
                        writeActions: [makeAction<Flat>('a1', { type: 'add_to_set', path: 'tags', items: ['b', 'c'], unique_by: 'deep_equals', where: { id: '1' } })],
                        schema: FlatSchema,
                        ddl: flatDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.tags).toEqual(['a', 'b', 'c']);
                    }, implName);
                });

                test('all items already present: no-op', async () => {
                    const adapter = createAdapter(FlatSchema, flatDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', tags: ['a', 'b'] }],
                        writeActions: [makeAction<Flat>('a1', { type: 'add_to_set', path: 'tags', items: ['a', 'b'], unique_by: 'deep_equals', where: { id: '1' } })],
                        schema: FlatSchema,
                        ddl: flatDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.tags).toEqual(['a', 'b']);
                    }, implName);
                });

                test('internal duplicates in items are deduped', async () => {
                    const adapter = createAdapter(FlatSchema, flatDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', tags: ['a'] }],
                        writeActions: [makeAction<Flat>('a1', { type: 'add_to_set', path: 'tags', items: ['b', 'b'], unique_by: 'deep_equals', where: { id: '1' } })],
                        schema: FlatSchema,
                        ddl: flatDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.tags).toEqual(['a', 'b']);
                    }, implName);
                });
            });

            describe('object deep_equals', () => {
                test('key-order independent equality', async () => {
                    const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', sub_items: [{ sid: 's1', val: 1 }] }],
                        writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'add_to_set', path: 'sub_items', items: [{ val: 1, sid: 's1' }], unique_by: 'deep_equals', where: { id: '1' } })],
                        schema: FlatWithSubItemsSchema,
                        ddl: flatWithSubItemsDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.sub_items).toHaveLength(1);
                    }, implName);
                });

                test('different objects are added', async () => {
                    const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', sub_items: [{ sid: 's1', val: 1 }] }],
                        writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'add_to_set', path: 'sub_items', items: [{ sid: 's2', val: 2 }], unique_by: 'deep_equals', where: { id: '1' } })],
                        schema: FlatWithSubItemsSchema,
                        ddl: flatWithSubItemsDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.sub_items).toHaveLength(2);
                    }, implName);
                });
            });

            describe('pk-based', () => {
                test('same PK: item skipped', async () => {
                    const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', sub_items: [{ sid: 's1', val: 1 }] }],
                        writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'add_to_set', path: 'sub_items', items: [{ sid: 's1', val: 999 }], unique_by: 'pk', where: { id: '1' } })],
                        schema: FlatWithSubItemsSchema,
                        ddl: flatWithSubItemsDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.sub_items).toHaveLength(1);
                        expect(r.finalItems[0]!.sub_items![0]!.val).toBe(1); // not replaced
                    }, implName);
                });

                test('new PK: item added', async () => {
                    const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', sub_items: [{ sid: 's1', val: 1 }] }],
                        writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'add_to_set', path: 'sub_items', items: [{ sid: 's2', val: 2 }], unique_by: 'pk', where: { id: '1' } })],
                        schema: FlatWithSubItemsSchema,
                        ddl: flatWithSubItemsDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.sub_items).toHaveLength(2);
                    }, implName);
                });

                test('pk on scalar array: error', async () => {
                    const adapter = createAdapter(FlatSchema, flatDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', tags: ['a'] }],
                        writeActions: [makeAction<Flat>('a1', { type: 'add_to_set', path: 'tags', items: ['b'], unique_by: 'pk', where: { id: '1' } } as any)],
                        schema: FlatSchema,
                        ddl: flatDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(false);
                    }, implName);
                });
            });

            describe('field validation', () => {
                test('undefined field initialises to empty array', async () => {
                    const adapter = createAdapter(FlatSchema, flatDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1' }],
                        writeActions: [makeAction<Flat>('a1', { type: 'add_to_set', path: 'tags', items: ['a'], unique_by: 'deep_equals', where: { id: '1' } })],
                        schema: FlatSchema,
                        ddl: flatDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.tags).toEqual(['a']);
                    }, implName);
                });

                test('where matches zero items: no-op', async () => {
                    const adapter = createAdapter(FlatSchema, flatDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', tags: ['a'] }],
                        writeActions: [makeAction<Flat>('a1', { type: 'add_to_set', path: 'tags', items: ['b'], unique_by: 'deep_equals', where: { id: 'nonexistent' } })],
                        schema: FlatSchema,
                        ddl: flatDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.tags).toEqual(['a']);
                    }, implName);
                });

                test('where matches multiple items: each gets the add', async () => {
                    const adapter = createAdapter(FlatSchema, flatDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', text: 'same', tags: ['a'] }, { id: '2', text: 'same', tags: ['b'] }],
                        writeActions: [makeAction<Flat>('a1', { type: 'add_to_set', path: 'tags', items: ['z'], unique_by: 'deep_equals', where: { text: 'same' } })],
                        schema: FlatSchema,
                        ddl: flatDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems.find(x => x.id === '1')!.tags).toEqual(['a', 'z']);
                        expect(r.finalItems.find(x => x.id === '2')!.tags).toEqual(['b', 'z']);
                    }, implName);
                });
            });
        });

        // ─────────────────────────────────────────────────────────
        // 1.6 Push
        // ─────────────────────────────────────────────────────────

        describe('1.6 Push', () => {

            test('push scalars to existing array', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a'] }],
                    writeActions: [makeAction<Flat>('a1', { type: 'push', path: 'tags', items: ['b', 'c'], where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['a', 'b', 'c']);
                }, implName);
            });

            test('undefined field initialises to empty array then pushes', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction<Flat>('a1', { type: 'push', path: 'tags', items: ['x'], where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['x']);
                }, implName);
            });

            test('empty items: no-op', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a'] }],
                    writeActions: [makeAction<Flat>('a1', { type: 'push', path: 'tags', items: [], where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['a']);
                }, implName);
            });

            test('duplicates appended (no uniqueness check)', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a'] }],
                    writeActions: [makeAction<Flat>('a1', { type: 'push', path: 'tags', items: ['a', 'a'], where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['a', 'a', 'a']);
                }, implName);
            });

            test('order preserved', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: [] }],
                    writeActions: [makeAction<Flat>('a1', { type: 'push', path: 'tags', items: ['c', 'b', 'a'], where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['c', 'b', 'a']);
                }, implName);
            });

            test('push objects to array', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', sub_items: [{ sid: 's1', val: 1 }] }],
                    writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'push', path: 'sub_items', items: [{ sid: 's2', val: 2 }], where: { id: '1' } })],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.sub_items).toHaveLength(2);
                    expect(r.finalItems[0]!.sub_items![1]!.sid).toBe('s2');
                }, implName);
            });
        });

        // ─────────────────────────────────────────────────────────
        // 1.7 Pull
        // ─────────────────────────────────────────────────────────

        describe('1.7 Pull', () => {

            describe('object array (WhereFilter mode)', () => {
                test('removes elements matching where filter', async () => {
                    const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', sub_items: [{ sid: 's1', val: 1 }, { sid: 's2', val: 2 }, { sid: 's3', val: 1 }] }],
                        writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'pull', path: 'sub_items', items_where: { val: 1 }, where: { id: '1' } })],
                        schema: FlatWithSubItemsSchema,
                        ddl: flatWithSubItemsDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.sub_items).toHaveLength(1);
                        expect(r.finalItems[0]!.sub_items![0]!.sid).toBe('s2');
                    }, implName);
                });

                test('empty array: no-op', async () => {
                    const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', sub_items: [] }],
                        writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'pull', path: 'sub_items', items_where: { sid: 's1' }, where: { id: '1' } })],
                        schema: FlatWithSubItemsSchema,
                        ddl: flatWithSubItemsDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.sub_items).toEqual([]);
                    }, implName);
                });

                test('undefined field: no-op', async () => {
                    const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1' }],
                        writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'pull', path: 'sub_items', items_where: { sid: 's1' }, where: { id: '1' } })],
                        schema: FlatWithSubItemsSchema,
                        ddl: flatWithSubItemsDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                    }, implName);
                });

                test('empty items_where matches all: array emptied', async () => {
                    const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', sub_items: [{ sid: 's1' }, { sid: 's2' }] }],
                        writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'pull', path: 'sub_items', items_where: {}, where: { id: '1' } })],
                        schema: FlatWithSubItemsSchema,
                        ddl: flatWithSubItemsDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.sub_items).toEqual([]);
                    }, implName);
                });

                test('no match: no-op', async () => {
                    const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', sub_items: [{ sid: 's1', val: 1 }] }],
                        writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'pull', path: 'sub_items', items_where: { sid: 'nonexistent' }, where: { id: '1' } })],
                        schema: FlatWithSubItemsSchema,
                        ddl: flatWithSubItemsDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.sub_items).toHaveLength(1);
                    }, implName);
                });

                test('all copies removed (not just first)', async () => {
                    const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', sub_items: [{ sid: 's1', val: 5 }, { sid: 's2', val: 5 }, { sid: 's3', val: 10 }] }],
                        writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'pull', path: 'sub_items', items_where: { val: 5 }, where: { id: '1' } })],
                        schema: FlatWithSubItemsSchema,
                        ddl: flatWithSubItemsDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.sub_items).toHaveLength(1);
                        expect(r.finalItems[0]!.sub_items![0]!.sid).toBe('s3');
                    }, implName);
                });

                test('match by PK field', async () => {
                    const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', sub_items: [{ sid: 's1', val: 1 }, { sid: 's2', val: 2 }] }],
                        writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'pull', path: 'sub_items', items_where: { sid: 's1' }, where: { id: '1' } })],
                        schema: FlatWithSubItemsSchema,
                        ddl: flatWithSubItemsDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.sub_items).toHaveLength(1);
                        expect(r.finalItems[0]!.sub_items![0]!.sid).toBe('s2');
                    }, implName);
                });
            });

            describe('scalar array (value list mode)', () => {
                test('pull scalar values from array', async () => {
                    const adapter = createAdapter(FlatSchema, flatDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', tags: ['a', 'b', 'c'] }],
                        writeActions: [makeAction<Flat>('a1', { type: 'pull', path: 'tags', items_where: ['a', 'c'], where: { id: '1' } })],
                        schema: FlatSchema,
                        ddl: flatDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.tags).toEqual(['b']);
                    }, implName);
                });

                test('pull value not present: no-op', async () => {
                    const adapter = createAdapter(FlatSchema, flatDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', tags: ['a', 'b'] }],
                        writeActions: [makeAction<Flat>('a1', { type: 'pull', path: 'tags', items_where: ['z'], where: { id: '1' } })],
                        schema: FlatSchema,
                        ddl: flatDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.tags).toEqual(['a', 'b']);
                    }, implName);
                });

                test('pull all values: empty array', async () => {
                    const adapter = createAdapter(FlatSchema, flatDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', tags: ['a', 'b'] }],
                        writeActions: [makeAction<Flat>('a1', { type: 'pull', path: 'tags', items_where: ['a', 'b'], where: { id: '1' } })],
                        schema: FlatSchema,
                        ddl: flatDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.tags).toEqual([]);
                    }, implName);
                });

                test('pull with duplicates in existing array: all copies removed', async () => {
                    const adapter = createAdapter(FlatSchema, flatDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', tags: ['a', 'b', 'a', 'c'] }],
                        writeActions: [makeAction<Flat>('a1', { type: 'pull', path: 'tags', items_where: ['a'], where: { id: '1' } })],
                        schema: FlatSchema,
                        ddl: flatDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.finalItems[0]!.tags).toEqual(['b', 'c']);
                    }, implName);
                });
            });
        });

        // ─────────────────────────────────────────────────────────
        // 1.8 Inc
        // ─────────────────────────────────────────────────────────

        describe('1.8 Inc', () => {

            test('increments number', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', count: 10 }],
                    writeActions: [makeAction<Flat>('a1', { type: 'inc', path: 'count', amount: 5, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.count).toBe(15);
                }, implName);
            });

            test('undefined field initialises to 0 then adds', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction<Flat>('a1', { type: 'inc', path: 'count', amount: 7, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.count).toBe(7);
                }, implName);
            });

            test('negative amount: decrement', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', count: 10 }],
                    writeActions: [makeAction<Flat>('a1', { type: 'inc', path: 'count', amount: -3, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.count).toBe(7);
                }, implName);
            });

            test('amount 0: no-op', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', count: 10 }],
                    writeActions: [makeAction<Flat>('a1', { type: 'inc', path: 'count', amount: 0, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.count).toBe(10);
                }, implName);
            });

            test('NaN amount: error', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', count: 10 }],
                    writeActions: [makeAction<Flat>('a1', { type: 'inc', path: 'count', amount: NaN, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                }, implName);
            });
        });

        // ─────────────────────────────────────────────────────────
        // 1.9 Cross-Cutting Mutations
        // ─────────────────────────────────────────────────────────

        describe('1.9 Cross-Cutting Mutations', () => {

            test('array_scope wrapping push on nested objects', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', children: [{ cid: 'c1', items: [{ iid: 'i1', value: 1 }] }] }],
                    writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                        type: 'array_scope',
                        scope: 'children',
                        action: { type: 'push', path: 'items', items: [{ iid: 'i2', value: 2 }], where: { cid: 'c1' } },
                        where: { id: '1' },
                    }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    const child = r.finalItems[0]!.children![0]!;
                    expect(child.items).toHaveLength(2);
                    expect(child.items[1]!.iid).toBe('i2');
                }, implName);
            });

            test('array_scope wrapping inc on nested object (dot-path scope)', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', children: [{ cid: 'c1', items: [{ iid: 'i1', value: 10 }] }] }],
                    writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children.items'>({
                        type: 'array_scope',
                        scope: 'children.items',
                        action: { type: 'inc', path: 'value', amount: 5, where: { iid: 'i1' } },
                        where: { id: '1' },
                    }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    const item = r.finalItems[0]!.children![0]!.items[0]!;
                    expect(item.value).toBe(15);
                }, implName);
            });

            test('multiple mutations on same item in sequence', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a'], count: 0 }],
                    writeActions: [
                        makeAction<Flat>('a1', { type: 'push', path: 'tags', items: ['b'], where: { id: '1' } }),
                        makeAction<Flat>('a2', { type: 'inc', path: 'count', amount: 10, where: { id: '1' } }),
                        makeAction<Flat>('a3', { type: 'pull', path: 'tags', items_where: ['a'], where: { id: '1' } }),
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['b']);
                    expect(r.finalItems[0]!.count).toBe(10);
                }, implName);
            });

            test('atomic: push ok + inc error → both rolled back', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a'], count: 5 }],
                    writeActions: [
                        makeAction<Flat>('a1', { type: 'push', path: 'tags', items: ['b'], where: { id: '1' } }),
                        makeAction<Flat>('a2', { type: 'inc', path: 'count', amount: NaN, where: { id: '1' } }),
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { atomic: true },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    // In atomic mode, the original items should be unchanged
                    expect(r.finalItems[0]!.tags).toEqual(['a']);
                    expect(r.finalItems[0]!.count).toBe(5);
                }, implName);
            });
        });
    });

    // ───────────────────────────────────────────────────────────────
    // 2. Result Shape
    // ───────────────────────────────────────────────────────────────

    describe('2. Result Shape', () => {

        describe('2.1 WriteResult structure', () => {

            test('result.ok is true on full success', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                }, implName);
            });

            test('result.ok is false when any action fails', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1' } })], // duplicate PK
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                }, implName);
            });

            test('result.actions length matches input actions length', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '1' } }),
                        makeAction('a2', { type: 'create', data: { id: '2' } }),
                        makeAction('a3', { type: 'create', data: { id: '3' } }),
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.actions).toHaveLength(3);
                }, implName);
            });

            test('empty actions array: ok:true, no changes, changes.changed === false', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.result.actions).toHaveLength(0);
                    expect(r.changes.changed).toBe(false);
                    expect(r.finalItems).toHaveLength(1);
                }, implName);
            });
        });

        describe('2.2 WriteOutcome (per-action)', () => {

            test('successful action: ok:true, action uuid matches, affected_items present', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('uuid-42', { type: 'create', data: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const outcome = r.result.actions[0]!;
                    expect(outcome.ok).toBe(true);
                    expect(outcome.action.uuid).toBe('uuid-42');
                    if (outcome.ok) {
                        expect(outcome.affected_items).toBeDefined();
                    }
                }, implName);
            });

            test('affected_items contains correct PKs for each verb', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                // Create
                const r1 = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: 'new1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r1, (r) => {
                    const outcome = r.result.actions[0]!;
                    if (outcome.ok) {
                        expect(outcome.affected_items?.some(ai => ai.item_pk === 'new1')).toBe(true);
                    }
                }, implName);

                // Update
                const r2 = await adapter.apply({
                    initialItems: [{ id: '1', text: 'old' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'new' }, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r2, (r) => {
                    const outcome = r.result.actions[0]!;
                    if (outcome.ok) {
                        expect(outcome.affected_items?.some(ai => ai.item_pk === '1')).toBe(true);
                    }
                }, implName);

                // Delete
                const r3 = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', { type: 'delete', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r3, (r) => {
                    const outcome = r.result.actions[0]!;
                    if (outcome.ok) {
                        expect(outcome.affected_items?.some(ai => ai.item_pk === '1')).toBe(true);
                    }
                }, implName);
            });

            test('action uuid and ts from input are preserved in outcome', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const action = makeAction<Flat>('preserve-uuid', { type: 'create', data: { id: '1' } });
                action.ts = 1234567890;
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [action],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const outcome = r.result.actions[0]!;
                    expect(outcome.action.uuid).toBe('preserve-uuid');
                    expect(outcome.action.ts).toBe(1234567890);
                }, implName);
            });
        });

        describe('2.3 WriteChanges', () => {

            test('changes.changed is true when mutations occurred', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.changes.changed).toBe(true);
                }, implName);
            });

            test('changes.changed is false when no mutations occurred', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'x' }, where: { id: 'nonexistent' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.changes.changed).toBe(false);
                }, implName);
            });

            test('changes.insert/update/remove_keys are correct for mixed-verb batches', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'old' }, { id: '2' }],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '3' } }),
                        makeAction('a2', { type: 'update', data: { text: 'new' }, where: { id: '1' } }),
                        makeAction('a3', { type: 'delete', where: { id: '2' } }),
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.changes.insert).toHaveLength(1);
                    expect(r.changes.insert[0]!.id).toBe('3');
                    expect(r.changes.update).toHaveLength(1);
                    expect(r.changes.update[0]!.id).toBe('1');
                    expect(r.changes.remove_keys).toHaveLength(1);
                    expect(r.changes.changed).toBe(true);
                }, implName);
            });
        });
    });

    // ───────────────────────────────────────────────────────────────
    // 3. Error Handling
    // ───────────────────────────────────────────────────────────────

    describe('3. Error Handling', () => {

        describe('3.1 Schema validation', () => {

            test('create violating schema: ok:false, error type schema, unrecoverable:true', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('a1', {
                        type: 'create',
                        // @ts-ignore wilfully breaking schema
                        data: { id: '1', unknown_field: 'bad' },
                    })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    const failures = getWriteFailures(r.result);
                    expect(failures).toHaveLength(1);
                    expect(failures[0]!.errors[0]!.type).toBe('schema');
                    expect(failures[0]!.unrecoverable).toBe(true);
                }, implName);
            });

            test('update producing schema-invalid result: ok:false, error type schema', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', {
                        type: 'update',
                        // @ts-ignore wilfully breaking schema
                        data: { bad_field: 'oops' },
                        where: { id: '1' },
                    })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    const failures = getWriteFailures(r.result);
                    expect(failures[0]!.errors[0]!.type).toBe('schema');
                }, implName);
            });

            test('error includes item_pk and item context', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', {
                        type: 'update',
                        // @ts-ignore wilfully breaking schema
                        data: { bad_field: 'oops' },
                        where: { id: '1' },
                    })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const failure = getWriteFailures(r.result)[0]!;
                    expect(failure.affected_items).toBeDefined();
                    expect(failure.affected_items!.length).toBeGreaterThanOrEqual(1);
                }, implName);
            });
        });

        describe('3.2 Primary key integrity', () => {

            test('create with duplicate PK: error type create_duplicated_key', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    const errors = getWriteErrors(r.result);
                    expect(errors[0]!.type).toBe('create_duplicated_key');
                }, implName);
            });

            test('create missing PK: error type missing_key', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('a1', {
                        type: 'create',
                        // @ts-ignore missing id
                        data: { text: 'no pk' },
                    })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    const errors = getWriteErrors(r.result);
                    expect(errors[0]!.type).toBe('missing_key');
                }, implName);
            });

            test('update that changes PK: error type update_altered_key', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { id: 'changed' }, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    const errors = getWriteErrors(r.result);
                    expect(errors[0]!.type).toBe('update_altered_key');
                }, implName);
            });
        });

        describe('3.3 Helpers', () => {

            test('getWriteFailures returns only failed outcomes', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '1' } }),
                        makeAction('a2', { type: 'create', data: { id: '1' } }), // duplicate
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const failures = getWriteFailures(r.result);
                    failures.forEach(f => expect(f.ok).toBe(false));
                }, implName);
            });

            test('getWriteSuccesses returns only successful outcomes', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '1' } }),
                        makeAction('a2', { type: 'create', data: { id: '1' } }), // duplicate
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { atomic: false },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const successes = getWriteSuccesses(r.result);
                    expect(successes).toHaveLength(1);
                    successes.forEach(s => expect(s.ok).toBe(true));
                }, implName);
            });

            test('getWriteErrors returns flat array of all errors across outcomes', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '1' } }), // duplicate
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const errors = getWriteErrors(r.result);
                    expect(errors.length).toBeGreaterThanOrEqual(1);
                    expect(errors[0]!.type).toBe('create_duplicated_key');
                }, implName);
            });
        });
    });

    // ───────────────────────────────────────────────────────────────
    // 4. Sequential Halt & Blocking
    // ───────────────────────────────────────────────────────────────

    describe('4. Sequential Halt & Blocking', () => {

        test('first failure halts processing of subsequent actions', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1' }],
                writeActions: [
                    makeAction('a1', { type: 'create', data: { id: '1' } }), // fails: duplicate
                    makeAction('a2', { type: 'create', data: { id: '2' } }), // should be blocked
                ],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(false);
                expect(r.finalItems.find(x => x.id === '2')).toBeUndefined();
            }, implName);
        });

        test('subsequent actions get ok:false with blocked_by_action_uuid set', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1' }],
                writeActions: [
                    makeAction('fail-uuid', { type: 'create', data: { id: '1' } }), // fails
                    makeAction('blocked-uuid', { type: 'create', data: { id: '2' } }),
                ],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                const failures = getWriteFailures(r.result);
                const blocked = failures.find(f => f.action.uuid === 'blocked-uuid');
                expect(blocked).toBeDefined();
                expect(blocked!.blocked_by_action_uuid).toBe('fail-uuid');
            }, implName);
        });

        test('successful actions before the failure are reported as successes (non-atomic)', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [],
                writeActions: [
                    makeAction('a1', { type: 'create', data: { id: '1' } }), // succeeds
                    makeAction('a2', {
                        type: 'create',
                        // @ts-ignore missing pk
                        data: { text: 'no pk' },
                    }), // fails
                    makeAction('a3', { type: 'create', data: { id: '3' } }), // blocked
                ],
                schema: FlatSchema,
                ddl: flatDdl,
                options: { atomic: false },
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(false);
                const successes = getWriteSuccesses(r.result);
                expect(successes).toHaveLength(1);
                expect(successes[0]!.action.uuid).toBe('a1');
                expect(r.finalItems.find(x => x.id === '1')).toBeDefined();
            }, implName);
        });
    });

    // ───────────────────────────────────────────────────────────────
    // 5. Atomic vs Non-Atomic
    // ───────────────────────────────────────────────────────────────

    describe('5. Atomic vs Non-Atomic', () => {

        describe('5.1 Non-atomic (default)', () => {

            test('partial success: earlier successes kept, later blocked', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '1' } }),
                        makeAction('a2', {
                            type: 'create',
                            // @ts-ignore
                            data: { broken: true },
                        }),
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { atomic: false },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(r.finalItems.find(x => x.id === '1')).toBeDefined();
                    expect(getWriteSuccesses(r.result)).toHaveLength(1);
                }, implName);
            });

            test('changes reflect only the successful mutations', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: 'existing' }],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: 'new' } }),
                        makeAction('a2', { type: 'create', data: { id: 'existing' } }), // duplicate
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { atomic: false },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.changes.insert).toHaveLength(1);
                    expect(r.changes.insert[0]!.id).toBe('new');
                }, implName);
            });
        });

        describe('5.2 Atomic', () => {

            test('on failure: all actions fail, changes.changed is false', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: 'existing' }],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: 'new' } }),
                        makeAction('a2', { type: 'create', data: { id: 'existing' } }), // fails
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { atomic: true },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(r.changes.changed).toBe(false);
                    expect(getWriteSuccesses(r.result)).toHaveLength(0);
                }, implName);
            });

            test('finalItems match original items (complete rollback)', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const originalItems: Flat[] = [{ id: '1', text: 'keep' }];
                const r = await adapter.apply({
                    initialItems: originalItems,
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '2' } }),
                        makeAction('a2', { type: 'create', data: { id: '1' } }), // fails
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { atomic: true },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(r.finalItems).toHaveLength(1);
                    expect(r.finalItems[0]!.id).toBe('1');
                    expect(r.finalItems[0]!.text).toBe('keep');
                }, implName);
            });

            test('result.ok is false, no successes reported', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '1' } }),
                        makeAction('a2', {
                            type: 'create',
                            // @ts-ignore
                            data: { bad: true },
                        }),
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { atomic: true },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(getWriteSuccesses(r.result)).toHaveLength(0);
                }, implName);
            });
        });

        describe('5.3 Atomic + array_scope', () => {

            test('failure in nested scope rolls back everything (atomic)', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', children: [{ cid: 'c1', items: [] }] }],
                    writeActions: [
                        makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                            type: 'array_scope',
                            scope: 'children',
                            action: { type: 'update', data: { label: 'changed' }, where: { cid: 'c1' } },
                            where: { id: '1' },
                        })),
                        makeAction<Nested>('a2', assertWriteArrayScope<Nested, 'children'>({
                            type: 'array_scope',
                            scope: 'children',
                            action: {
                                type: 'create',
                                // @ts-ignore
                                data: { bad_key: 'fail' },
                            },
                            where: { id: '1' },
                        })),
                    ],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                    options: { atomic: true },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(r.changes.changed).toBe(false);
                    // children should be unchanged
                    expect(r.finalItems[0]!.children![0]!.label).toBeUndefined();
                }, implName);
            });

            test('failure in nested scope keeps prior successes (non-atomic)', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', children: [{ cid: 'c1', items: [] }] }],
                    writeActions: [
                        makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                            type: 'array_scope',
                            scope: 'children',
                            action: { type: 'update', data: { label: 'changed' }, where: { cid: 'c1' } },
                            where: { id: '1' },
                        })),
                        makeAction<Nested>('a2', assertWriteArrayScope<Nested, 'children'>({
                            type: 'array_scope',
                            scope: 'children',
                            action: {
                                type: 'create',
                                // @ts-ignore
                                data: { bad_key: 'fail' },
                            },
                            where: { id: '1' },
                        })),
                    ],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                    options: { atomic: false },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    // First action should have succeeded
                    expect(r.finalItems[0]!.children![0]!.label).toBe('changed');
                }, implName);
            });
        });
    });

    // ───────────────────────────────────────────────────────────────
    // 6. Duplicate Create Recovery
    // ───────────────────────────────────────────────────────────────

    describe('6. Duplicate Create Recovery', () => {

        describe('6.1 never (default)', () => {

            test('duplicate PK always fails', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { attempt_recover_duplicate_create: 'never' },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(getWriteErrors(r.result)[0]!.type).toBe('create_duplicated_key');
                }, implName);
            });
        });

        describe('6.2 if-convergent', () => {

            test('recovers when create data is subset of existing item', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'hello' }],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { attempt_recover_duplicate_create: 'if-convergent' },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.text).toBe('hello'); // unchanged
                }, implName, 'if-convergent recovery');
            });

            test('fails when create data contradicts existing item', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'existing' }],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1', text: 'different' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { attempt_recover_duplicate_create: 'if-convergent' },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(r.finalItems[0]!.text).toBe('existing');
                }, implName, 'if-convergent contradiction');
            });

            test('recovers when subsequent actions in batch bring items to convergence', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'target' }],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '1', text: 'wrong' } }),
                        makeAction('a2', { type: 'update', data: { text: 'target' }, where: { id: '1' } }),
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { attempt_recover_duplicate_create: 'if-convergent' },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                }, implName, 'if-convergent convergence');
            });
        });

        describe('6.3 always-update', () => {

            test('converts duplicate create to update, succeeds', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'old' }],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1', text: 'new' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { attempt_recover_duplicate_create: 'always-update' },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.text).toBe('new');
                }, implName, 'always-update recovery');
            });
        });
    });

    // ───────────────────────────────────────────────────────────────
    // 7. Permissions
    // ───────────────────────────────────────────────────────────────

    describe('7. Permissions', () => {

        describe('7.1 No permissions (type: none)', () => {

            test('all writes succeed without user', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    // no user
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                }, implName);
            });
        });

        describe('7.2 Basic ownership (id property)', () => {

            test('owner can create (owner_id matches user)', async () => {
                const adapter = createAdapter(OwnerSchema, ownerDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1', owner_id: 'user1' } })],
                    schema: OwnerSchema,
                    ddl: ownerDdl,
                    user: makeUser('user1'),
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                }, implName);
            });

            test('owner can update', async () => {
                const adapter = createAdapter(OwnerSchema, ownerDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', owner_id: 'user1', text: 'old' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'new' }, where: { id: '1' } })],
                    schema: OwnerSchema,
                    ddl: ownerDdl,
                    user: makeUser('user1'),
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.text).toBe('new');
                }, implName);
            });

            test('non-owner create denied: error type permission_denied, reason not-owner', async () => {
                const adapter = createAdapter(OwnerSchema, ownerDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1', owner_id: 'other-user' } })],
                    schema: OwnerSchema,
                    ddl: ownerDdl,
                    user: makeUser('user1'),
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    const err = getWriteErrors(r.result)[0]!;
                    expect(err.type).toBe('permission_denied');
                    if (err.type === 'permission_denied') {
                        expect(err.reason).toBe('not-owner');
                    }
                }, implName);
            });

            test('non-owner update denied', async () => {
                const adapter = createAdapter(OwnerSchema, ownerDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', owner_id: 'other-user' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'hack' }, where: { id: '1' } })],
                    schema: OwnerSchema,
                    ddl: ownerDdl,
                    user: makeUser('user1'),
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(getWriteErrors(r.result)[0]!.type).toBe('permission_denied');
                }, implName);
            });

            test('no user provided: reason no-owner-id', async () => {
                const adapter = createAdapter(OwnerSchema, ownerDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1', owner_id: 'someone' } })],
                    schema: OwnerSchema,
                    ddl: ownerDdl,
                    // no user
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    const err = getWriteErrors(r.result)[0]!;
                    expect(err.type).toBe('permission_denied');
                    if (err.type === 'permission_denied') {
                        expect(err.reason).toBe('no-owner-id');
                    }
                }, implName);
            });
        });

        describe('7.3 Ownership formats', () => {

            test('email format: matches getEmail()', async () => {
                const adapter = createAdapter(OwnerEmailSchema, ownerEmailDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1', owner_email: 'user@test.com' } })],
                    schema: OwnerEmailSchema,
                    ddl: ownerEmailDdl,
                    user: makeUser('user1', 'user@test.com'),
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                }, implName, 'email format permission');
            });

            test('scalar array: user ID found in array at path', async () => {
                const adapter = createAdapter(OwnerScalarArraySchema, ownerScalarArrayDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', owner_ids: ['user1', 'user2'] }],
                    writeActions: [makeAction('a1', { type: 'update', data: { id: '1' }, where: { id: '1' } })],
                    schema: OwnerScalarArraySchema,
                    ddl: ownerScalarArrayDdl,
                    user: makeUser('user1'),
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                }, implName, 'scalar array permission');
            });
        });

        describe('7.5 Permissions + atomic/non-atomic', () => {

            test('non-atomic: actions before permission failure kept', async () => {
                const adapter = createAdapter(OwnerSchema, ownerDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', owner_id: 'user1', text: 'old' }],
                    writeActions: [
                        makeAction('a1', { type: 'update', data: { text: 'new' }, where: { id: '1' } }),
                        makeAction('a2', { type: 'create', data: { id: '2', owner_id: 'other-user' } }), // permission denied
                    ],
                    schema: OwnerSchema,
                    ddl: ownerDdl,
                    user: makeUser('user1'),
                    options: { atomic: false },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(getWriteSuccesses(r.result)).toHaveLength(1);
                    expect(r.finalItems[0]!.text).toBe('new');
                }, implName);
            });

            test('atomic: permission failure rolls back everything', async () => {
                const adapter = createAdapter(OwnerSchema, ownerDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', owner_id: 'user1', text: 'old' }],
                    writeActions: [
                        makeAction('a1', { type: 'update', data: { text: 'new' }, where: { id: '1' } }),
                        makeAction('a2', { type: 'create', data: { id: '2', owner_id: 'other-user' } }), // permission denied
                    ],
                    schema: OwnerSchema,
                    ddl: ownerDdl,
                    user: makeUser('user1'),
                    options: { atomic: true },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(getWriteSuccesses(r.result)).toHaveLength(0);
                    expect(r.finalItems[0]!.text).toBe('old'); // rolled back
                }, implName);
            });
        });
    });

    // ───────────────────────────────────────────────────────────────
    // 8. Edge Cases & Regression
    // ───────────────────────────────────────────────────────────────

    describe('8. Edge Cases & Regression', () => {

        test('delete → create → delete → create on same PK works', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [],
                writeActions: [
                    makeAction('a1', { type: 'create', data: { id: '1', text: 'first' } }),
                    makeAction('a2', { type: 'delete', where: { id: '1' } }),
                    makeAction('a3', { type: 'create', data: { id: '1', text: 'second' } }),
                    makeAction('a4', { type: 'delete', where: { id: '1' } }),
                    makeAction('a5', { type: 'create', data: { id: '1', text: 'final' } }),
                ],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems).toHaveLength(1);
                expect(r.finalItems[0]!.text).toBe('final');
            }, implName);
        });

        test('create + update in same batch targeting same PK: both succeed sequentially', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [],
                writeActions: [
                    makeAction('a1', { type: 'create', data: { id: '1', text: 'initial' } }),
                    makeAction('a2', { type: 'update', data: { text: 'modified' }, where: { id: '1' } }),
                ],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.text).toBe('modified');
            }, implName);
        });

        test('many actions in one batch (10+): all processed correctly', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const actions: WriteAction<Flat>[] = Array.from({ length: 12 }, (_, i) =>
                makeAction(`a${i}`, { type: 'create', data: { id: `item-${i}` } })
            );
            const r = await adapter.apply({
                initialItems: [],
                writeActions: actions,
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems).toHaveLength(12);
                expect(r.result.actions).toHaveLength(12);
            }, implName);
        });
    });
}
