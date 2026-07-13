import { NullishGridSchema, TagsSchema, RegexSchema, BooleanContactSchema, ArrayOperandSchema, MultiScalarSchema } from "./fixtures.ts";
import type { WhereFilterDefinition } from "../types.ts";
import type { SectionCtx } from "./harness.ts";

/**
 * §25. Operator-payload strictness, operand domains & multi-operator AND.
 *
 * Four contracts the earlier sections do not pin:
 *
 *  1. STRICTNESS — an operator payload admits ONLY known operators of ONE category. An unknown operator
 *     riding alongside a known one (`{age:{$eq:5,$mod:3}}`), a cross-category mix (`{tags:{$size:2,$gt:5}}`),
 *     a non-JSON carrier in an array operand (`{tags:[new Date()]}`, a bigint/Symbol/Map, `$all` of the
 *     same), or a present-but-`undefined` operator/logic value (`{age:{$lt:5,$gt:undefined}}`, `{$or:undefined}`)
 *     is MALFORMED — every engine must reject it, never silently drop the offending key.
 *
 *  2. OPERAND DOMAIN — `$all` (like an exact-array) accepts the full portable value subset: JSON values,
 *     plus non-finite numbers as the documented exception (`$all:[NaN]`), booleans (`$all:[true]`) and null
 *     (`$all:[null]`); the compile-time type always allowed these (the element type follows the array), but
 *     the gate historically rejected them. See MONGO-DIVERGENCES operand-domain entry.
 *
 *  3. MULTI-OPERATOR AND — a payload carrying several known operators means their conjunction, exactly as
 *     Mongo defines it: `match(row, {p:{opA,…,opN}}) === match(row, {$and:[{p:{opA}},…,{p:{opN}}]})`. Each
 *     operator keeps its single-op semantics (including per-op missing-value behaviour); `$regex`+`$options`
 *     is ONE predicate; `$not` negates only its own payload. The verdicts below are the AND of the two ops'
 *     existing single-op verdicts (`P` = field present, `M` = missing):
 *
 *       {$exists:true,$gt:5}       P/val 9 → T   | M → F
 *       {$ne:9,$gt:5}              P/val 7 → T   | M → F   (¬eq ∧ range: missing matches $ne, fails $gt)
 *       {$in:[10,20],$gte:20}      P/val 20 → T  | P/val 10 → F
 *       {$regex:'o',$gte:'m'}      P/'rome' → T  | P/'al' → F
 *       {$not:{$gt:5},$lt:10}      P/val 3 → T   | P/val 7 → F
 *       {$exists:true,$ne:'x'}     P/'y' → T | P/'x' → F | M → F      ← the D6 divergence pin
 *
 *     The last row is the whole point: TODAY the JS matcher dispatches `$exists` first (so present-'x'
 *     wrongly returns T) while the SQL emitters dispatch `$ne` first (so a missing field wrongly returns T).
 *     AND forces both engines onto the verdicts above. Combo rows use number/string operands only (boolean /
 *     null operands would register extra `$all` engine-limitation reds).
 *
 *  4. CONJUNCTION AT EVERY DEPTH — the AND law of (3) holds inside `$not` and inside a scalar `$elemMatch`
 *     too, not only at the top of a field condition. `$not` then negates the whole conjunction, and it does
 *     so on a missing field as well (`{$not:{$ne:5}}` does NOT match a missing field, because `$ne` does).
 */
export function registerOperatorStrictness(ctx: SectionCtx): void {
    const { test, matchJavascriptObject, expectOrAcknowledgeUnsupported, expectMalformedFilterRejected } = ctx;

    // These payloads are deliberately malformed: the compile-time type rejects each one (TS2353 for unknown /
    // cross-category operators; excess/absent for the carriers). The runtime gate must reject them too. Cast
    // through `unknown` per the established §16/§23 pattern so the spec can state the shape verbatim.
    const bad = (f: unknown): WhereFilterDefinition => f as WhereFilterDefinition;

    describe('25. Operator-payload strictness, operand domains & multi-operator AND', () => {

        // ── 25.1 Unknown-operator piggyback — rejected at every nesting depth ──────────────────────
        describe('25.1 unknown-operator piggyback is rejected', () => {
            test('25.1a alongside a known operator in a value payload', async () => {
                await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 'x', n: 5 }, bad({ n: { $eq: 5, $mod: 3 } }), NullishGridSchema));
            });
            test('25.1b inside a $not payload', async () => {
                await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 'x', n: 5 }, bad({ n: { $not: { $eq: 5, $mod: 3 } } }), NullishGridSchema));
            });
            test('25.1c inside an $elemMatch payload', async () => {
                await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 't', tags: ['a'], nums: [1] }, bad({ nums: { $elemMatch: { $eq: 1, $mod: 3 } } }), TagsSchema));
            });
            test('25.1d inside a $and logic arm', async () => {
                await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 'x', n: 1 }, bad({ $and: [{ n: { $eq: 1, $mod: 2 } }] }), NullishGridSchema));
            });
        });

        // ── 25.2 Cross-category operator mix (value op + array op) — rejected ──────────────────────
        describe('25.2 cross-category operator mix is rejected', () => {
            test('25.2a $size (array) alongside $gt (value)', async () => {
                await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 't', tags: ['a', 'b'], nums: [] }, bad({ tags: { $size: 2, $gt: 5 } }), TagsSchema));
            });
        });

        // ── 25.3 Non-JSON carriers in array operands — rejected (JSON.stringify corrupts/throws) ───
        describe('25.3 non-JSON carriers in array operands are rejected', () => {
            test('25.3a a Date in an exact-array operand', async () => {
                await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, bad({ tags: [new Date()] }), TagsSchema));
            });
            test('25.3b a bigint in an exact-array operand', async () => {
                await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, bad({ tags: [BigInt(1)] }), TagsSchema));
            });
            test('25.3c a Symbol in an exact-array operand', async () => {
                await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, bad({ tags: [Symbol('x')] }), TagsSchema));
            });
            test('25.3d a Map in an exact-array operand', async () => {
                await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, bad({ tags: [new Map()] }), TagsSchema));
            });
            test('25.3e an explicit undefined element in an exact-array operand', async () => {
                await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, bad({ tags: [undefined] }), TagsSchema));
            });
            test('25.3f a Date nested inside an $all element object', async () => {
                await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, bad({ tags: { $all: [{ x: new Date() }] } }), TagsSchema));
            });
        });

        // ── 25.4 Present-but-undefined operator / logic values — rejected ─────────────────────────
        describe('25.4 present-undefined operator or logic values are rejected', () => {
            test('25.4a a range operator explicitly set to undefined', async () => {
                await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 'x', n: 3 }, bad({ n: { $lt: 5, $gt: undefined } }), NullishGridSchema));
            });
            test('25.4b a lone range operator explicitly set to undefined', async () => {
                await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 'x', n: 3 }, bad({ n: { $gt: undefined } }), NullishGridSchema));
            });
            test('25.4c a logic operator explicitly set to undefined', async () => {
                await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 'x', n: 3 }, bad({ $or: undefined }), NullishGridSchema));
            });
            test('25.4d $options explicitly set to undefined', async () => {
                await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 'r', name: 'a' }, bad({ name: { $regex: 'a', $options: undefined } }), RegexSchema));
            });
        });

        // ── 25.5 Valid shapes are preserved (regression guards; all currently green) ───────────────
        describe('25.5 valid shapes are preserved', () => {
            test('25.5a a bare boolean scalar matches', async () => {
                const result = await matchJavascriptObject({ contact: { name: 'A', isVIP: true } }, { 'contact.isVIP': true }, BooleanContactSchema);
                expectOrAcknowledgeUnsupported(result, true);
            });
            test('25.5b a bare null scalar matches a null value', async () => {
                // Bare-null equality on a nullable field is an unmodelled TYPE gap (types.test.ts pins it), so
                // the literal needs the cast even though the runtime treats it as IS NULL and must keep doing so.
                const result = await matchJavascriptObject({ id: 'x', n: null }, bad({ n: null }), NullishGridSchema);
                expectOrAcknowledgeUnsupported(result, true);
            });
            test('25.5c an empty filter matches all', async () => {
                const result = await matchJavascriptObject({ id: 'x', n: 5 }, {}, NullishGridSchema);
                expectOrAcknowledgeUnsupported(result, true);
            });
            test('25.5d a field explicitly set to undefined never matches', async () => {
                const result = await matchJavascriptObject({ id: 'x', n: 5 }, bad({ n: undefined }), NullishGridSchema);
                expectOrAcknowledgeUnsupported(result, false);
            });
            test('25.5e a string range matches', async () => {
                const result = await matchJavascriptObject({ id: 'r', name: 'bob' }, { name: { $gte: 'a', $lte: 'z' } }, RegexSchema);
                expectOrAcknowledgeUnsupported(result, true);
            });
            test('25.5f $ne NaN (a non-finite direct operand) matches a finite value', async () => {
                const result = await matchJavascriptObject({ id: 'x', n: 5 }, { n: { $ne: NaN } }, NullishGridSchema);
                expectOrAcknowledgeUnsupported(result, true);
            });
            test('25.5g an empty $all matches (vacuous truth)', async () => {
                const result = await matchJavascriptObject({ id: 't', tags: [], nums: [] }, { tags: { $all: [] } }, TagsSchema);
                expectOrAcknowledgeUnsupported(result, true);
            });
            test('25.5h recursive $not is preserved', async () => {
                const result = await matchJavascriptObject({ id: 'x', n: 10 }, bad({ n: { $not: { $not: { $gt: 5 } } } }), NullishGridSchema);
                expectOrAcknowledgeUnsupported(result, true);
            });
            test('25.5i an $elemMatch scalar payload is preserved', async () => {
                const result = await matchJavascriptObject({ id: 't', tags: ['b'], nums: [] }, { tags: { $elemMatch: { $gt: 'a' } } }, TagsSchema);
                expectOrAcknowledgeUnsupported(result, true);
            });
        });

        // ── 25.6 $all operand domain widened to the JSON subset ───────────────────────────────────
        // 25.A/25.B (boolean $all) are SQLite-RED (better-sqlite3 rejects a raw boolean bind); 25.C (null $all)
        // is RED on BOTH engines (generatePlaceholder rejects a null placeholder). Both are tracked engine
        // limitations owned by the parent plan's boolean/null binding phases — not masked here.
        describe('25.6 $all operand domain (JSON subset)', () => {
            test('25.6-A $all:[true] matches a boolean array containing true', async () => {
                const result = await matchJavascriptObject({ id: 'x', flags: [true, false], maybe: [], scores: [] }, { flags: { $all: [true] } }, ArrayOperandSchema);
                expectOrAcknowledgeUnsupported(result, true);
            });
            test('25.6-B $all:[false] does not match a boolean array without false', async () => {
                const result = await matchJavascriptObject({ id: 'x', flags: [true], maybe: [], scores: [] }, { flags: { $all: [false] } }, ArrayOperandSchema);
                expectOrAcknowledgeUnsupported(result, false);
            });
            test('25.6-C $all:[null] matches a nullable array containing null', async () => {
                const result = await matchJavascriptObject({ id: 'x', flags: [], maybe: [null, 1], scores: [] }, { maybe: { $all: [null] } }, ArrayOperandSchema);
                expectOrAcknowledgeUnsupported(result, true);
            });
            test('25.6-C2 $all:[null] does not match a nullable array without null', async () => {
                const result = await matchJavascriptObject({ id: 'x', flags: [], maybe: [1, 2], scores: [] }, { maybe: { $all: [null] } }, ArrayOperandSchema);
                expectOrAcknowledgeUnsupported(result, false);
            });
            test('25.6-D $all:[NaN] (accepted operand) does not match a finite array', async () => {
                const result = await matchJavascriptObject({ id: 'x', flags: [], maybe: [], scores: [1, 2] }, { scores: { $all: [NaN] } }, ArrayOperandSchema);
                expectOrAcknowledgeUnsupported(result, false);
            });
            test('25.6-E $all:[Infinity] (accepted operand) does not match a finite array', async () => {
                const result = await matchJavascriptObject({ id: 'x', flags: [], maybe: [], scores: [1, 2] }, { scores: { $all: [Infinity] } }, ArrayOperandSchema);
                expectOrAcknowledgeUnsupported(result, false);
            });
        });

        // ── 25.6bis $in / $nin with a boolean operand (widened operand domain) ─────────────────────
        // A boolean is a first-class $in/$nin operand: over an array field, membership intersects the array,
        // comparing each element type-faithfully (JSON `true` ≠ `1` ≠ `"true"`), matching the JS matcher.
        describe('25.6bis $in / $nin over a boolean array', () => {
            test('25.6bis-A $in:[true] matches a boolean array containing true', async () => {
                const result = await matchJavascriptObject({ id: 'x', flags: [true, false], maybe: [], scores: [] }, { flags: { $in: [true] } }, ArrayOperandSchema);
                expectOrAcknowledgeUnsupported(result, true);
            });
            test('25.6bis-B $in:[true] does not match a boolean array without true', async () => {
                const result = await matchJavascriptObject({ id: 'x', flags: [false], maybe: [], scores: [] }, { flags: { $in: [true] } }, ArrayOperandSchema);
                expectOrAcknowledgeUnsupported(result, false);
            });
            test('25.6bis-C $nin:[true] matches a boolean array without true', async () => {
                const result = await matchJavascriptObject({ id: 'x', flags: [false], maybe: [], scores: [] }, { flags: { $nin: [true] } }, ArrayOperandSchema);
                expectOrAcknowledgeUnsupported(result, true);
            });
        });

        // ── 25.7 Multi-operator payloads evaluate as AND (the pair table above) ────────────────────
        describe('25.7 multi-operator payloads evaluate as AND', () => {
            test('25.7a {$exists:true,$gt:5} on a present value is true', async () => {
                const result = await matchJavascriptObject({ id: 'x', n: 9 }, bad({ n: { $exists: true, $gt: 5 } }), NullishGridSchema);
                expectOrAcknowledgeUnsupported(result, true);
            });
            test('25.7b {$exists:true,$gt:5} on a missing field is false', async () => {
                const result = await matchJavascriptObject({ id: 'x' }, bad({ n: { $exists: true, $gt: 5 } }), NullishGridSchema);
                expectOrAcknowledgeUnsupported(result, false);
            });
            test('25.7c {$ne:9,$gt:5} on a present value satisfying both is true', async () => {
                const result = await matchJavascriptObject({ id: 'x', n: 7 }, bad({ n: { $ne: 9, $gt: 5 } }), NullishGridSchema);
                expectOrAcknowledgeUnsupported(result, true);
            });
            test('25.7d {$ne:9,$gt:5} on a missing field is false (fails $gt)', async () => {
                const result = await matchJavascriptObject({ id: 'x' }, bad({ n: { $ne: 9, $gt: 5 } }), NullishGridSchema);
                expectOrAcknowledgeUnsupported(result, false);
            });
            test('25.7e {$in:[10,20],$gte:20} matches 20', async () => {
                const result = await matchJavascriptObject({ id: 'x', n: 20 }, bad({ n: { $in: [10, 20], $gte: 20 } }), NullishGridSchema);
                expectOrAcknowledgeUnsupported(result, true);
            });
            test('25.7f {$in:[10,20],$gte:20} does not match 10 (fails $gte)', async () => {
                const result = await matchJavascriptObject({ id: 'x', n: 10 }, bad({ n: { $in: [10, 20], $gte: 20 } }), NullishGridSchema);
                expectOrAcknowledgeUnsupported(result, false);
            });
            test('25.7g {$regex:"o",$gte:"m"} matches "rome"', async () => {
                const result = await matchJavascriptObject({ id: 'x', s: 'rome' }, bad({ s: { $regex: 'o', $gte: 'm' } }), NullishGridSchema);
                expectOrAcknowledgeUnsupported(result, true);
            });
            test('25.7h {$regex:"o",$gte:"m"} does not match "al" (fails $regex)', async () => {
                const result = await matchJavascriptObject({ id: 'x', s: 'al' }, bad({ s: { $regex: 'o', $gte: 'm' } }), NullishGridSchema);
                expectOrAcknowledgeUnsupported(result, false);
            });
            test('25.7i {$not:{$gt:5},$lt:10} matches 3', async () => {
                const result = await matchJavascriptObject({ id: 'x', n: 3 }, bad({ n: { $not: { $gt: 5 }, $lt: 10 } }), NullishGridSchema);
                expectOrAcknowledgeUnsupported(result, true);
            });
            test('25.7j {$not:{$gt:5},$lt:10} does not match 7 (fails $not)', async () => {
                const result = await matchJavascriptObject({ id: 'x', n: 7 }, bad({ n: { $not: { $gt: 5 }, $lt: 10 } }), NullishGridSchema);
                expectOrAcknowledgeUnsupported(result, false);
            });
            test('25.7k D6 pin: {$exists:true,$ne:"x"} on a present differing value is true', async () => {
                const result = await matchJavascriptObject({ id: 'x', s: 'y' }, bad({ s: { $exists: true, $ne: 'x' } }), NullishGridSchema);
                expectOrAcknowledgeUnsupported(result, true);
            });
            test('25.7l D6 pin: {$exists:true,$ne:"x"} on a present equal value is false (fails $ne)', async () => {
                const result = await matchJavascriptObject({ id: 'x', s: 'x' }, bad({ s: { $exists: true, $ne: 'x' } }), NullishGridSchema);
                expectOrAcknowledgeUnsupported(result, false);
            });
            test('25.7m D6 pin: {$exists:true,$ne:"x"} on a missing field is false (fails $exists)', async () => {
                const result = await matchJavascriptObject({ id: 'x' }, bad({ s: { $exists: true, $ne: 'x' } }), NullishGridSchema);
                expectOrAcknowledgeUnsupported(result, false);
            });
        });

        // ── 25.8 A multi-operator payload under $not is still a conjunction ────────────────────────
        //
        // `{$not:{$ne:9,$gt:5}}` negates the WHOLE conjunction: it matches exactly the values that fail
        // `$ne:9` OR fail `$gt:5`. A value of 3 satisfies `$ne:9` but not `$gt:5`, so the inner conjunction
        // is false and the negation is TRUE — the row every first-operator-wins implementation gets wrong.
        // An engine that CAN express this filter is held to the exact verdict; one that cannot acknowledges it
        // through the seam. The four in-repo engines all express it, and their capability manifests are frozen,
        // so none of them can quietly retreat to an acknowledgement here.
        describe('25.8 a multi-operator payload under $not is a conjunction', () => {
            const notNe9Gt5 = (n?: number) => matchJavascriptObject(n === undefined ? { id: 'x' } : { id: 'x', n }, bad({ n: { $not: { $ne: 9, $gt: 5 } } }), NullishGridSchema);

            test('25.8a a value failing only the inner $ne matches the negation', async () => {
                expectOrAcknowledgeUnsupported(await notNe9Gt5(9), true, '$not over a multi-operator conjunction');
            });
            test('25.8b a value failing only the inner $gt matches the negation', async () => {
                expectOrAcknowledgeUnsupported(await notNe9Gt5(3), true, '$not over a multi-operator conjunction');
            });
            test('25.8c a value satisfying both inner operators fails the negation', async () => {
                expectOrAcknowledgeUnsupported(await notNe9Gt5(7), false, '$not over a multi-operator conjunction');
            });
            test('25.8d a larger value satisfying both inner operators also fails the negation', async () => {
                expectOrAcknowledgeUnsupported(await notNe9Gt5(10), false, '$not over a multi-operator conjunction');
            });
            test('25.8e a missing field matches the negation (it fails the inner $gt)', async () => {
                expectOrAcknowledgeUnsupported(await notNe9Gt5(undefined), true, '$not over a multi-operator conjunction');
            });
            test('25.8f a doubly-negated multi-operator payload is the payload itself', async () => {
                expectOrAcknowledgeUnsupported(await matchJavascriptObject({ id: 'x', n: 7 }, bad({ n: { $not: { $not: { $gt: 5, $lt: 10 } } } }), NullishGridSchema), true, '$not over a multi-operator conjunction');
                expectOrAcknowledgeUnsupported(await matchJavascriptObject({ id: 'x', n: 12 }, bad({ n: { $not: { $not: { $gt: 5, $lt: 10 } } } }), NullishGridSchema), false, '$not over a multi-operator conjunction');
            });
        });

        // ── 25.9 A multi-operator payload inside a scalar $elemMatch is still a conjunction ────────
        //
        // ONE element must satisfy EVERY operator. `[3]` is the discriminating row: 3 satisfies `$ne:9`
        // but not `$gt:5`, so no element satisfies both. A first-operator-wins implementation stops at
        // `$ne` and wrongly matches. `[9,3]` is the same trap spread across two elements — neither element
        // satisfies both, and a conjunction may not be split across elements.
        describe('25.9 a multi-operator payload inside a scalar $elemMatch is a conjunction', () => {
            const elemNe9Gt5 = (nums: number[]) => matchJavascriptObject({ id: 'x', tags: [], nums }, bad({ nums: { $elemMatch: { $ne: 9, $gt: 5 } } }), TagsSchema);

            test('25.9a an element satisfying only the $ne does not match', async () => {
                expectOrAcknowledgeUnsupported(await elemNe9Gt5([3]), false, '$elemMatch multi-operator conjunction');
            });
            test('25.9b a conjunction cannot be satisfied by two different elements', async () => {
                expectOrAcknowledgeUnsupported(await elemNe9Gt5([9, 3]), false, '$elemMatch multi-operator conjunction');
            });
            test('25.9c an element satisfying both operators matches', async () => {
                expectOrAcknowledgeUnsupported(await elemNe9Gt5([7]), true, '$elemMatch multi-operator conjunction');
            });
            test('25.9d an element satisfying only the $gt does not match', async () => {
                expectOrAcknowledgeUnsupported(await elemNe9Gt5([9]), false, '$elemMatch multi-operator conjunction');
            });
            test('25.9e one satisfying element among failing ones matches', async () => {
                expectOrAcknowledgeUnsupported(await elemNe9Gt5([9, 7]), true, '$elemMatch multi-operator conjunction');
            });
            test('25.9f an empty array never matches', async () => {
                expectOrAcknowledgeUnsupported(await elemNe9Gt5([]), false, '$elemMatch multi-operator conjunction');
            });
            test('25.9g a two-bound range inside $elemMatch binds to one element', async () => {
                const gt5lt8 = (nums: number[]) => matchJavascriptObject({ id: 'x', tags: [], nums }, bad({ nums: { $elemMatch: { $gt: 5, $lt: 8 } } }), TagsSchema);
                expectOrAcknowledgeUnsupported(await gt5lt8([7]), true, '$elemMatch multi-operator conjunction');
                expectOrAcknowledgeUnsupported(await gt5lt8([9]), false, '$elemMatch multi-operator conjunction');
                expectOrAcknowledgeUnsupported(await gt5lt8([7, 9]), true, '$elemMatch multi-operator conjunction');
            });
        });

        // ── 25.10 $not negates its operand on a missing field ─────────────────────────────────────
        //
        // `$not` is negation, not a short-circuit. On a missing field it returns the complement of what
        // its inner payload returns there: `$ne` matches a missing field, so `{$not:{$ne:5}}` does NOT.
        // See DECISIONS.md — "$not negates its operand, including on a missing field".
        describe('25.10 $not negates its operand on a missing field', () => {
            const onMissing = (payload: unknown) => matchJavascriptObject({ id: 'x' }, bad({ n: payload }), NullishGridSchema);

            test('25.10a the inner $ne matches a missing field, so its negation does not', async () => {
                expectOrAcknowledgeUnsupported(await onMissing({ $not: { $ne: 5 } }), false, '$not on a missing field');
            });
            test('25.10b the inner $exists:false matches a missing field, so its negation does not', async () => {
                expectOrAcknowledgeUnsupported(await onMissing({ $not: { $exists: false } }), false, '$not on a missing field');
            });
            test('25.10c the inner $exists:true fails a missing field, so its negation matches', async () => {
                expectOrAcknowledgeUnsupported(await onMissing({ $not: { $exists: true } }), true, '$not on a missing field');
            });
            test('25.10d the inner range fails a missing field, so its negation matches', async () => {
                expectOrAcknowledgeUnsupported(await onMissing({ $not: { $gt: 5 } }), true, '$not on a missing field');
            });
            test('25.10e on a present field $not is the plain complement', async () => {
                expectOrAcknowledgeUnsupported(await matchJavascriptObject({ id: 'x', n: 5 }, bad({ n: { $not: { $ne: 5 } } }), NullishGridSchema), true, '$not on a missing field');
                expectOrAcknowledgeUnsupported(await matchJavascriptObject({ id: 'x', n: 6 }, bad({ n: { $not: { $ne: 5 } } }), NullishGridSchema), false, '$not on a missing field');
            });
        });

        // ── 25.11 $not distinguishes a stored JSON null from an absent field ──────────────────────
        //
        // A stored null is a PRESENT value, not a missing field, so `$not` negates its operand's verdict on
        // that null. An engine that decides "missing" by whether the extracted value is null — rather than
        // whether the path is there — inverts every row here; SQL uses a presence probe to separate the two.
        // All four in-repo engines express this and are pinned to the exact verdicts by their frozen manifests.
        describe('25.11 $not distinguishes a stored JSON null from an absent field', () => {
            const onStoredNull = (payload: unknown) => matchJavascriptObject({ id: 'x', n: null }, bad({ n: payload }), NullishGridSchema);

            test('25.11a a stored null exists, so negating $exists:true excludes the row', async () => {
                expectOrAcknowledgeUnsupported(await onStoredNull({ $not: { $exists: true } }), false, '$not on a stored-null field');
            });
            test('25.11b a stored null exists, so negating $exists:false matches the row', async () => {
                expectOrAcknowledgeUnsupported(await onStoredNull({ $not: { $exists: false } }), true, '$not on a stored-null field');
            });
            test('25.11c a stored null differs from 5, so negating that difference excludes the row', async () => {
                expectOrAcknowledgeUnsupported(await onStoredNull({ $not: { $ne: 5 } }), false, '$not on a stored-null field');
            });
            test('25.11d a stored null equals a null operand, so negating that equality excludes the row', async () => {
                expectOrAcknowledgeUnsupported(await onStoredNull({ $not: { $eq: null } }), false, '$not on a stored-null field');
            });
        });

        // ── 25.12 $not over a multi-scalar field does not conflate scalar kinds ───────────────────
        //
        // `{$not:{$eq:true}}` excludes only the row equal to `true`; a string or number row is a genuine
        // non-match of `$eq:true`, so its negation matches. An engine that coerced the stored value to the
        // operand's type before comparing would wrongly exclude them. All four in-repo engines express this
        // and are pinned to the exact verdicts by their frozen manifests.
        describe('25.12 $not over a multi-scalar field does not conflate scalar kinds', () => {
            const notEqTrue = (secret: unknown) => matchJavascriptObject({ id: '1', secret }, bad({ secret: { $not: { $eq: true } } }), MultiScalarSchema);

            test('25.12a a string row is not equal to true, so its negation matches', async () => {
                expectOrAcknowledgeUnsupported(await notEqTrue('hush'), true, '$not over a multi-scalar field');
            });
            test('25.12b a numeric row is not equal to true, so its negation matches', async () => {
                expectOrAcknowledgeUnsupported(await notEqTrue(7), true, '$not over a multi-scalar field');
            });
            test('25.12c the true row is equal to true, so its negation excludes it', async () => {
                expectOrAcknowledgeUnsupported(await notEqTrue(true), false, '$not over a multi-scalar field');
            });
        });

    });
}
