import { z } from "zod";
import { isTypeEqual } from "@andyrmitchell/utils";
import type {
    WriteAction,
    WritePayload,
    WritePayloadCreate,
    WritePayloadUpdate,
    WritePayloadDelete,
    WritePayloadArrayScope,
    WriteError,
    WriteErrorContext,
    WriteAffectedItem,
    WriteOutcomeOk,
    WriteOutcomeFailed,
    WriteOutcome,
    WriteResult,
} from "./types.ts";
import type { WriteChanges, WriteToItemsArrayChanges, WriteToItemsArrayResult } from "./writeToItemsArray/types.ts";
import type { DDL } from "../ddl/types.ts";
import type { DotPropPathToObjectArraySpreadingArrays, NonObjectArrayProperty } from "../dot-prop-paths/types.ts";
import { getWriteFailures, getWriteSuccesses, getWriteErrors } from "./helpers.ts";
import {
    WriteErrorSchema,
    WriteActionSchema,
    WriteResultSchema,
    WriteOutcomeSchema,
    WriteOutcomeOkSchema,
    WriteOutcomeFailedSchema,
    WriteAffectedItemSchema,
    makeWriteActionSchema,
} from "./write-action-schemas.ts";

// ═══════════════════════════════════════════════════════════════════
// Test Types (realistic domain shapes)
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

type Flat = {
    id: string;
    text?: string;
    count?: number;
    tags?: string[];
};

// ═══════════════════════════════════════════════════════════════════
// 1. WritePayload<T> construction
// ═══════════════════════════════════════════════════════════════════

describe('1. WritePayload<T> construction', () => {

    describe('1.1 Create payload', () => {

        it('accepts valid T as data', () => {
            const _create: WritePayloadCreate<Flat> = {
                type: 'create',
                data: { id: '1', text: 'hello', count: 5, tags: ['a'] },
            };
        });

        it('rejects extra properties not in T', () => {
            const _create: WritePayloadCreate<Flat> = {
                type: 'create',
                // @ts-expect-error: 'extra' does not exist in Flat
                data: { id: '1', extra: true },
            };
        });

        it('rejects wrong type for a known property', () => {
            const _create: WritePayloadCreate<Flat> = {
                type: 'create',
                // @ts-expect-error: count should be number, not string
                data: { id: '1', count: 'not-a-number' },
            };
        });
    });

    describe('1.2 Update payload', () => {

        it('accepts Partial<T> (subset of fields)', () => {
            const _update: WritePayloadUpdate<Flat> = {
                type: 'update',
                data: { text: 'new' },
                where: { id: '1' },
            };
        });

        it('accepts scalar array properties (e.g. tags: string[])', () => {
            const _update: WritePayloadUpdate<Flat> = {
                type: 'update',
                data: { tags: ['a', 'b'] },
                where: { id: '1' },
            };
        });

        it('rejects object-array properties in data', () => {
            const _update: WritePayloadUpdate<Task> = {
                type: 'update',
                // @ts-expect-error: subtasks is an object-array, forbidden in update
                data: { subtasks: [] },
                where: { id: '1' },
            };
        });

        it('rejects unknown properties', () => {
            const _update: WritePayloadUpdate<Flat> = {
                type: 'update',
                // @ts-expect-error: 'unknown_prop' does not exist
                data: { unknown_prop: 'bad' },
                where: { id: '1' },
            };
        });

        it('where-filter is correctly typed to T keys', () => {
            const _update: WritePayloadUpdate<Flat> = {
                type: 'update',
                data: { text: 'x' },
                where: { id: '1' },
            };

            const _update2: WritePayloadUpdate<Flat> = {
                type: 'update',
                data: { text: 'x' },
                // @ts-expect-error: 'nonexistent' is not a key of Flat
                where: { nonexistent: 'bad' },
            };
        });
    });

    describe('1.3 Delete payload', () => {

        it('accepts valid where-filter', () => {
            const _del: WritePayloadDelete<Flat> = {
                type: 'delete',
                where: { id: '1' },
            };
        });

        it('rejects where-filter with unknown keys', () => {
            const _del: WritePayloadDelete<Flat> = {
                type: 'delete',
                // @ts-expect-error: 'fake' is not a key of Flat
                where: { fake: 'bad' },
            };
        });
    });

    describe('1.4 Array scope payload', () => {

        it('accepts valid scope path to object-array', () => {
            const _scope: WritePayloadArrayScope<Task, 'subtasks'> = {
                type: 'array_scope',
                scope: 'subtasks',
                action: { type: 'create', data: { sid: 's1', items: [] } },
                where: { id: '1' },
            };
        });

        it('scoped action is correctly typed to the nested element type', () => {
            const _scope: WritePayloadArrayScope<Task, 'subtasks'> = {
                type: 'array_scope',
                scope: 'subtasks',
                action: {
                    type: 'update',
                    data: { label: 'new' }, // label is a key of subtask element
                    where: { sid: 's1' },
                },
                where: { id: '1' },
            };
        });

        it('deeply nested scope works (subtasks.items)', () => {
            const _scope: WritePayloadArrayScope<Task, 'subtasks.items'> = {
                type: 'array_scope',
                scope: 'subtasks.items',
                action: { type: 'create', data: { iid: 'i1', value: 42 } },
                where: { id: '1' },
            };
        });
    });
});

// ═══════════════════════════════════════════════════════════════════
// 2. WriteAction<T> envelope
// ═══════════════════════════════════════════════════════════════════

describe('2. WriteAction<T> envelope', () => {

    it('accepts valid {type:write, ts, uuid, payload}', () => {
        const _action: WriteAction<Flat> = {
            type: 'write',
            ts: Date.now(),
            uuid: 'abc-123',
            payload: { type: 'create', data: { id: '1' } },
        };
    });

    it('rejects missing uuid', () => {
        // @ts-expect-error: uuid is required
        const _action: WriteAction<Flat> = {
            type: 'write',
            ts: Date.now(),
            payload: { type: 'create', data: { id: '1' } },
        };
    });

    it('rejects missing ts', () => {
        // @ts-expect-error: ts is required
        const _action: WriteAction<Flat> = {
            type: 'write',
            uuid: 'abc',
            payload: { type: 'create', data: { id: '1' } },
        };
    });
});

// ═══════════════════════════════════════════════════════════════════
// 3. WriteResult<T> / WriteOutcome<T> narrowing
// ═══════════════════════════════════════════════════════════════════

describe('3. WriteResult<T> / WriteOutcome<T> narrowing', () => {

    describe('3.1 WriteOutcome discriminated union', () => {

        it('after checking ok:true, affected_items is accessible', () => {
            const outcome: WriteOutcome<Flat> = {} as WriteOutcome<Flat>;
            if (outcome.ok) {
                // Should compile: affected_items exists on WriteOutcomeOk
                const _items = outcome.affected_items;
            }
        });

        it('after checking ok:false, errors and blocked_by_action_uuid are accessible', () => {
            const outcome: WriteOutcome<Flat> = {} as WriteOutcome<Flat>;
            if (!outcome.ok) {
                const _errors = outcome.errors;
                const _blocked = outcome.blocked_by_action_uuid;
                const _unrecoverable = outcome.unrecoverable;
            }
        });

        it('errors is not accessible without narrowing', () => {
            const outcome: WriteOutcome<Flat> = {} as WriteOutcome<Flat>;
            // @ts-expect-error: errors only exists after narrowing to ok:false
            const _errors = outcome.errors;
        });
    });

    describe('3.2 WriteResult is NOT discriminated', () => {

        it('result.ok and result.actions always accessible regardless of ok value', () => {
            const result: WriteResult<Flat> = {} as WriteResult<Flat>;
            // Both should compile without narrowing
            const _ok = result.ok;
            const _actions = result.actions;
            const _error = result.error;
        });

        it('result.actions[0] requires narrowing before accessing .errors', () => {
            const result: WriteResult<Flat> = { ok: false, actions: [] };
            // Provide a dummy outcome to test compile-time narrowing
            const outcome: WriteOutcome<Flat> = { ok: true, action: { type: 'write', ts: 0, uuid: 'x', payload: { type: 'create', data: { id: '1' } } } };
            // @ts-expect-error: outcome is WriteOutcome, must narrow to access errors
            const _errors = outcome.errors;
        });
    });
});

// ═══════════════════════════════════════════════════════════════════
// 4. WriteError discriminated union
// ═══════════════════════════════════════════════════════════════════

describe('4. WriteError discriminated union', () => {

    describe('4.1 Narrowing on type', () => {

        it('type:schema -> .issues accessible', () => {
            const error: WriteError = {} as WriteError;
            if (error.type === 'schema') {
                const _issues = error.issues;
                const _tested = error.tested_item;
            }
        });

        it('type:permission_denied -> .reason accessible', () => {
            const error: WriteError = {} as WriteError;
            if (error.type === 'permission_denied') {
                const _reason = error.reason;
            }
        });

        it('type:custom -> .message accessible', () => {
            const error: WriteError = {} as WriteError;
            if (error.type === 'custom') {
                const _msg = error.message;
            }
        });

        it('.issues not accessible on type:custom', () => {
            const error: WriteError = {} as WriteError;
            if (error.type === 'custom') {
                // @ts-expect-error: issues only exists on type:'schema'
                const _issues = error.issues;
            }
        });

        it('type:missing_key -> .primary_key accessible', () => {
            const error: WriteError = {} as WriteError;
            if (error.type === 'missing_key') {
                const _pk = error.primary_key;
            }
        });
    });

    describe('4.2 Exhaustiveness', () => {

        it('switch on all WriteError.type variants: unhandled resolves to never', () => {
            const error: WriteError = {} as WriteError;
            switch (error.type) {
                case 'custom': break;
                case 'schema': break;
                case 'missing_key': break;
                case 'update_altered_key': break;
                case 'create_duplicated_key': break;
                case 'permission_denied': break;
                default: {
                    // If all cases are handled, this should resolve to never
                    const _exhaustive: never = error;
                }
            }
        });
    });
});

// ═══════════════════════════════════════════════════════════════════
// 5. DDL<T> type constraints
// ═══════════════════════════════════════════════════════════════════

describe('5. DDL<T> type constraints', () => {

    it('lists[.] requires keys of T for primary_key', () => {
        const _ddl: DDL<Flat> = {
            version: 1,
            lists: {
                '.': { primary_key: 'id' },
            },
            ownership: { type: 'none' },
        };
    });

    it('rejects unknown property name as primary_key', () => {
        const _ddl: DDL<Flat> = {
            version: 1,
            lists: {
                // @ts-expect-error: 'nonexistent' is not a PK property of Flat
                '.': { primary_key: 'nonexistent' },
            },
            ownership: { type: 'none' },
        };
    });

    it('nested list keys match DotPropPathToObjectArraySpreadingArrays<T>', () => {
        const _ddl: DDL<Task> = {
            version: 1,
            lists: {
                '.': { primary_key: 'id' },
                'subtasks': { primary_key: 'sid' },
                'subtasks.items': { primary_key: 'iid' },
            },
            ownership: { type: 'none' },
        };
    });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Helper function return types
// ═══════════════════════════════════════════════════════════════════

describe('6. Helper function return types', () => {

    it('getWriteFailures returns WriteOutcomeFailed<T>[]', () => {
        const result: WriteResult<Flat> = { ok: false, actions: [] };
        const failures = getWriteFailures(result);
        isTypeEqual<typeof failures, WriteOutcomeFailed<Flat>[]>(true);
        // Accessing .errors should work without narrowing (already narrowed)
        if (failures[0]) {
            const _errors = failures[0].errors;
        }
    });

    it('getWriteSuccesses returns WriteOutcomeOk<T>[]', () => {
        const result: WriteResult<Flat> = { ok: true, actions: [] };
        const successes = getWriteSuccesses(result);
        isTypeEqual<typeof successes, WriteOutcomeOk<Flat>[]>(true);
        if (successes[0]) {
            const _items = successes[0].affected_items;
        }
    });

    it('getWriteErrors returns WriteErrorContext<T>[]', () => {
        const result: WriteResult<Flat> = { ok: false, actions: [] };
        const errors = getWriteErrors(result);
        isTypeEqual<typeof errors, WriteErrorContext<Flat>[]>(true);
        if (errors[0]) {
            const _type = errors[0].type;
            const _pk = errors[0].item_pk;
        }
    });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Path & Property Type Helpers
// ═══════════════════════════════════════════════════════════════════

describe('7. Path & Property Type Helpers', () => {

    it('DotPropPathToObjectArraySpreadingArrays<T> correctly infers paths', () => {
        type Paths = DotPropPathToObjectArraySpreadingArrays<Task>;
        // These should be valid paths
        const _p1: Paths = 'subtasks';
        const _p2: Paths = 'subtasks.items';
    });

    it('NonObjectArrayProperty<T>: exactly the non-object-array keys', () => {
        type NonObjArr = NonObjectArrayProperty<Task>;
        // These should be valid
        const _k1: NonObjArr = 'id';
        const _k2: NonObjArr = 'title';
        const _k3: NonObjArr = 'count';
        const _k4: NonObjArr = 'tags'; // scalar array: allowed

        // @ts-expect-error: subtasks is an object-array, should be excluded
        const _k5: NonObjArr = 'subtasks';
    });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Schema <-> Type alignment (bidirectional)
// ═══════════════════════════════════════════════════════════════════

describe('8. Schema <-> Type alignment', () => {

    it('z.infer of WriteActionSchema satisfies WriteAction<any>', () => {
        isTypeEqual<z.infer<typeof WriteActionSchema>, WriteAction<any>>(true);
    });

    it('z.infer of WriteResultSchema satisfies WriteResult<any>', () => {
        isTypeEqual<z.infer<typeof WriteResultSchema>, WriteResult<any>>(true);
    });

    it('z.infer of WriteOutcomeSchema satisfies WriteOutcome<any>', () => {
        isTypeEqual<z.infer<typeof WriteOutcomeSchema>, WriteOutcome<any>>(true);
    });

    it('z.infer of WriteErrorSchema satisfies WriteError', () => {
        isTypeEqual<z.infer<typeof WriteErrorSchema>, WriteError>(true);
    });

    it('z.infer of WriteOutcomeOkSchema satisfies WriteOutcomeOk<any>', () => {
        isTypeEqual<z.infer<typeof WriteOutcomeOkSchema>, WriteOutcomeOk<any>>(true);
    });

    it('z.infer of WriteOutcomeFailedSchema satisfies WriteOutcomeFailed<any>', () => {
        isTypeEqual<z.infer<typeof WriteOutcomeFailedSchema>, WriteOutcomeFailed<any>>(true);
    });

    it('z.infer of WriteAffectedItemSchema satisfies WriteAffectedItem<any>', () => {
        isTypeEqual<z.infer<typeof WriteAffectedItemSchema>, WriteAffectedItem<any>>(true);
    });

    it('makeWriteActionSchema validates correctly against runtime data', () => {
        const schema = z.object({ id: z.string(), text: z.string() });
        const actionSchema = makeWriteActionSchema(schema);

        const valid = actionSchema.safeParse({
            type: 'write', ts: 1, uuid: 'x',
            payload: { type: 'create', data: { id: '1', text: 'hi' } },
        });
        expect(valid.success).toBe(true);

        const invalid = actionSchema.safeParse({
            type: 'write', ts: 1, uuid: 'x',
            payload: { type: 'create', data: { id: '1', text: 'hi', extra: true } },
        });
        expect(invalid.success).toBe(false);
    });

    it('WriteResultSchema validates a minimal result', () => {
        expect(WriteResultSchema.safeParse({ ok: true, actions: [] }).success).toBe(true);
    });
});
