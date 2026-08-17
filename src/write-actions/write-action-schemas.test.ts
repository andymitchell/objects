import { z } from "zod";
import { describe, it, expect } from "vitest";
import { makeWriteActionSchema } from "./write-action-schemas.ts";
import { writeToItemsArray } from "./writeToItemsArray/writeToItemsArray.ts";
import { getWriteErrors } from "./helpers.ts";
import type { WriteAction, WriteErrorContext, WritePayloadCreate, WritePayloadUpdate } from "./types.ts";
import type { DDL } from "../ddl/types.ts";

/**
 * A row whose schema does not merely accept data — it re-renders it. `tag` supplies a value the caller never
 * wrote, and every field is declared, so `.strict()` has something to refuse. Enough surface for both questions
 * this suite asks: which actions the gate admits, and what the caller gets back when it does.
 */
const RowSchema = z.object({
    id: z.string(),
    tag: z.string().default("x"),
    n: z.number().optional(),
    profile: z.object({ note: z.string().optional() }).optional(),
});
const rowAction = makeWriteActionSchema(RowSchema);

/**
 * Wrap a payload in the write-action envelope. The payload is `unknown` because most cases here submit data the
 * declared `WriteAction<T>` type forbids — which is exactly the input a runtime gate exists to judge.
 */
const action = (payload: unknown) => ({ type: "write", ts: 1, uuid: "u1", payload });

/** The one issue a rejected parse produced, failing the test if the parse succeeded or raised more than one. */
function onlyIssue(result: z.ZodSafeParseResult<unknown>): z.core.$ZodIssue {
    if (result.success) throw new Error("expected the parse to be rejected");
    expect(result.error.issues).toHaveLength(1);
    return result.error.issues[0]!;
}

/** The per-arm issue lists a union rejection carries, failing the test if the rejection was not a union one. */
function unionArmIssues(issue: z.core.$ZodIssue): z.core.$ZodIssue[][] {
    if (issue.code !== "invalid_union") throw new Error(`expected an invalid_union issue, got '${issue.code}'`);
    return issue.errors;
}

/** Every issue any union arm raised, flattened — the arms are alternatives, so a fault surfaces in several. */
function allArmIssues(issue: z.core.$ZodIssue): z.core.$ZodIssue[] {
    return unionArmIssues(issue).flat();
}

/** The accepted action a parse produced, failing the test with the rejection's reason if there was one. */
function accepted(result: z.ZodSafeParseResult<WriteAction<Record<string, unknown>>>): WriteAction<Record<string, unknown>> {
    if (!result.success) throw new Error(`expected the parse to be accepted, but it raised: ${result.error.issues[0]?.message}`);
    return result.data;
}

/** The `data` an accepted create or update carries, failing the test if the verb writes no data. */
function carriedData(result: z.ZodSafeParseResult<WriteAction<Record<string, unknown>>>): Record<string, unknown> {
    const payload = accepted(result).payload;
    if (payload.type !== "create" && payload.type !== "update") throw new Error(`the '${payload.type}' verb carries no data`);
    return payload.data;
}

// ─── The write engine, this suite's oracle ───
// Whether the gate should admit a write is not a question the gate can answer for itself: the engine goes on to
// store the values, so the engine's verdict is the one the gate has to match. Every case that asks "may this be
// written?" states both.

/** Every field the engine-backed cases below write, so one item type serves them all. */
type EngineRow = { id: string; tag?: string; n?: unknown; s?: string; meta?: Record<string, unknown>; when?: unknown; tags?: string[] };

/** The two verbs that carry written data. */
type DataPayload = WritePayloadCreate<EngineRow> | WritePayloadUpdate<EngineRow>;

/** A single root list keyed by `id` — the whole DDL a one-collection case needs. */
const idKeyedDdl: DDL<EngineRow> = { version: 1, lists: { ".": { primary_key: "id", default_ordering_key: { key: "id", direction: 1 } } } };

/** Apply one action to `items` with the real engine. */
function engineWrite(rowSchema: z.ZodObject, payload: DataPayload, items: EngineRow[] = []) {
    return writeToItemsArray<EngineRow>([{ type: "write", ts: 1, uuid: "u1", payload }], items, rowSchema, idKeyedDdl);
}

/** The items the engine commits, failing the test if it refused the write. */
function storedBy(rowSchema: z.ZodObject, payload: DataPayload, items: EngineRow[] = []): EngineRow[] {
    const result = engineWrite(rowSchema, payload, items);
    if (!result.ok) throw new Error(`the engine refused the write: ${JSON.stringify(getWriteErrors(result))}`);
    return result.changes.final_items;
}

/** Every error the engine raised for one action — empty when it accepted the write. */
function engineErrors(rowSchema: z.ZodObject, payload: DataPayload, items: EngineRow[] = []): WriteErrorContext[] {
    return getWriteErrors(engineWrite(rowSchema, payload, items));
}

const UPDATE_UNDEFINED_MESSAGE =
    "Clearing or removing a property is 'set_property_undefined' / 'delete_property'; an update cannot carry the value undefined";
const CREATE_UNDEFINED_MESSAGE =
    "A create defines the whole item, so omit the key rather than giving it the value undefined";

describe("which write actions the parse gate admits", () => {

    describe("data the write language cannot express is refused", () => {
        it("refuses an explicit undefined in an update, at the top level", () => {
            expect(rowAction.safeParse(action({ type: "update", data: { n: undefined }, where: { id: "1" } })).success).toBe(false);
        });

        it("refuses an explicit undefined nested inside an update's data", () => {
            expect(rowAction.safeParse(action({ type: "update", data: { profile: { note: undefined } }, where: { id: "1" } })).success).toBe(false);
        });

        it("refuses an explicit undefined in a create", () => {
            expect(rowAction.safeParse(action({ type: "create", data: { id: "1", n: undefined } })).success).toBe(false);
        });

        it("refuses a payload with no data at all, which means the same thing as an undefined one", () => {
            expect(rowAction.safeParse(action({ type: "update", where: { id: "1" } })).success).toBe(false);
        });

        it("refuses data that is not an object", () => {
            expect(rowAction.safeParse(action({ type: "update", data: null, where: { id: "1" } })).success).toBe(false);
        });
    });

    describe("the row's own shape is still enforced", () => {
        it("refuses a field the row does not declare", () => {
            expect(rowAction.safeParse(action({ type: "update", data: { unknown_field: "k" }, where: { id: "1" } })).success).toBe(false);
        });

        it("refuses a declared field holding the wrong type", () => {
            expect(rowAction.safeParse(action({ type: "update", data: { tag: 5 }, where: { id: "1" } })).success).toBe(false);
        });

        it("refuses a create missing a required field", () => {
            expect(rowAction.safeParse(action({ type: "create", data: { tag: "a" } })).success).toBe(false);
        });
    });

    describe("data a caller can legitimately write is admitted", () => {
        it("admits a create naming every required field", () => {
            expect(rowAction.safeParse(action({ type: "create", data: { id: "1", tag: "a", n: 2 } })).success).toBe(true);
        });

        it("admits an update naming a subset of fields, and one naming none", () => {
            expect(rowAction.safeParse(action({ type: "update", data: { n: 2 }, where: { id: "1" } })).success).toBe(true);
            expect(rowAction.safeParse(action({ type: "update", data: {}, where: { id: "1" } })).success).toBe(true);
        });

        it("admits a null value where the row declares one, since null is a value and undefined is not", () => {
            const NullableRowSchema = z.object({ id: z.string(), note: z.string().nullable() });
            expect(makeWriteActionSchema(NullableRowSchema).safeParse(action({ type: "update", data: { note: null }, where: { id: "1" } })).success).toBe(true);
        });

        it("admits a create whose defaulted field is simply omitted", () => {
            expect(rowAction.safeParse(action({ type: "create", data: { id: "1" } })).success).toBe(true);
        });
    });
});

/**
 * The rejection a caller receives, not merely that one happened.
 *
 * A write action is a union of ten verbs, so how an issue is reported depends on whether the failing arm stopped
 * or carried on: one arm still in the running reports its own fault directly, while an all-arms failure reports
 * the union. Both shapes are part of the gate's contract — a caller reading `error.issues` to explain a rejected
 * write depends on them — so they are asserted down to the properties each issue carries.
 */
describe("how the gate reports a rejected write action", () => {

    it("reports data the write language forbids as a single issue naming the verb's alternative", () => {
        const issue = onlyIssue(rowAction.safeParse(action({ type: "update", data: { n: undefined }, where: { id: "1" } })));
        expect(issue.code).toBe("custom");
        expect(issue.message).toBe(UPDATE_UNDEFINED_MESSAGE);
        expect(issue.path).toEqual(["payload", "data"]);
    });

    it("names the create alternative when a create is the verb", () => {
        const issue = onlyIssue(rowAction.safeParse(action({ type: "create", data: { id: "1", n: undefined } })));
        expect(issue.message).toBe(CREATE_UNDEFINED_MESSAGE);
        expect(issue.path).toEqual(["payload", "data"]);
    });

    it("carries nothing beyond a code, a message and a path, so the rejection round-trips as plain JSON", () => {
        const issue = onlyIssue(rowAction.safeParse(action({ type: "update", data: { n: undefined }, where: { id: "1" } })));
        expect(Object.keys(issue).sort()).toEqual(["code", "message", "path"]);
        expect(JSON.parse(JSON.stringify(issue))).toEqual(issue);
    });

    it("suppresses shape faults behind a forbidden value, so the caller is told the one thing to fix", () => {
        const issue = onlyIssue(rowAction.safeParse(action({ type: "update", data: { n: undefined, tag: 5 }, where: { id: "1" } })));
        expect(issue.message).toBe(UPDATE_UNDEFINED_MESSAGE);
    });

    it("reports a shape fault as a union rejection, listing what each verb made of the payload", () => {
        const issue = onlyIssue(rowAction.safeParse(action({ type: "update", data: { tag: 5 }, where: { id: "1" } })));
        expect(issue.code).toBe("invalid_union");
        expect(issue.path).toEqual(["payload"]);
        expect(unionArmIssues(issue)).toHaveLength(10); // one list per write verb
    });

    it("locates a bad field inside the data it was written in", () => {
        const issue = onlyIssue(rowAction.safeParse(action({ type: "update", data: { tag: 5 }, where: { id: "1" } })));
        const fieldIssue = allArmIssues(issue).find((i) => i.code === "invalid_type" && i.path?.join(".") === "data.tag");
        expect(fieldIssue).toBeDefined();
        expect(fieldIssue!.message).toBe("Invalid input: expected string, received number");
        expect(Object.keys(fieldIssue!).sort()).toEqual(["code", "expected", "message", "path"]);
    });

    it("locates an undeclared field on the data itself, since the fault is the data's shape", () => {
        const issue = onlyIssue(rowAction.safeParse(action({ type: "update", data: { unknown_field: "k" }, where: { id: "1" } })));
        const keyIssue = allArmIssues(issue).find((i) => i.code === "unrecognized_keys");
        expect(keyIssue).toBeDefined();
        expect(keyIssue!.path).toEqual(["data"]);
        expect(keyIssue!.message).toBe('Unrecognized key: "unknown_field"');
    });
});

/**
 * What the caller gets back from an accepted parse.
 *
 * Parsing a write action answers one question — may this write proceed? — and a row schema is only the yardstick
 * it is measured against. The action itself is the caller's document: a default, a coercion, or an exhaustively
 * keyed record would each hand back values the caller never wrote, attributed to them, while the write engine
 * goes on storing what was actually written. So an accepted action comes back carrying exactly the data it went
 * in with.
 */
describe("what an accepted write action carries", () => {

    it("carries an update's data as written, not the row schema's rendering of it", () => {
        // The row's default fires even through `.partial()`, so a rendering of this update would stamp `tag`
        // onto every matched item.
        expect(RowSchema.partial().parse({})).toEqual({ tag: "x" });

        expect(carriedData(rowAction.safeParse(action({ type: "update", data: {}, where: { id: "1" } })))).toStrictEqual({});
    });

    it("carries a create's data as written, inventing no field the caller left out", () => {
        expect(carriedData(rowAction.safeParse(action({ type: "create", data: { id: "1" } })))).toStrictEqual({ id: "1" });
    });

    it("carries a record without the keys its declared names would materialise", () => {
        const ScoredRowSchema = z.object({ id: z.string(), scores: z.record(z.enum(["home", "away"]), z.number().optional()) });
        // Parsing `{}` against this record invents both declared names, each holding undefined.
        expect(Object.getOwnPropertyNames(ScoredRowSchema.shape.scores.parse({}))).toEqual(["home", "away"]);

        const carried = carriedData(makeWriteActionSchema(ScoredRowSchema).safeParse(action({ type: "update", data: { scores: {} }, where: { id: "1" } })));
        expect(Object.getOwnPropertyNames(carried["scores"])).toEqual([]);
    });

    it("carries the caller's own object, so nothing downstream reads a value the caller cannot see", () => {
        const data = { n: 2 };
        expect(carriedData(rowAction.safeParse(action({ type: "update", data, where: { id: "1" } })))).toBe(data);
    });

    it("carries a nested array-scope action's data as written too, so both depths agree", () => {
        const NestedRowSchema = z.object({
            id: z.string(),
            children: z.array(z.object({ cid: z.string(), tag: z.string().default("x") })),
        });
        const nested = accepted(makeWriteActionSchema(NestedRowSchema).safeParse(action({
            type: "array_scope",
            scope: "children",
            action: { type: "create", data: { cid: "c1" } },
            where: { id: "1" },
        })));
        if (nested.payload.type !== "array_scope") throw new Error("expected the array_scope verb");
        expect(nested.payload.action).toStrictEqual({ type: "create", data: { cid: "c1" } });
    });
});

/**
 * Every way a row schema can substitute a value, answered by the write engine.
 *
 * A row schema has several devices for supplying a value the caller did not write — a default, a prefault, a
 * coercion, a catch, a transform, a nested default — and a parse gate is free to apply none of them, because the
 * engine that ultimately stores the write applies none of them either. Each row below states what the engine
 * commits, so the gate's answer is checked against the system of record rather than against an expectation
 * written down beside it.
 */
describe("a row schema's substitutions reach neither the parsed action nor the stored item", () => {

    /** One row of the register: a schema that offers to substitute a value, and what each layer does with it. */
    type SubstitutionCase = {
        /** The substitution the row schema offers, which neither layer takes up. */
        substitution: string;
        rowSchema: z.ZodObject;
        payload: DataPayload;
        existingItems?: EngineRow[];
        /** What the engine commits — the answer the gate has to agree with. */
        stored: EngineRow[];
    };

    const register: SubstitutionCase[] = [
            {
                substitution: "a default for an omitted field",
                rowSchema: z.object({ id: z.string(), tag: z.string().default("x") }),
                payload: { type: "create", data: { id: "a" } },
                stored: [{ id: "a" }],
            },
            {
                substitution: "a prefault for an omitted field",
                rowSchema: z.object({ id: z.string(), n: z.number().prefault(7) }),
                payload: { type: "create", data: { id: "a" } },
                stored: [{ id: "a" }],
            },
            {
                substitution: "a coercion of a string into a number",
                rowSchema: z.object({ id: z.string(), n: z.coerce.number() }),
                payload: { type: "create", data: { id: "a", n: "5" } },
                stored: [{ id: "a", n: "5" }],
            },
            {
                substitution: "a catch standing in for an unparseable value",
                rowSchema: z.object({ id: z.string(), n: z.number().catch(0) }),
                payload: { type: "create", data: { id: "a", n: "zzz" } },
                stored: [{ id: "a", n: "zzz" }],
            },
            {
                substitution: "a transform rewriting a value",
                rowSchema: z.object({ id: z.string(), s: z.string().transform((s) => s.toUpperCase()) }),
                payload: { type: "create", data: { id: "a", s: "lower" } },
                stored: [{ id: "a", s: "lower" }],
            },
            {
                substitution: "a default nested inside an object field",
                rowSchema: z.object({ id: z.string(), meta: z.object({ a: z.string().default("m") }) }),
                payload: { type: "create", data: { id: "a", meta: {} } },
                stored: [{ id: "a", meta: {} }],
            },
            {
                substitution: "a coercion on an updated field",
                rowSchema: z.object({ id: z.string(), n: z.coerce.number().optional() }),
                payload: { type: "update", data: { n: "5" }, where: { id: "a" } },
                existingItems: [{ id: "a", n: 1 }],
                stored: [{ id: "a", n: "5" }],
            },
        ];

    it.each(register)("does not take up $substitution", ({ rowSchema, payload, existingItems, stored }: SubstitutionCase) => {
        const parsed = makeWriteActionSchema(rowSchema).safeParse(action(payload));
        expect(carriedData(parsed)).toBe(payload.data);
        expect(storedBy(rowSchema, payload, existingItems)).toStrictEqual(stored);
    });

    it.each(register)("accepts its own accepted action again, unchanged, when it did not take up $substitution", ({ rowSchema, payload }: SubstitutionCase) => {
        const gate = makeWriteActionSchema(rowSchema);
        const once = accepted(gate.safeParse(action(payload)));
        const twice = accepted(gate.safeParse(once));
        expect(twice).toStrictEqual(once);
    });

    it("accepts its own accepted action again when a record would have materialised keys", () => {
        // A gate that judged the rendering would reject this on the second pass: the record's declared names
        // come back present and holding undefined, which is precisely what the gate forbids.
        const gate = makeWriteActionSchema(z.object({ id: z.string(), scores: z.record(z.enum(["home", "away"]), z.number().optional()) }));
        const once = accepted(gate.safeParse(action({ type: "update", data: { scores: {} }, where: { id: "a" } })));
        expect(accepted(gate.safeParse(once))).toStrictEqual(once);
    });
});

/**
 * Values a write action cannot carry, whatever the row schema makes of them.
 *
 * A write action is a JSON document: it may be stored, sent over a network, or replayed from a log, and a value
 * with no faithful JSON form means something different on the other side — a `Date` becomes a string, `NaN`
 * becomes `null`, a `bigint` throws. The engine refuses every one of them before it writes, so the gate that
 * carries values through to the engine refuses them too. A tolerant row schema does not change the answer: a
 * `.catch()` that would quietly stand a number in for a bigint hides the fault rather than fixing it.
 */
describe("values that cannot survive a JSON round trip are refused, as the engine refuses them", () => {

    /**
     * A row that names its fields but not their types. Every value below is one the row schema itself accepts,
     * so nothing here is refused for the shape of the data — only for what the value is.
     */
    const OpenRowSchema = z.object({ id: z.string(), n: z.any().optional(), when: z.any().optional(), meta: z.any().optional() });

    it("refuses a value with no JSON form that an open row schema would keep", () => {
        const payload: DataPayload = { type: "create", data: { id: "a", when: new Date() } };
        expect(OpenRowSchema.safeParse(payload.data).success).toBe(true); // the row schema is content with it

        expect(makeWriteActionSchema(OpenRowSchema).safeParse(action(payload)).success).toBe(false);

        const [engineError] = engineErrors(OpenRowSchema, payload);
        expect(engineError?.type).toBe("invalid_data_value");
        if (engineError?.type === "invalid_data_value") expect(engineError.reason).toBe("malformed");
    });

    it("refuses a number JSON cannot represent, in an update as in a create", () => {
        const payload: DataPayload = { type: "update", data: { n: Number.NaN }, where: { id: "a" } };
        expect(OpenRowSchema.partial().safeParse(payload.data).success).toBe(true); // the row schema is content with it

        expect(makeWriteActionSchema(OpenRowSchema).safeParse(action(payload)).success).toBe(false);

        const [engineError] = engineErrors(OpenRowSchema, payload, [{ id: "a" }]);
        expect(engineError?.type).toBe("invalid_data_value");
        if (engineError?.type === "invalid_data_value") expect(engineError.reason).toBe("non_finite");
    });

    it("refuses a value a tolerant row schema would silently stand a legal one in for", () => {
        // `.catch(0)` answers "is this a valid row?" with yes — by replacing the value. The write still carries
        // the bigint, so agreeing with the row schema here would admit a write the engine goes on to refuse.
        const CatchingRowSchema = z.object({ id: z.string(), n: z.number().catch(0) });
        const payload: DataPayload = { type: "create", data: { id: "a", n: 5n } };
        expect(CatchingRowSchema.safeParse({ id: "a", n: 5n }).success).toBe(true);

        expect(makeWriteActionSchema(CatchingRowSchema).safeParse(action(payload)).success).toBe(false);

        const [engineError] = engineErrors(CatchingRowSchema, payload);
        expect(engineError?.type).toBe("invalid_data_value");
        if (engineError?.type === "invalid_data_value") expect(engineError.reason).toBe("malformed");
    });

    it("locates the offending value, and names the fault without quoting it", () => {
        const issue = onlyIssue(makeWriteActionSchema(OpenRowSchema).safeParse(action({ type: "create", data: { id: "a", meta: { when: new Date() } } })));
        expect(issue.path).toEqual(["payload", "data", "meta", "when"]);
        expect(issue.message).toContain("JSON");
    });

    it("reports every offending value at once, where the engine names only the first", () => {
        const payload: DataPayload = { type: "create", data: { id: "a", when: new Date(), n: Number.POSITIVE_INFINITY } };

        const result = makeWriteActionSchema(OpenRowSchema).safeParse(action(payload));
        if (result.success) throw new Error("expected the parse to be rejected");
        expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(["payload.data.when", "payload.data.n"]);

        // The two layers agree on the verdict, and differ only in how much of it they say: an action carries one
        // error per write, so the engine reports the first fault its walk found.
        const engine = engineErrors(OpenRowSchema, payload);
        expect(engine).toHaveLength(1);
        expect(engine[0]?.type).toBe("invalid_data_value");
        if (engine[0]?.type === "invalid_data_value") expect(engine[0].data_path).toBe("when");
    });

    it("still admits the values JSON does carry, including null and a nested empty object", () => {
        expect(makeWriteActionSchema(OpenRowSchema).safeParse(action({ type: "create", data: { id: "a", n: null, meta: { nested: [1, "two", null] } } })).success).toBe(true);
    });
});

/**
 * Row schemas that can only answer asynchronously.
 *
 * A row schema may check something it cannot know on the spot — that a handle is still free, that a reference
 * resolves — and Zod's rule for those is the ordinary one: parse asynchronously, or the parse throws. A write
 * action schema built from such a row behaves the same way, so a caller already awaiting its row schema awaits
 * this one and gets the same answers.
 */
describe("a row schema that answers asynchronously", () => {

    const AsyncRowSchema = z.object({
        id: z.string(),
        handle: z.string().refine(async (handle) => handle !== "taken", "that handle is taken"),
    });
    const asyncAction = makeWriteActionSchema(AsyncRowSchema);

    it("accepts a valid write, carrying its data as written", async () => {
        const data = { id: "a", handle: "free" };
        expect(carriedData(await asyncAction.safeParseAsync(action({ type: "create", data })))).toBe(data);
    });

    it("rejects a write its asynchronous check refuses, locating the field", async () => {
        const result = await asyncAction.safeParseAsync(action({ type: "create", data: { id: "a", handle: "taken" } }));
        if (result.success) throw new Error("expected the parse to be rejected");
        const refusal = result.error.issues.flatMap((issue) => (issue.code === "invalid_union" ? issue.errors.flat() : [issue]));
        expect(refusal.some((issue) => issue.message === "that handle is taken" && issue.path.join(".").endsWith("data.handle"))).toBe(true);
    });

    it("rejects a write its shape refuses, without waiting on the asynchronous check", async () => {
        const result = await asyncAction.safeParseAsync(action({ type: "create", data: { id: "a", handle: 5 } }));
        expect(result.success).toBe(false);
    });

    it("refuses an unwritable value without reaching the asynchronous check at all", async () => {
        const result = await asyncAction.safeParseAsync(action({ type: "create", data: { id: "a", handle: undefined } }));
        expect(onlyIssue(result).message).toBe(CREATE_UNDEFINED_MESSAGE);
    });

    it("throws when parsed synchronously, as any asynchronous schema does", () => {
        expect(() => asyncAction.safeParse(action({ type: "create", data: { id: "a", handle: "free" } }))).toThrow();
    });
});

/**
 * A stored item is never the caller's action.
 *
 * An action is a document the caller keeps: it may be retried, logged, compared against the outcome, or replayed
 * from a queue, and it has to still say what it said when it was written. Items, by contrast, are edited in
 * place as later writes land on them. Letting a stored item hold values from the action would join the two, so a
 * write applied afterwards would silently rewrite the record of a write already made.
 */
describe("a stored item never aliases the action that wrote it", () => {

    const AliasRowSchema = z.object({
        id: z.string(),
        meta: z.object({ tag: z.string() }).optional(),
        tags: z.array(z.string()).optional(),
    });

    it("leaves an earlier create action untouched when a later write in the same batch changes the item", () => {
        const written = { id: "a", meta: { tag: "as written" } };
        const batch: WriteAction<EngineRow>[] = [
            { type: "write", ts: 1, uuid: "u1", payload: { type: "create", data: written } },
            { type: "write", ts: 2, uuid: "u2", payload: { type: "update", data: { meta: { tag: "changed later" } }, where: { id: "a" } } },
        ];

        const result = writeToItemsArray<EngineRow>(batch, [], AliasRowSchema, idKeyedDdl, { mutate: true });

        expect(result.ok).toBe(true);
        expect(written).toStrictEqual({ id: "a", meta: { tag: "as written" } });
    });

    it("stores a copy of a create's data rather than the data itself", () => {
        const data = { id: "a", meta: { tag: "t" } };
        const stored = storedBy(AliasRowSchema, { type: "create", data });
        expect(stored[0]).toStrictEqual(data); // the same value …
        expect(stored[0]).not.toBe(data); // … held separately
        expect(stored[0]?.meta).not.toBe(data.meta);
    });

    it("stores a copy of an array an update installs", () => {
        const data = { tags: ["x"] };
        const stored = storedBy(AliasRowSchema, { type: "update", data, where: { id: "a" } }, [{ id: "a" }]);
        expect(stored[0]?.tags).toStrictEqual(["x"]);
        expect(stored[0]?.tags).not.toBe(data.tags);
    });

    it("stores a copy of every value an assigning update installs", () => {
        const data = { meta: { tag: "new" } };
        const stored = storedBy(AliasRowSchema, { type: "update", data, where: { id: "a" }, method: "assign" }, [{ id: "a", meta: { tag: "old" } }]);
        expect(stored[0]?.meta).toStrictEqual({ tag: "new" });
        expect(stored[0]?.meta).not.toBe(data.meta);
    });
});
