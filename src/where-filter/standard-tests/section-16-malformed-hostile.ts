import { ContactSchema, BooleanContactSchema, DollarKeySchema, NullishGridSchema } from "./fixtures.ts";
import type { WhereFilterDefinition } from "../types.ts";
import type { SectionCtx } from "./harness.ts";

/**
 * §16. Malformed & hostile filters (spec: strict rejection).
 *
 * Unknown operators, invalid operand types, non-array logic values, and non-JSON operands are all
 * malformed — the spec is to REJECT them (throw, or resolve `undefined` under errors-as-values), never
 * silently return a boolean. The permissive Zod gate currently accepts most and returns a boolean —
 * sometimes a silent TRUE (`$or:'x'`, `$not:{}`, `$nin:[{}]`, `$exists:'yes'`, `$ne:true`) — so these
 * SPEC-INTENT rows are expected RED until the gate is tightened. Genuine-throw controls stay green.
 */
export function registerMalformedHostile(ctx: SectionCtx): void {
    const { describe, test, matchJavascriptObject, expectOrAcknowledgeUnsupported, expectMalformedFilterRejected } = ctx;

    describe('16. Malformed & hostile filters (spec: strict rejection)', () => {

        test('16.1 unknown operator $mod is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns false — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ contact: { age: 4 } }, { 'contact.age': { $mod: [2, 0] } } as unknown as WhereFilterDefinition, ContactSchema));
        });

        test('16.2 a logic operator with a string value is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns TRUE (treats '$or' as a data path — worst-case silent match) — expected RED.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 'x', $or: 'x' }, { $or: 'x' } as unknown as WhereFilterDefinition, DollarKeySchema));
        });

        test('16.3 $and with an object (not array) value is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns false — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ contact: { name: 'A' } }, { $and: { a: 1 } } as unknown as WhereFilterDefinition, ContactSchema));
        });

        test('16.4 $or with a number value is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns false — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ contact: { name: 'A' } }, { $or: 42 } as unknown as WhereFilterDefinition, ContactSchema));
        });

        test('16.5 an empty $not is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns TRUE — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.name': { $not: {} } } as unknown as WhereFilterDefinition, ContactSchema));
        });

        test('16.6 a null filter is rejected', async () => {
            await expectMalformedFilterRejected(() => matchJavascriptObject({ contact: { name: 'A' } }, null as unknown as WhereFilterDefinition, ContactSchema));
        });

        test('16.7 an array filter is rejected', async () => {
            await expectMalformedFilterRejected(() => matchJavascriptObject({ contact: { name: 'A' } }, [] as unknown as WhereFilterDefinition, ContactSchema));
        });

        test('16.8 a number filter is rejected', async () => {
            await expectMalformedFilterRejected(() => matchJavascriptObject({ contact: { name: 'A' } }, 42 as unknown as WhereFilterDefinition, ContactSchema));
        });

        test('16.9 $and with primitive members is rejected', async () => {
            await expectMalformedFilterRejected(() => matchJavascriptObject({ contact: { name: 'A' } }, { $and: [5, 'x'] } as unknown as WhereFilterDefinition, ContactSchema));
        });

        test('16.10 nested $not double-negation is supported (not a rejection)', async () => {
            const result = await matchJavascriptObject({ contact: { age: 30 } }, { 'contact.age': { $not: { $not: { $gt: 5 } } } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('16.11 $in with a non-array operand is rejected', async () => {
            // MEASURED: JS throws TypeError (.includes is not a function). SQL likely resolves undefined → RED there.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.name': { $in: 5 } } as unknown as WhereFilterDefinition, ContactSchema));
        });

        test('16.12 $in with a boolean member over a string field is a type-bracketed non-match', async () => {
            // A boolean operand can never `===` a string value, so `$in` membership is a definite non-match, never
            // a rejection — the same type-bracketing a cross-type `$eq`/range operand gets. `$in` is a valid
            // filter whose boolean member simply cannot match the string field.
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.name': { $in: [true] } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('16.13 $in with a null member is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns false — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.name': { $in: [null] } } as unknown as WhereFilterDefinition, ContactSchema));
        });

        test('16.14 $nin with an object member is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns TRUE (silent match) — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.name': { $nin: [{}] } } as unknown as WhereFilterDefinition, ContactSchema));
        });

        test('16.15 $exists with a string value is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns TRUE (truthy coercion) — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.name': { $exists: 'yes' } } as unknown as WhereFilterDefinition, ContactSchema));
        });

        test('16.16 $type with an unknown type name is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns false — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.name': { $type: 'function' } } as unknown as WhereFilterDefinition, ContactSchema));
        });

        test('16.17 $regex with a number pattern is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns false — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.name': { $regex: 5 } } as unknown as WhereFilterDefinition, ContactSchema));
        });

        test('16.18 $ne with a boolean on a string field is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns TRUE — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.name': { $ne: true } } as unknown as WhereFilterDefinition, ContactSchema));
        });

        test('16.19 $eq true on a boolean field is accepted (positive contrast)', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A', isVIP: true } }, { 'contact.isVIP': { $eq: true } }, BooleanContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('16.20 a string filter is rejected', async () => {
            await expectMalformedFilterRejected(() => matchJavascriptObject({ contact: { name: 'A' } }, 'x' as unknown as WhereFilterDefinition, ContactSchema));
        });

        test('16.21 $nor with an object (not array) value is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns false — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ contact: { name: 'A' } }, { $nor: { a: 1 } } as unknown as WhereFilterDefinition, ContactSchema));
        });

        test('16.22 an unsatisfiable $and is false, not an error', async () => {
            const result = await matchJavascriptObject({ id: 'x', n: 3 }, { $and: [{ n: { $gt: 5 } }, { n: { $lt: 1 } }] } as unknown as WhereFilterDefinition, NullishGridSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('16.23 a Date operand is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns false — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.name': new Date() } as unknown as WhereFilterDefinition, ContactSchema));
        });

        test('16.24 a bigint operand is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns false — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.name': BigInt(1) } as unknown as WhereFilterDefinition, ContactSchema));
        });

        test('16.25 a Symbol operand is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns false — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.name': Symbol('x') } as unknown as WhereFilterDefinition, ContactSchema));
        });

        test('16.26 an empty filter matches all (reject-net control)', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, {}, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('16.27 implicit-$and over multiple keys still works (control)', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A', age: 1 } }, { 'contact.name': 'A', 'contact.age': 1 }, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

    });
}
