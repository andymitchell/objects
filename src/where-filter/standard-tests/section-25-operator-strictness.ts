import { NullishGridSchema, TagsSchema, RegexSchema, BooleanContactSchema, ArrayOperandSchema } from "./fixtures.ts";
import type { WhereFilterDefinition } from "../types.ts";
import type { SectionCtx } from "./harness.ts";

/**
 * §25. Operator-payload strictness, operand domains & multi-operator AND.
 *
 * Three contracts the earlier sections do not pin:
 *
 *  1. STRICTNESS — an operator payload admits ONLY known operators of ONE category. An unknown operator
 *     riding alongside a known one (`{age:{$eq:5,$mod:3}}`), a cross-category mix (`{tags:{$size:2,$gt:5}}`),
 *     a non-JSON carrier in an array operand (`{tags:[new Date()]}`, a bigint/Symbol/Map, `$all` of the
 *     same), or a present-but-`undefined` operator/logic value (`{age:{$lt:5,$gt:undefined}}`, `{$or:undefined}`)
 *     is MALFORMED — every engine must reject it, never silently drop the offending key.
 *
 *  2. OPERAND DOMAIN — `$all` (like an exact-array) accepts the full JSON-serialisable value subset,
 *     including non-finite numbers (`$all:[NaN]`), booleans (`$all:[true]`) and null (`$all:[null]`); the
 *     compile-time type always allowed these (the element type follows the array), but the gate historically
 *     rejected them. See MONGO-DIVERGENCES operand-domain entry.
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

    });
}
