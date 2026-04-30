import { describe, expect, it } from 'vitest';
import { isTypeEqual } from '@andyrmitchell/utils';
import type { WriteAction, WritePayload } from './types.ts';
import { assertWriteArrayScope } from './helpers.ts';
import { getWrittenPaths } from './getWrittenPaths.ts';

// ═══════════════════════════════════════════════════════════════════
// Test fixtures (mirrors the realistic shape used in types.test.ts)
// ═══════════════════════════════════════════════════════════════════

type Task = {
    id: string;
    title: string;
    count?: number;
    tags?: string[];
    subtasks: {
        sid: string;
        label?: string;
        items: {
            iid: string;
            value?: number;
        }[];
    }[];
    owner?: { name: string; age: number };
};

type Subtask = Task['subtasks'][number];
type Item = Subtask['items'][number];

type AllOptional = { a?: string; b?: number; c?: string };

const baseEnvelope = { type: 'write' as const, ts: 0, uuid: 'u' };


// ═══════════════════════════════════════════════════════════════════
// 1. Per-payload-type behaviour (the core contract)
// ═══════════════════════════════════════════════════════════════════

describe('1. Per-payload-type behaviour', () => {

    describe('1.1 create', () => {

        it('returns the keys being inserted', () => {
            const action: WriteAction<Task> = {
                ...baseEnvelope,
                payload: { type: 'create', data: { id: '1', title: 't', subtasks: [] } },
            };
            expect(getWrittenPaths(action).sort()).toEqual(['id', 'subtasks', 'title']);
        });
    });

    describe('1.2 update', () => {

        it('returns only the changed keys, not all keys of T', () => {
            const action: WriteAction<Task> = {
                ...baseEnvelope,
                payload: { type: 'update', data: { title: 'new' }, where: { id: '1' } },
            };
            expect(getWrittenPaths(action)).toEqual(['title']);
        });
    });

    describe('1.3 delete', () => {

        it('returns [] because delete operates on whole items, not on fields', () => {
            const action: WriteAction<Task> = {
                ...baseEnvelope,
                payload: { type: 'delete', where: { id: '1' } },
            };
            // Forbidden state: delete must NEVER produce field paths — it has no
            // field-level footprint by definition.
            expect(getWrittenPaths(action)).toEqual([]);
        });
    });

    describe('1.4 push / pull / add_to_set / inc', () => {

        it('returns the array field for push', () => {
            const action: WriteAction<Task> = {
                ...baseEnvelope,
                payload: { type: 'push', path: 'subtasks', items: [], where: { id: '1' } },
            };
            expect(getWrittenPaths(action)).toEqual(['subtasks']);
        });

        it('returns the array field for pull', () => {
            const action: WriteAction<Task> = {
                ...baseEnvelope,
                payload: { type: 'pull', path: 'subtasks', items_where: { sid: 's1' }, where: { id: '1' } },
            };
            expect(getWrittenPaths(action)).toEqual(['subtasks']);
        });

        it('returns the array field for add_to_set', () => {
            const action: WriteAction<Task> = {
                ...baseEnvelope,
                payload: { type: 'add_to_set', path: 'subtasks', items: [], unique_by: 'pk', where: { id: '1' } },
            };
            expect(getWrittenPaths(action)).toEqual(['subtasks']);
        });

        it('returns the field for inc', () => {
            const action: WriteAction<Task> = {
                ...baseEnvelope,
                payload: { type: 'inc', path: 'count', amount: 1, where: { id: '1' } },
            };
            expect(getWrittenPaths(action)).toEqual(['count']);
        });
    });

    describe('1.5 array_scope', () => {

        it('returns the nested dot-prop path for a flat-scope array_scope (scope is a single key)', () => {
            const action: WriteAction<Task> = {
                ...baseEnvelope,
                payload: assertWriteArrayScope<Task, 'subtasks'>({
                    type: 'array_scope',
                    scope: 'subtasks',
                    action: { type: 'update', data: { label: 'x' }, where: { sid: 's1' } },
                    where: { id: '1' },
                }),
            };
            expect(getWrittenPaths(action)).toEqual(['subtasks.label']);
        });

        it('returns the deeply-prefixed path when the scope is itself a dot-path', () => {
            const action: WriteAction<Task> = {
                ...baseEnvelope,
                payload: assertWriteArrayScope<Task, 'subtasks.items'>({
                    type: 'array_scope',
                    scope: 'subtasks.items',
                    action: { type: 'update', data: { value: 7 }, where: { iid: 'i1' } },
                    where: { id: '1' },
                }),
            };
            expect(getWrittenPaths(action)).toEqual(['subtasks.items.value']);
        });

        it('recurses through nested array_scope objects, prefixing at each level', () => {
            const innerScope = assertWriteArrayScope<Subtask, 'items'>({
                type: 'array_scope',
                scope: 'items',
                action: { type: 'update', data: { value: 7 }, where: { iid: 'i1' } },
                where: { sid: 's1' },
            });
            const action: WriteAction<Task> = {
                ...baseEnvelope,
                payload: assertWriteArrayScope<Task, 'subtasks'>({
                    type: 'array_scope',
                    scope: 'subtasks',
                    action: innerScope,
                    where: { id: '1' },
                }),
            };
            expect(getWrittenPaths(action)).toEqual(['subtasks.items.value']);
        });

        it('prefixes a non-update inner action (push) with the scope', () => {
            const action: WriteAction<Task> = {
                ...baseEnvelope,
                payload: assertWriteArrayScope<Task, 'subtasks'>({
                    type: 'array_scope',
                    scope: 'subtasks',
                    action: { type: 'push', path: 'items', items: [], where: { sid: 's1' } },
                    where: { id: '1' },
                }),
            };
            expect(getWrittenPaths(action)).toEqual(['subtasks.items']);
        });
    });
});


// ═══════════════════════════════════════════════════════════════════
// 2. Edge cases
// ═══════════════════════════════════════════════════════════════════

describe('2. Edge cases', () => {

    it('returns [] for create with no data fields', () => {
        const action: WriteAction<AllOptional> = {
            ...baseEnvelope,
            payload: { type: 'create', data: {} },
        };
        expect(getWrittenPaths(action)).toEqual([]);
    });

    it('returns [] for update with no data fields', () => {
        const action: WriteAction<Task> = {
            ...baseEnvelope,
            payload: { type: 'update', data: {}, where: { id: '1' } },
        };
        expect(getWrittenPaths(action)).toEqual([]);
    });

    it('preserves data-key insertion order in the returned paths', () => {
        // Object.keys is insertion-ordered for string keys; pinning that contract.
        const action: WriteAction<Task> = {
            ...baseEnvelope,
            payload: { type: 'create', data: { id: '1', title: 't', subtasks: [] } },
        };
        expect(getWrittenPaths(action)).toEqual(['id', 'title', 'subtasks']);
    });

    it('handles single-key data', () => {
        const action: WriteAction<Task> = {
            ...baseEnvelope,
            payload: { type: 'update', data: { title: 'only' }, where: { id: '1' } },
        };
        expect(getWrittenPaths(action)).toEqual(['title']);
    });

    it('handles many-key data without truncation or dedupe', () => {
        const action: WriteAction<Task> = {
            ...baseEnvelope,
            payload: { type: 'update', data: { title: 't', count: 1, tags: [] }, where: { id: '1' } },
        };
        expect(getWrittenPaths(action).sort()).toEqual(['count', 'tags', 'title']);
    });
});


// ═══════════════════════════════════════════════════════════════════
// 3. Invariants & metamorphic properties
// ═══════════════════════════════════════════════════════════════════

describe('3. Invariants & metamorphic properties', () => {

    it('is idempotent — repeated calls produce the same array', () => {
        const action: WriteAction<Task> = {
            ...baseEnvelope,
            payload: { type: 'update', data: { title: 'x', count: 1 }, where: { id: '1' } },
        };
        expect(getWrittenPaths(action)).toEqual(getWrittenPaths(action));
    });

    it('does not mutate the input action', () => {
        const action: WriteAction<Task> = {
            ...baseEnvelope,
            payload: assertWriteArrayScope<Task, 'subtasks'>({
                type: 'array_scope',
                scope: 'subtasks',
                action: { type: 'update', data: { label: 'new' }, where: { sid: 's1' } },
                where: { id: '1' },
            }),
        };
        const snapshot = structuredClone(action);
        getWrittenPaths(action);
        expect(action).toEqual(snapshot);
    });

    it('returns a fresh array on each call — caller may mutate freely', () => {
        const action: WriteAction<Task> = {
            ...baseEnvelope,
            payload: { type: 'update', data: { title: 'x' }, where: { id: '1' } },
        };
        const a = getWrittenPaths(action);
        const b = getWrittenPaths(action);
        expect(a).not.toBe(b);
        a.push('mutated-by-caller');
        expect(getWrittenPaths(action)).not.toContain('mutated-by-caller');
    });

    it('metamorphic: wrapping payload P in array_scope("subtasks") prefixes every output of P with "subtasks."', () => {
        // Run getWrittenPaths against the inner payload at the Subtask level...
        const inner: WriteAction<Subtask> = {
            ...baseEnvelope,
            payload: { type: 'update', data: { label: 'new' }, where: { sid: 's1' } },
        };
        const innerPaths = getWrittenPaths(inner);

        // ...then wrap that same payload in array_scope and confirm every path is prefixed.
        const wrapped: WriteAction<Task> = {
            ...baseEnvelope,
            payload: assertWriteArrayScope<Task, 'subtasks'>({
                type: 'array_scope',
                scope: 'subtasks',
                action: { type: 'update', data: { label: 'new' }, where: { sid: 's1' } },
                where: { id: '1' },
            }),
        };
        const wrappedPaths = getWrittenPaths(wrapped);

        expect(wrappedPaths).toEqual(innerPaths.map(p => `subtasks.${p}`));
    });

    it('metamorphic: composing array_scope("subtasks", array_scope("items", P)) prefixes paths with "subtasks.items."', () => {
        const innerInner: WriteAction<Item> = {
            ...baseEnvelope,
            payload: { type: 'update', data: { value: 7 }, where: { iid: 'i1' } },
        };
        const innerInnerPaths = getWrittenPaths(innerInner);

        const composed: WriteAction<Task> = {
            ...baseEnvelope,
            payload: assertWriteArrayScope<Task, 'subtasks'>({
                type: 'array_scope',
                scope: 'subtasks',
                action: assertWriteArrayScope<Subtask, 'items'>({
                    type: 'array_scope',
                    scope: 'items',
                    action: { type: 'update', data: { value: 7 }, where: { iid: 'i1' } },
                    where: { sid: 's1' },
                }),
                where: { id: '1' },
            }),
        };
        const composedPaths = getWrittenPaths(composed);

        expect(composedPaths).toEqual(innerInnerPaths.map(p => `subtasks.items.${p}`));
    });

    it('every returned path is a non-empty string with no leading/trailing/consecutive dots', () => {
        const samples: WriteAction<Task>[] = [
            { ...baseEnvelope, payload: { type: 'create', data: { id: '1', title: 't', subtasks: [] } } },
            { ...baseEnvelope, payload: { type: 'update', data: { title: 'x' }, where: { id: '1' } } },
            { ...baseEnvelope, payload: { type: 'delete', where: { id: '1' } } },
            { ...baseEnvelope, payload: { type: 'push', path: 'subtasks', items: [], where: { id: '1' } } },
            { ...baseEnvelope, payload: { type: 'inc', path: 'count', amount: 1, where: { id: '1' } } },
            { ...baseEnvelope, payload: assertWriteArrayScope<Task, 'subtasks.items'>({
                type: 'array_scope',
                scope: 'subtasks.items',
                action: { type: 'update', data: { value: 7 }, where: { iid: 'i1' } },
                where: { id: '1' },
            }) },
        ];
        for (const action of samples) {
            for (const path of getWrittenPaths(action)) {
                expect(path.length).toBeGreaterThan(0);
                expect(path.startsWith('.')).toBe(false);
                expect(path.endsWith('.')).toBe(false);
                expect(path.includes('..')).toBe(false);
            }
        }
    });
});


// ═══════════════════════════════════════════════════════════════════
// 4. Type-level contract
// ═══════════════════════════════════════════════════════════════════

describe('4. Type-level contract', () => {

    it('return type is exactly string[]', () => {
        const action: WriteAction<Task> = {
            ...baseEnvelope,
            payload: { type: 'create', data: { id: '1', title: 't', subtasks: [] } },
        };
        const paths = getWrittenPaths(action);
        isTypeEqual<typeof paths, string[]>(true);
    });

    // The negative cases below assert the parameter type rejects bad shapes at
    // compile time. They MUST NOT invoke getWrittenPaths — vitest would execute
    // those calls and crash on the malformed input. Instead each test assigns a
    // bad value to the param type so `@ts-expect-error` is the only signal.

    it('rejects a raw WritePayload (must be wrapped in a WriteAction envelope)', () => {
        type Param = Parameters<typeof getWrittenPaths>[0];
        const rawPayload: WritePayload<Task> = { type: 'create', data: { id: '1', title: 't', subtasks: [] } };
        // @ts-expect-error: a raw payload is missing the {type:'write', ts, uuid} envelope
        const _check: Param = rawPayload;
    });

    it('rejects an envelope missing type:"write"', () => {
        type Param = Parameters<typeof getWrittenPaths>[0];
        // @ts-expect-error: missing the literal 'type: write' discriminator
        const _check: Param = { ts: 0, uuid: 'u', payload: { type: 'create', data: { id: '1', title: 't', subtasks: [] } } };
    });

    it('rejects null / undefined', () => {
        type Param = Parameters<typeof getWrittenPaths>[0];
        // @ts-expect-error: null is not a WriteAction
        const _checkNull: Param = null;
        // @ts-expect-error: undefined is not a WriteAction
        const _checkUndef: Param = undefined;
    });

    it('preserves the generic across distinct T values without leaking T into the return type', () => {
        type Flat = { id: string; text?: string };
        const flatAction: WriteAction<Flat> = {
            ...baseEnvelope,
            payload: { type: 'create', data: { id: '1' } },
        };
        const taskAction: WriteAction<Task> = {
            ...baseEnvelope,
            payload: { type: 'create', data: { id: '1', title: 't', subtasks: [] } },
        };
        const f = getWrittenPaths(flatAction);
        const t = getWrittenPaths(taskAction);
        // Return type stays string[] regardless of T — paths are strings, not keys-of-T.
        isTypeEqual<typeof f, string[]>(true);
        isTypeEqual<typeof t, string[]>(true);
    });
});
