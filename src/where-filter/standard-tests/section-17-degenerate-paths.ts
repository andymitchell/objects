import { ContactSchema, DottedKeyInArraySchema, DottedKeySchema } from "./fixtures.ts";
import type { WhereFilterDefinition } from "../types.ts";
import type { SectionCtx } from "./harness.ts";

/**
 * §17. Degenerate & hostile paths.
 *
 * The prototype-pollution / disallowed path set (`''`, `.`, `__proto__`, `constructor`, …) is already
 * looped across all three harnesses in §7 — not duplicated here. This pins the remaining degenerate keys:
 * an empty / lone-dot filter key resolves to nothing (`false`), and a literal-dot data key is reachable
 * only via the dot-prop escape (`a\.b`), never the raw `a.b` (which resolves as nested `a`→`b`).
 */
export function registerDegeneratePaths(ctx: SectionCtx): void {
    const { test, expect, matchJavascriptObject, expectOrAcknowledgeUnsupported } = ctx;

    describe('17. Degenerate & hostile paths', () => {

        test('17.9 an empty filter key resolves to nothing (false)', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'Andy' } }, { '': 'x' } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('17.10 a lone-dot filter key resolves to nothing (false)', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'Andy' } }, { '.': 'x' } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('17.11 a literal-dot data key is reached via the dot-prop escape', async () => {
            const result = await matchJavascriptObject({ id: 'x', 'a.b': 'v' }, { 'a\\.b': 'v' } as unknown as WhereFilterDefinition, DottedKeySchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('17.12 the raw dotted key resolves as nested a→b, not the literal key (false)', async () => {
            const result = await matchJavascriptObject({ id: 'x', 'a.b': 'v' }, { 'a.b': 'v' } as unknown as WhereFilterDefinition, DottedKeySchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        // ── 17.13 The dot-prop escape survives every operator, not just bare equality ──────────────
        //
        // Operators that build their own accessor (rather than going through the shared path converter)
        // must honour the escape too, or `a\.b` silently becomes the nested path `a`→`b`.
        describe('17.13 the dot-prop escape holds for every operator', () => {
            const row = { id: 'x', 'a.b': 'v', 'x.y': ['t'] };
            const dotted = (filter: unknown) => matchJavascriptObject(row, filter as WhereFilterDefinition, DottedKeySchema);

            test('$exists reaches a literal-dot key', async () => {
                expect(await dotted({ 'a\\.b': { $exists: true } })).toBe(true);
            });
            test('$type reaches a literal-dot key', async () => {
                expect(await dotted({ 'a\\.b': { $type: 'string' } })).toBe(true);
            });
            test('$size reaches a literal-dot array key', async () => {
                expect(await dotted({ 'x\\.y': { $size: 1 } })).toBe(true);
                expect(await dotted({ 'x\\.y': { $size: 2 } })).toBe(false);
            });
            test('$ne reaches a literal-dot key', async () => {
                expect(await dotted({ 'a\\.b': { $ne: 'v' } })).toBe(false);
            });
        });

        test('17.14 the dot-prop escape survives array spreading', async () => {
            // A literal-dot key beneath a spreading array: the path is `rows` (array) → `a.b` (one key).
            // Splitting the path on raw dots turns the leaf into a nested `a`→`b` that does not exist.
            const result = await matchJavascriptObject(
                { id: 'x', rows: [{ 'a.b': 'v' }] },
                { 'rows.a\\.b': 'v' } as unknown as WhereFilterDefinition,
                DottedKeyInArraySchema
            );
            expect(result).toBe(true);
        });

        // ── 17.15 A raw dotted path never reaches a literal-dot ARRAY key ──────────────────────────
        //
        // `x.y` is a literal-dot array key on DottedKeySchema. The raw path `x.y` reads as nested `x`→`y`
        // (missing), so every array operator sees a missing field; only the escape `x\.y` reaches the array.
        // Pre-fix the raw path borrowed the array's node and answered from a field the row does not hold.
        describe('17.15 a raw dotted path does not reach a literal-dot array key', () => {
            const row = { id: 'x', 'a.b': 'v', 'x.y': ['t'] };
            const dotted = (filter: unknown) => matchJavascriptObject(row, filter as WhereFilterDefinition, DottedKeySchema);

            test('$size on the raw path is false (missing field)', async () => {
                expect(await dotted({ 'x.y': { $size: 1 } })).toBe(false);
            });
            test('$all on the raw path is false (missing field)', async () => {
                expect(await dotted({ 'x.y': { $all: ['t'] } })).toBe(false);
            });
            test('$elemMatch on the raw path is false (missing field)', async () => {
                expect(await dotted({ 'x.y': { $elemMatch: { $eq: 't' } } })).toBe(false);
            });
            test('a bare-scalar contains on the raw path is false (missing field)', async () => {
                expect(await dotted({ 'x.y': 't' })).toBe(false);
            });
            test('the escape still reaches the literal-dot array (control)', async () => {
                expect(await dotted({ 'x\\.y': { $all: ['t'] } })).toBe(true);
            });
        });

        // ── 17.16 A raw dotted path never reaches a literal-dot key inside a spread array ───────────
        //
        // Raw twin of 17.14. `rows.a.b` reads as `rows`(array) → `a` → `b`; each element holds the literal
        // key `a.b`, not a nested `a`→`b`, so the raw path is a missing field. Only `rows.a\.b` reaches it.
        describe('17.16 a raw dotted path does not reach a literal-dot key inside a spread array', () => {
            const row = { id: 'x', rows: [{ 'a.b': 'v' }] };
            const dotted = (filter: unknown) => matchJavascriptObject(row, filter as WhereFilterDefinition, DottedKeyInArraySchema);

            test('a bare-scalar match on the raw path is false (missing field)', async () => {
                expect(await dotted({ 'rows.a.b': 'v' })).toBe(false);
            });
            test('$exists:true on the raw path is false (missing field)', async () => {
                expect(await dotted({ 'rows.a.b': { $exists: true } })).toBe(false);
            });
            test('$exists:false on the raw path is true (missing field)', async () => {
                expect(await dotted({ 'rows.a.b': { $exists: false } })).toBe(true);
            });
        });

    });
}
