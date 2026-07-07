import { ContactSchema, DottedKeySchema } from "./fixtures.ts";
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
    const { test, matchJavascriptObject, expectOrAcknowledgeUnsupported } = ctx;

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

    });
}
