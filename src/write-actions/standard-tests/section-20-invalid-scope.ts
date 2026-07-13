import { z } from "zod";
import type { WriteAction } from "../types.ts";
import type { DDL } from "../../ddl/types.ts";
import { NestedSchema, nestedDdl, type Nested } from "./fixtures.ts";
import { makeAction, expectOrAcknowledgeUnsupported, type SectionCtx, type WriteTestAdapterResult } from "./harness.ts";
import { getWriteErrors, getWriteFailures } from "../helpers.ts";

/**
 * §20: portable `invalid_scope` rejection.
 *
 * An `array_scope.scope` is caller-suppliable payload data, and only a path to a declared array of objects
 * can ever be a write target. Everything else — an inherited name reachable through a plain object's
 * prototype chain (`constructor`, `toString`, …), a typo, or a declared non-array field — must be rejected
 * as a value (`ok:false` with `invalid_scope`), never a throw, leaving the world untouched.
 *
 * Two behaviours here are easy to get wrong in an implementation:
 *  - a scope must be judged against DECLARED fields only (own-property, not a denylist): an undeclared
 *    `toString` is absent, while a declared field genuinely named `toString` is writable;
 *  - a matched item whose OPTIONAL scoped array is absent contributes zero targets, exactly like a
 *    present-but-empty array — it is schema-valid data, not an error and not a crash.
 */
export function registerInvalidScope(ctx: SectionCtx): void {
    const { describe, test, expect, createAdapter, implName, itIfSupported } = ctx;
    const itCorpus = itIfSupported('invalidWhereCorpus');

    // A deliberately-bad scope is not type-valid; cast at the single sanctioned boundary.
    const scopePayload = <T extends Record<string, any>>(p: unknown): WriteAction<T>['payload'] => p as WriteAction<T>['payload'];

    const scopedUpdate = (scope: string) => makeAction<Nested>('a1', scopePayload<Nested>({
        type: 'array_scope', scope, where: { id: '1' },
        action: { type: 'update', data: { label: 'x' }, where: { cid: 'c1' } },
    }));
    const seed = (): Nested[] => [{ id: '1', children: [{ cid: 'c1', items: [] }] }];

    /** Assert the batch was rejected with `invalid_scope` (scope + reason), unrecoverably, leaving the world untouched. */
    const expectInvalidScope = (
        r: WriteTestAdapterResult<Nested>,
        scope: string,
        reason: 'disallowed_segment' | 'unknown_path' | 'not_an_object_array',
        world: Nested[],
    ): void => expectOrAcknowledgeUnsupported(r, (r) => {
        expect(r.result.ok).toBe(false);
        const err = getWriteErrors(r.result)[0];
        expect(err?.type).toBe('invalid_scope');
        if (err && err.type === 'invalid_scope') {
            expect(err.scope).toBe(scope);
            expect(err.reason).toBe(reason);
        }
        expect(getWriteFailures(r.result)[0]?.unrecoverable).toBe(true);
        expect(r.finalItems).toEqual(world);
    }, implName);

    describe('20. Invalid array_scope scope rejection', () => {

        describe('20.1 an unwritable scope is rejected as a value, world untouched', () => {

            // T-20.1
            itCorpus('a scope naming an inherited prototype member is disallowed_segment', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: seed(),
                    writeActions: [scopedUpdate('constructor')],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectInvalidScope(r, 'constructor', 'disallowed_segment', seed());
            });

            // T-20.2
            itCorpus('a scope the schema does not declare is unknown_path', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: seed(),
                    writeActions: [scopedUpdate('nonexistent')],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectInvalidScope(r, 'nonexistent', 'unknown_path', seed());
            });

            // T-20.3
            itCorpus('a scope to a declared non-array field is not_an_object_array', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: seed(),
                    writeActions: [scopedUpdate('id')],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectInvalidScope(r, 'id', 'not_an_object_array', seed());
            });
        });

        describe('20.2 a valid scope over schema-valid data never crashes', () => {

            // T-20.4
            test('a matched item whose optional scoped array is ABSENT is zero targets, like an empty one', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [scopedUpdate('children')],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems).toEqual([{ id: '1' }]); // the field is not conjured into existence
                }, implName);
            });

            // T-20.5 — the positive control for T-20.1: writability is decided by DECLARED fields
            // (own-property), not by a name denylist.
            test('a DECLARED object-array field named after an inherited member is writable', async () => {
                const ToStringSchema = z.object({
                    id: z.string(),
                    toString: z.array(z.object({ tid: z.string(), mark: z.string().optional() }).strict()).optional(),
                }).strict();
                type Row = z.infer<typeof ToStringSchema>;
                const ddl: DDL<Row> = {
                    version: 1,
                    lists: {
                        '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } },
                        'toString': { primary_key: 'tid' },
                    },
                };
                const adapter = createAdapter(ToStringSchema, ddl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', toString: [{ tid: 't1' }] }],
                    writeActions: [makeAction<Row>('a1', scopePayload<Row>({
                        type: 'array_scope', scope: 'toString', where: { id: '1' },
                        action: { type: 'update', data: { mark: 'm' }, where: { tid: 't1' } },
                    }))],
                    schema: ToStringSchema,
                    ddl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems).toEqual([{ id: '1', toString: [{ tid: 't1', mark: 'm' }] }]);
                }, implName);
            });
        });
    });
}
