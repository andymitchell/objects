import { BoundedSchema, boundedDdl } from "./fixtures.ts";
import { makeAction, expectOrAcknowledgeUnsupported, type SectionCtx } from "./harness.ts";
import { getWriteErrors } from "../helpers.ts";

/**
 * §17: multi-match partial failure (atomic-per-action).
 *
 * When one action matches N rows and a later row fails post-merge validation, the ideal is that the action
 * is ATOMIC across its matched rows: it fails as exactly ONE outcome under its uuid, and NONE of the N rows
 * commit. Rationale: the action is the unit of idempotency (uuid-keyed), so a partial commit paired with a
 * failure report is unreplayable and breaks `actions.length === input.length`.
 *
 * The reference today commits the passing rows and emits TWO outcomes under the one uuid — hence this is
 * registered expected-fail-today.
 *
 * (Ordering note, no test: submission-order is the ideal for result.actions, but under halt-on-first-failure
 * the reference's successes-then-failures order coincides with submission order in every constructible
 * scenario — a test cannot discriminate, so none is written.)
 */
export function registerMultiMatchPartialFailure(ctx: SectionCtx): void {
    const { expect, createAdapter, implName, expectedFailToday } = ctx;

    describe('17. Multi-match partial failure (atomic-per-action)', () => {

        // T-17.1 [EF] — reference emits TWO outcomes under one uuid (a success for the passing rows + a
        // failure for the violating row) and commits the passing rows; the ideal is one atomic failure.
        expectedFailToday('an update matching 3 rows where the last fails validation fails atomically, committing nothing', async () => {
            const adapter = createAdapter(BoundedSchema, boundedDdl);
            const r = await adapter.apply({
                initialItems: [
                    { id: '1', grp: 'g', count: 1 },
                    { id: '2', grp: 'g', count: 2 },
                    { id: '3', grp: 'g', count: 20 }, // pre-violates count.max(10); seeding does not validate
                ],
                writeActions: [makeAction('a1', { type: 'update', data: { text: 'touched' }, where: { grp: 'g' } })],
                schema: BoundedSchema,
                ddl: boundedDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.actions).toHaveLength(1);
                const forA1 = r.result.actions.filter(o => o.action_uuid === 'a1');
                expect(forA1).toHaveLength(1);
                expect(forA1[0]!.ok).toBe(false);
                expect(getWriteErrors(r.result)[0]?.type).toBe('schema');
                expect(r.finalItems.find(x => x.id === '1')!.text).toBeUndefined();
                expect(r.finalItems.find(x => x.id === '2')!.text).toBeUndefined();
                expect(r.changes.changed).toBe(false);
            }, implName);
        });
    });
}
