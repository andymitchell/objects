import { StructuralArraySchema, type StructuralArray } from "./fixtures.ts";
import type { WhereFilterDefinition } from "../types.ts";
import type { SectionCtx } from "./harness.ts";

/**
 * §27. Structural operands compare by structure, not by serialized text.
 *
 * An operand may be an array or an object rather than a scalar — `{matrix: {$all: [[1, 2]]}}` asks for a
 * row whose `matrix` contains the element `[1, 2]`. Comparing such an operand by rendering both sides to
 * JSON text is wrong in two ways that no amount of care in the caller can avoid:
 *
 *  - **Whitespace.** A store's canonical rendering need not match `JSON.stringify`'s. Postgres's `jsonb`
 *    prints `[1, 2]`; `JSON.stringify` produces `[1,2]`.
 *  - **Key order.** `{a: 1, b: 2}` and `{b: 2, a: 1}` are the same object and must compare equal, but
 *    their serializations differ, and a store preserves whatever order it was given.
 *
 * Element ORDER inside an array operand, by contrast, is significant: `[1, 2]` and `[2, 1]` are different
 * arrays.
 *
 * The gate admits a structural operand only where an array's own elements can be structural — `$all` and
 * a bare exact-array. `$eq`/`$ne`/`$in`/`$nin` take scalar operands only, pinned below so the boundary
 * cannot drift unnoticed. See DECISIONS.md, "the equality family's operand domain".
 */
export function registerStructuralOperands(ctx: SectionCtx): void {
    const { test, matchJavascriptObject, expectMalformedFilterRejected, expectOrAcknowledgeUnsupported } = ctx;

    const match = (row: StructuralArray, filter: unknown) => matchJavascriptObject(row, filter as WhereFilterDefinition<StructuralArray>, StructuralArraySchema);
    const numeric: StructuralArray = { id: 'x', matrix: [[1, 2]] };
    const objects: StructuralArray = { id: 'x', objMatrix: [[{ a: 1, b: 2 }]] };

    describe('27. Structural operands compare by structure', () => {

        describe('27.1 $all with array elements', () => {
            test('an array element equal to a stored element matches, whatever the rendering', async () => {
                expectOrAcknowledgeUnsupported(await match(numeric, { matrix: { $all: [[1, 2]] } }), true, 'structural array operand');
            });

            test('a reordered array element does not match (element order is significant)', async () => {
                expectOrAcknowledgeUnsupported(await match(numeric, { matrix: { $all: [[2, 1]] } }), false, 'structural array operand');
            });

            test('an array element absent from the stored array does not match', async () => {
                expectOrAcknowledgeUnsupported(await match(numeric, { matrix: { $all: [[3, 4]] } }), false, 'structural array operand');
            });
        });

        describe('27.2 $all with object elements', () => {
            test('an object element matches regardless of its key order', async () => {
                expectOrAcknowledgeUnsupported(await match(objects, { objMatrix: { $all: [[{ b: 2, a: 1 }]] } }), true, 'structural object operand');
            });

            test('an object element in the stored key order also matches', async () => {
                expectOrAcknowledgeUnsupported(await match(objects, { objMatrix: { $all: [[{ a: 1, b: 2 }]] } }), true, 'structural object operand');
            });

            test('an object element differing in a value does not match', async () => {
                expectOrAcknowledgeUnsupported(await match(objects, { objMatrix: { $all: [[{ a: 1, b: 3 }]] } }), false, 'structural object operand');
            });
        });

        describe('27.3 a bare exact-array operand', () => {
            test('a nested array matches its structural equal', async () => {
                expectOrAcknowledgeUnsupported(await match(numeric, { matrix: [[1, 2]] }), true, 'structural array operand');
            });

            test('a nested array does not match a reordered one', async () => {
                expectOrAcknowledgeUnsupported(await match(numeric, { matrix: [[2, 1]] }), false, 'structural array operand');
            });

            test('an exact-array of objects matches regardless of key order', async () => {
                expectOrAcknowledgeUnsupported(await match(objects, { objMatrix: [[{ b: 2, a: 1 }]] }), true, 'structural array operand');
            });
        });

        describe('27.4 the equality family takes scalar operands only', () => {
            // These pin the CURRENT operand domain, so a widening is a deliberate act with a decision
            // entry behind it rather than an accident. `$all` and the bare exact-array above are the only
            // positions admitting a structural operand.
            test('$eq rejects an array operand', async () => {
                await expectMalformedFilterRejected(() => match(numeric, { matrix: { $eq: [[1, 2]] } }));
            });

            test('$in rejects an array operand', async () => {
                await expectMalformedFilterRejected(() => match(numeric, { matrix: { $in: [[1, 2]] } }));
            });

            test('$nin rejects an array operand', async () => {
                await expectMalformedFilterRejected(() => match(numeric, { matrix: { $nin: [[1, 2]] } }));
            });
        });

    });
}
