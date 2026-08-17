import type { z } from "zod";
import { expect } from "vitest";
import { writeToItemsArray } from "./writeToItemsArray/writeToItemsArray.ts";
import { getWriteErrors } from "./helpers.ts";
import type {
    WriteAction,
    WriteErrorContext,
    WritePayloadAddToSet,
    WritePayloadCreate,
    WritePayloadPush,
    WritePayloadUpdate,
} from "./types.ts";
import type { DDL } from "../ddl/types.ts";

/**
 * The two authorities a write-action suite puts a payload to — the parse gate and the write engine — and the
 * readers that turn each one's answer into something a case can assert on.
 *
 * A gate verdict arrives as a Zod parse result whose faults are nested inside union arms, and an engine verdict
 * arrives as a batch outcome. Both are unwrapped here, failing the test at the point of the wrong verdict, so a
 * case reads as the question it asks rather than as the shape of the answer.
 */

// ─── The parse gate's verdict, unwrapped ───

/**
 * Wrap a payload in the write-action envelope. The payload is `unknown` because a gate case typically submits data
 * the declared `WriteAction<T>` type forbids — which is exactly the input a runtime gate exists to judge.
 */
export const action = (payload: unknown) => ({ type: "write", ts: 1, uuid: "u1", payload });

/** The one issue a rejected parse produced, failing the test if the parse succeeded or raised more than one. */
export function onlyIssue(result: z.ZodSafeParseResult<unknown>): z.core.$ZodIssue {
    if (result.success) throw new Error("expected the parse to be rejected");
    expect(result.error.issues).toHaveLength(1);
    return result.error.issues[0]!;
}

/** The per-arm issue lists a union rejection carries, failing the test if the rejection was not a union one. */
export function unionArmIssues(issue: z.core.$ZodIssue): z.core.$ZodIssue[][] {
    if (issue.code !== "invalid_union") throw new Error(`expected an invalid_union issue, got '${issue.code}'`);
    return issue.errors;
}

/** Every issue any union arm raised, flattened — the arms are alternatives, so a fault surfaces in several. */
export function allArmIssues(issue: z.core.$ZodIssue): z.core.$ZodIssue[] {
    return unionArmIssues(issue).flat();
}

/**
 * The accepted action a parse produced, failing the test with the rejection's reason if there was one.
 *
 * Generic over the row type, because which verbs a payload union even offers depends on the row: a row with no
 * array of objects has no `array_scope` variant to narrow to. A case that reads a verb's own fields names its row
 * type; the rest are content with the loosest one.
 */
export function accepted<T extends Record<string, any>>(result: z.ZodSafeParseResult<WriteAction<T>>): WriteAction<T> {
    if (!result.success) throw new Error(`expected the parse to be accepted, but it raised: ${result.error.issues[0]?.message}`);
    return result.data;
}

/** The `data` an accepted create or update carries, failing the test if the verb writes no data. */
export function carriedData(result: z.ZodSafeParseResult<WriteAction<Record<string, unknown>>>): Record<string, unknown> {
    const payload = accepted(result).payload;
    if (payload.type !== "create" && payload.type !== "update") throw new Error(`the '${payload.type}' verb carries no data`);
    return payload.data;
}

// ─── The write engine, the oracle a gate verdict is measured against ───
// Whether the gate should admit a write is not a question the gate can answer for itself: the engine goes on to
// store the values, so the engine's verdict is the one the gate has to match. A case that asks "may this be
// written?" states both, and the helpers below are how it asks the engine. The fixtures are deliberately one row
// type and one DDL, so a case can be read without first learning a shape.

/** Every field the engine-backed cases write, so one item type serves them all. */
export type EngineRow = { id: string; tag?: string; n?: unknown; s?: string; meta?: Record<string, unknown>; when?: unknown; tags?: string[]; bag?: unknown[]; rows?: { rid: string }[]; "when.at"?: unknown };

/** The two verbs that carry written data. */
export type DataPayload = WritePayloadCreate<EngineRow> | WritePayloadUpdate<EngineRow>;

/** Every verb that carries written values: an item's own fields, or the elements of one of its lists. */
export type WritingPayload = DataPayload | WritePayloadPush<EngineRow> | WritePayloadAddToSet<EngineRow>;

/** The root list keyed by `id`, and its one nested list keyed by `rid` — every list these cases write to. */
export const idKeyedDdl: DDL<EngineRow> = {
    version: 1,
    lists: {
        ".": { primary_key: "id", default_ordering_key: { key: "id", direction: 1 } },
        rows: { primary_key: "rid" },
    },
};

/** Apply one action to `items` with the real engine. */
function engineWrite(rowSchema: z.ZodObject, payload: WritingPayload, items: EngineRow[] = []) {
    return writeToItemsArray<EngineRow>([{ type: "write", ts: 1, uuid: "u1", payload }], items, rowSchema, idKeyedDdl);
}

/** The items the engine commits, failing the test if it refused the write. */
export function storedBy(rowSchema: z.ZodObject, payload: WritingPayload, items: EngineRow[] = []): EngineRow[] {
    const result = engineWrite(rowSchema, payload, items);
    if (!result.ok) throw new Error(`the engine refused the write: ${JSON.stringify(getWriteErrors(result))}`);
    return result.changes.final_items;
}

/** Every error the engine raised for one action — empty when it accepted the write. */
export function engineErrors(rowSchema: z.ZodObject, payload: WritingPayload, items: EngineRow[] = []): WriteErrorContext[] {
    return getWriteErrors(engineWrite(rowSchema, payload, items));
}
