import { z } from "zod";
import { describe, it, expect } from "vitest";
import { makeWriteActionSchema } from "./write-action-schemas.ts";
import { writeToItemsArray } from "./writeToItemsArray/writeToItemsArray.ts";
import { getWriteErrors } from "./helpers.ts";
import type { WriteAction, WriteErrorContext, WritePayloadAddToSet, WritePayloadCreate, WritePayloadPush, WritePayloadUpdate } from "./types.ts";
import type { DDL } from "../ddl/types.ts";
import { parseDotPropPathSegments } from "../dot-prop-paths/dotPropPathSegments.ts";
import { isDraft, produce } from "immer";

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

/**
 * The accepted action a parse produced, failing the test with the rejection's reason if there was one.
 *
 * Generic over the row type, because which verbs a payload union even offers depends on the row: a row with no
 * array of objects has no `array_scope` variant to narrow to. A case that reads a verb's own fields names its row
 * type; the rest are content with the loosest one.
 */
function accepted<T extends Record<string, any>>(result: z.ZodSafeParseResult<WriteAction<T>>): WriteAction<T> {
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
type EngineRow = { id: string; tag?: string; n?: unknown; s?: string; meta?: Record<string, unknown>; when?: unknown; tags?: string[]; bag?: unknown[]; rows?: { rid: string }[]; "when.at"?: unknown };

/** The two verbs that carry written data. */
type DataPayload = WritePayloadCreate<EngineRow> | WritePayloadUpdate<EngineRow>;

/** Every verb that carries written values: an item's own fields, or the elements of one of its lists. */
type WritingPayload = DataPayload | WritePayloadPush<EngineRow> | WritePayloadAddToSet<EngineRow>;

/** The root list keyed by `id`, and its one nested list keyed by `rid` — every list the cases below write to. */
const idKeyedDdl: DDL<EngineRow> = {
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
function storedBy(rowSchema: z.ZodObject, payload: WritingPayload, items: EngineRow[] = []): EngineRow[] {
    const result = engineWrite(rowSchema, payload, items);
    if (!result.ok) throw new Error(`the engine refused the write: ${JSON.stringify(getWriteErrors(result))}`);
    return result.changes.final_items;
}

/** Every error the engine raised for one action — empty when it accepted the write. */
function engineErrors(rowSchema: z.ZodObject, payload: WritingPayload, items: EngineRow[] = []): WriteErrorContext[] {
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
 * The options a caller parses with reach a row schema's issues.
 *
 * Zod lets a caller shape one parse: an error map that words every rejection in the caller's own vocabulary,
 * `reportInput` to attach the value that failed so a log or a form can show it. Those options describe the parse,
 * not the schema, so they have to reach a row's issues exactly as they reach the envelope's own — a row schema
 * measured off to one side would answer a different parse than the one the caller asked for.
 */
describe("a row schema's issues answer to the parse that raised them", () => {

    /** The row-schema issue a bad `data` field produced, from within the union rejection that reports it. */
    function fieldIssueFor(result: z.ZodSafeParseResult<unknown>): z.core.$ZodIssue {
        const found = allArmIssues(onlyIssue(result)).find((issue) => issue.path?.join(".") === "data.id");
        if (!found) throw new Error("expected an issue naming the data's id field");
        return found;
    }

    it("words a row-schema rejection with the error map the caller passed", () => {
        const issue = fieldIssueFor(rowAction.safeParse(action({ type: "create", data: { id: 5 } }), { error: () => "as the caller words it" }));
        expect(issue.message).toBe("as the caller words it");
    });

    it("attaches the offending field's own value when the caller asks for the input", () => {
        const issue = fieldIssueFor(rowAction.safeParse(action({ type: "create", data: { id: 5 } }), { reportInput: true }));
        expect(issue.input).toBe(5);
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
        type NestedRow = { id: string; children: { cid: string; tag: string }[] };
        const NestedRowSchema = z.object({
            id: z.string(),
            children: z.array(z.object({ cid: z.string(), tag: z.string().default("x") })),
        });
        const nested = accepted(makeWriteActionSchema<NestedRow>(NestedRowSchema).safeParse(action({
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
            {
                // The stored item is judged again once the update has merged into it, and it still holds only the
                // keys it was written with. A layer that demanded the substituted value rather than the written one
                // would refuse this update outright, and with it every row whose schema grew a default after the
                // row was written.
                substitution: "a default for a field the updated item never held",
                rowSchema: z.object({ id: z.string(), tag: z.string().default("x"), s: z.string().optional() }),
                payload: { type: "update", data: { s: "next" }, where: { id: "a" } },
                existingItems: [{ id: "a" }],
                stored: [{ id: "a", s: "next" }],
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

    it("refuses data that contains itself, answering rather than running out of stack", () => {
        // `JSON.stringify` throws on a structure that leads back to itself, so the write cannot cross a boundary
        // — and a gate exists to say so, not to fall over on the way to finding out.
        const data: EngineRow = { id: "a" };
        data.n = data;
        expect(OpenRowSchema.safeParse(data).success).toBe(true); // the row schema is content with it

        const issue = onlyIssue(makeWriteActionSchema(OpenRowSchema).safeParse(action({ type: "create", data })));
        expect(issue.path).toEqual(["payload", "data", "n"]);
        expect(issue.message).toContain("JSON");

        const [engineError] = engineErrors(OpenRowSchema, { type: "create", data });
        expect(engineError?.type).toBe("invalid_data_value");
        if (engineError?.type === "invalid_data_value") expect(engineError.reason).toBe("malformed");
    });

    it("admits data that names the same object twice without leading back to it", () => {
        // Two keys sharing one value is not a cycle: JSON writes the value out twice, and both sides read back
        // what was written.
        const shared = { tag: "t" };
        expect(makeWriteActionSchema(OpenRowSchema).safeParse(action({ type: "create", data: { id: "a", n: shared, meta: shared } })).success).toBe(true);
    });

    it("names a key that itself holds a dot as the one key it is", () => {
        // A dot separates keys in a path, so a key containing one has to be escaped or the path names two keys
        // that do not exist. The row schema below declares exactly one field, called `when.at`.
        const DottedKeyRowSchema = z.object({ id: z.string(), "when.at": z.any().optional() });
        const payload: DataPayload = { type: "create", data: { id: "a", "when.at": new Date() } };

        const issue = onlyIssue(makeWriteActionSchema(DottedKeyRowSchema).safeParse(action(payload)));
        expect(issue.path).toEqual(["payload", "data", "when.at"]);

        const [engineError] = engineErrors(DottedKeyRowSchema, payload);
        if (engineError?.type !== "invalid_data_value") throw new Error("expected the engine to refuse the value");
        expect(parseDotPropPathSegments(engineError.data_path!)).toEqual(["when.at"]);
    });

    it("names an array element by its index, in the string form every path segment takes", () => {
        // Every segment of a dot-path is a string, and `list['0']` and `list[0]` reach the same element — so an
        // index is left as it is written rather than read back out of the path as a number.
        const issue = onlyIssue(makeWriteActionSchema(OpenRowSchema).safeParse(action({ type: "create", data: { id: "a", n: [1, Number.NaN] } })));
        expect(issue.path).toEqual(["payload", "data", "n", "1"]);
    });

    it("still admits the values JSON does carry, including null and a nested empty object", () => {
        expect(makeWriteActionSchema(OpenRowSchema).safeParse(action({ type: "create", data: { id: "a", n: null, meta: { nested: [1, "two", null] } } })).success).toBe(true);
    });
});

/**
 * The elements a push or an add_to_set writes are judged as closely as a create's fields.
 *
 * A list element is written data too: it is stored, reloaded, and compared against later writes. So the same
 * question applies — will this value still say what it says once the action has crossed a JSON boundary? — and the
 * engine answers it for every element before it appends one. The gate agrees, element by element, or a caller is
 * told a write may proceed that the engine then refuses.
 *
 * An `undefined` is the one value the two verbs read differently from a create. A create's undefined KEY is dropped
 * by `JSON.stringify`, so it is refused; a list item's undefined key is left alone, because these items are
 * compared by deep equality, which reads an absent key the same way. But an undefined ELEMENT has no absence to
 * degrade to: `null` is written in its place, and the list arrives holding a value it never held.
 */
describe("the elements a list-writing verb carries are judged as the engine judges them", () => {

    /** A row with a list that names no element type, so nothing below is refused for the shape of an element. */
    const ListRowSchema = z.object({ id: z.string(), bag: z.array(z.any()).optional() });
    const listAction = makeWriteActionSchema<EngineRow>(ListRowSchema);
    const existing: EngineRow[] = [{ id: "a" }];

    const UNDEFINED_ELEMENT_MESSAGE =
        "A list has no absent positions, so JSON writes an undefined element as null; leave the element out of the list, or write null if that is the value you mean";

    /** The engine's verdict on one payload: the reason it refused, and where, or nothing if it accepted. */
    function engineVerdict(payload: WritingPayload): { reason: string; data_path?: string | undefined } | undefined {
        const [error] = engineErrors(ListRowSchema, payload, existing);
        if (!error) return undefined;
        if (error.type !== "invalid_data_value") throw new Error(`expected a value refusal, got '${error.type}'`);
        return { reason: error.reason, data_path: error.data_path };
    }

    it("refuses an element with no JSON form, where the engine refuses the same element", () => {
        const payload: WritingPayload = { type: "push", path: "bag", items: [new Date()], where: { id: "a" } };
        expect(ListRowSchema.safeParse({ id: "a", bag: payload.items }).success).toBe(true); // the row schema is content with it

        const issue = onlyIssue(listAction.safeParse(action(payload)));
        expect(issue.path).toEqual(["payload", "items", 0]);
        expect(issue.message).toContain("JSON");

        expect(engineVerdict(payload)).toEqual({ reason: "malformed", data_path: "bag.0" });
    });

    it("refuses a number JSON cannot represent, naming the element it sits in", () => {
        const payload: WritingPayload = { type: "push", path: "bag", items: [1, Number.NaN], where: { id: "a" } };

        expect(onlyIssue(listAction.safeParse(action(payload))).path).toEqual(["payload", "items", 1]);

        expect(engineVerdict(payload)).toEqual({ reason: "non_finite", data_path: "bag.1" });
    });

    it("refuses an add_to_set's candidate elements on the same terms as a push's", () => {
        const payload: WritingPayload = { type: "add_to_set", path: "bag", items: [5n], unique_by: "deep_equals", where: { id: "a" } };

        expect(onlyIssue(listAction.safeParse(action(payload))).path).toEqual(["payload", "items", 0]);

        expect(engineVerdict(payload)).toEqual({ reason: "malformed", data_path: "bag.0" });
    });

    it("locates a fault nested inside an element, rather than blaming the element as a whole", () => {
        const payload: WritingPayload = { type: "push", path: "bag", items: [{ ok: 1 }, { when: new Date() }], where: { id: "a" } };

        expect(onlyIssue(listAction.safeParse(action(payload))).path).toEqual(["payload", "items", 1, "when"]);

        expect(engineVerdict(payload)).toEqual({ reason: "malformed", data_path: "bag.1.when" });
    });

    it("reports every offending element at once, where the engine names only the first", () => {
        const payload: WritingPayload = { type: "push", path: "bag", items: [new Date(), "ok", Number.NaN], where: { id: "a" } };

        const result = listAction.safeParse(action(payload));
        if (result.success) throw new Error("expected the parse to be rejected");
        expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(["payload.items.0", "payload.items.2"]);

        expect(engineVerdict(payload)).toEqual({ reason: "malformed", data_path: "bag.0" });
    });

    it("admits an undefined key inside an element, which deep equality reads as the absence it becomes", () => {
        const payload: WritingPayload = { type: "push", path: "bag", items: [{ ok: 1, label: undefined }], where: { id: "a" } };

        expect(listAction.safeParse(action(payload)).success).toBe(true);

        expect(engineVerdict(payload)).toBeUndefined();
        expect(storedBy(ListRowSchema, payload, existing)[0]?.bag).toStrictEqual([{ ok: 1, label: undefined }]);
    });

    it("refuses an undefined element, naming the way to say what was meant", () => {
        const payload: WritingPayload = { type: "push", path: "bag", items: [undefined], where: { id: "a" } };

        const issue = onlyIssue(listAction.safeParse(action(payload)));
        expect(issue.path).toEqual(["payload", "items", 0]);
        expect(issue.message).toBe(UNDEFINED_ELEMENT_MESSAGE);

        expect(engineVerdict(payload)).toEqual({ reason: "malformed", data_path: "bag.0" });
    });

    it("names every undefined element, since which position to fix is the whole remedy", () => {
        // Where a create collapses to one answer — the remedy is the same wherever in `data` the undefined was —
        // a list needs the indices: each is a separate element to leave out or spell as null.
        const payload: WritingPayload = { type: "add_to_set", path: "bag", items: [undefined, "ok", undefined], unique_by: "deep_equals", where: { id: "a" } };

        const result = listAction.safeParse(action(payload));
        if (result.success) throw new Error("expected the parse to be rejected");
        expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(["payload.items.0", "payload.items.2"]);
        expect(result.error.issues.every((issue) => issue.message === UNDEFINED_ELEMENT_MESSAGE)).toBe(true);
    });

    it("refuses an undefined element nested inside one, at the depth it was written", () => {
        const payload: WritingPayload = { type: "push", path: "bag", items: [{ tags: ["a", undefined] }], where: { id: "a" } };

        expect(onlyIssue(listAction.safeParse(action(payload))).path).toEqual(["payload", "items", 0, "tags", 1]);

        expect(engineVerdict(payload)).toEqual({ reason: "malformed", data_path: "bag.0.tags.1" });
    });

    it("names an element by the number of its position, and a key that merely looks like one by its own name", () => {
        // `items` is a field of the action document, so a rejection locates an element the way Zod locates one and
        // a caller can follow the path to the value that failed. A key is only read as a position if it reads back
        // as itself: `01` is a key, and the property a caller would reach for the number 1 does not exist.
        const payload: WritingPayload = { type: "push", path: "bag", items: [{ "01": new Date(), "1": "ok" }], where: { id: "a" } };

        expect(onlyIssue(listAction.safeParse(action(payload))).path).toEqual(["payload", "items", 0, "01"]);

        const numbered: WritingPayload = { type: "push", path: "bag", items: [{ "1": new Date() }], where: { id: "a" } };
        expect(onlyIssue(listAction.safeParse(action(numbered))).path).toEqual(["payload", "items", 0, 1]);
    });

    it("carries the caller's own list, so nothing downstream reads a value the caller cannot see", () => {
        const items = ["a", { b: 1 }];
        const parsed = accepted<EngineRow>(listAction.safeParse(action({ type: "push", path: "bag", items, where: { id: "a" } }))).payload;
        if (parsed.type !== "push") throw new Error("expected the push verb");
        expect(parsed.items).toBe(items);
    });

    it("refuses a list that is not a list at all", () => {
        expect(onlyIssue(listAction.safeParse(action({ type: "push", path: "bag", items: 5, where: { id: "a" } }))).path).toEqual(["payload", "items"]);
        expect(listAction.safeParse(action({ type: "push", path: "bag", where: { id: "a" } })).success).toBe(false);
    });

    it("still admits the elements JSON does carry, including null and a nested list", () => {
        const payload: WritingPayload = { type: "push", path: "bag", items: [null, "two", { nested: [1, null] }], where: { id: "a" } };

        expect(listAction.safeParse(action(payload)).success).toBe(true);
        expect(storedBy(ListRowSchema, payload, existing)[0]?.bag).toStrictEqual([null, "two", { nested: [1, null] }]);
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

    it("runs the check once for each verb that measures the data, never twice for one", async () => {
        // A check that reaches a database or an API is charged for every call, so a write must not pay twice for
        // one answer. Two verbs carry data — create and update — and each measures this create's data once.
        let checks = 0;
        const CountingRowSchema = z.object({
            id: z.string(),
            handle: z.string().refine(async () => { checks++; return true; }),
        });

        await makeWriteActionSchema(CountingRowSchema).safeParseAsync(action({ type: "create", data: { id: "a", handle: "free" } }));

        expect(checks).toBe(2);
    });

    it("leaves no unhandled rejection behind when the check itself fails", async () => {
        // A check that throws is the caller's to handle, once. An abandoned second attempt would reject with
        // nobody waiting on it, which by default takes the process down long after the write was answered.
        const ThrowingRowSchema = z.object({
            id: z.string(),
            handle: z.string().refine(async () => { throw new Error("the handle service is down"); }),
        });
        const unhandled: unknown[] = [];
        const capture = (reason: unknown) => { unhandled.push(reason); };

        process.on("unhandledRejection", capture);
        try {
            await makeWriteActionSchema(ThrowingRowSchema)
                .safeParseAsync(action({ type: "create", data: { id: "a", handle: "free" } }))
                .catch(() => undefined);
            await new Promise((resolve) => { setImmediate(resolve); });
        } finally {
            process.off("unhandledRejection", capture);
        }

        expect(unhandled).toEqual([]);
    });

    /**
     * A row schema need not be asynchronous for every value it is given: a check may answer on the spot for most
     * data and go looking only for some of it. Whichever kind of write arrives first, the next one of the other
     * kind gets the same answer it would have got on its own.
     */
    describe("whose asynchrony depends on the data it is given", () => {

        const SometimesAsyncRowSchema = z.object({
            id: z.string(),
            handle: z.string().refine(
                (handle) => (handle.startsWith("looked-up-") ? Promise.resolve(handle !== "looked-up-taken") : handle !== "taken"),
                "that handle is taken",
            ),
        });

        /** A fresh gate per case: what one write teaches a schema must not decide how the next one is answered. */
        const sometimesAsyncAction = () => makeWriteActionSchema(SometimesAsyncRowSchema);

        it("answers a write it can settle on the spot, and then one it has to go and look up", async () => {
            const gate = sometimesAsyncAction();

            expect(gate.safeParse(action({ type: "create", data: { id: "a", handle: "free" } })).success).toBe(true);

            expect((await gate.safeParseAsync(action({ type: "create", data: { id: "b", handle: "looked-up-free" } }))).success).toBe(true);
            expect((await gate.safeParseAsync(action({ type: "create", data: { id: "c", handle: "looked-up-taken" } }))).success).toBe(false);
        });

        it("answers a write it has to look up, and then one it can settle on the spot", async () => {
            const gate = sometimesAsyncAction();

            expect((await gate.safeParseAsync(action({ type: "create", data: { id: "a", handle: "looked-up-free" } }))).success).toBe(true);

            expect(gate.safeParse(action({ type: "create", data: { id: "b", handle: "free" } })).success).toBe(true);
            expect(gate.safeParse(action({ type: "create", data: { id: "c", handle: "taken" } })).success).toBe(false);
        });

        it("still refuses a synchronous parse of a write it would have to look up", () => {
            const gate = sometimesAsyncAction();
            gate.safeParse(action({ type: "create", data: { id: "a", handle: "free" } }));

            expect(() => gate.safeParse(action({ type: "create", data: { id: "b", handle: "looked-up-free" } }))).toThrow();
        });
    });
});

/**
 * The Zod entry point the gate measures a row schema through.
 *
 * Measuring the data as part of the caller's parse means running the row schema the way Zod's own combinators
 * run their inner schemas — `_zod.run` — rather than starting a separate parse beside it. That entry point is
 * not part of Zod's documented surface, so what the gate relies on is stated here rather than assumed.
 *
 * A failure here after a Zod upgrade is a design decision, not a typo: either follow the moved entry point, or
 * fall back to `dataSchema.safeParse` inside the refinement and accept what that costs — the caller's per-parse
 * options stop reaching row issues, and an asynchronous check runs twice per verb, the second run abandoned.
 */
describe("the Zod entry point the gate measures a row schema through", () => {

    const PinnedRowSchema = z.object({ id: z.string() });

    it("judges a value and answers with the payload, synchronously for a synchronous schema", () => {
        const result = PinnedRowSchema._zod.run({ value: { id: "a" }, issues: [] }, {});
        if (result instanceof Promise) throw new Error("a synchronous row schema must answer without a promise");
        expect(result.issues, "an accepted value must raise nothing").toEqual([]);
    });

    it("reports an issue unfinished, which is what leaves the wording to the caller's parse", () => {
        const result = PinnedRowSchema._zod.run({ value: { id: 5 }, issues: [] }, {});
        if (result instanceof Promise) throw new Error("a synchronous row schema must answer without a promise");

        const issue = result.issues[0];
        expect(issue, "a rejected value must raise an issue").toBeDefined();
        expect(issue!.path, "the issue must be located relative to the row, for the gate to place it under `data`").toEqual(["id"]);
        expect(issue!.inst, "the issue must still name the schema that raised it, or its own wording is lost").toBeDefined();
        expect(issue!.input, "the issue must carry the value that failed, not the object holding it").toBe(5);
        expect("message" in issue!, "an unfinished issue has no message yet — that is what lets the caller's error map word it").toBe(false);
    });

    it("answers with a promise for a schema that can only answer asynchronously", async () => {
        const AsyncPinnedRowSchema = z.object({ id: z.string().refine(async () => true) });
        const result = AsyncPinnedRowSchema._zod.run({ value: { id: "a" }, issues: [] }, {});
        expect(result instanceof Promise, "an asynchronous row schema must answer with a promise, not throw").toBe(true);
        expect((await result).issues).toEqual([]);
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

    /** A row whose list holds objects, so an appended element has an interior of its own to be copied. */
    const ObjectListRowSchema = z.object({
        id: z.string(),
        rows: z.array(z.object({ rid: z.string() })).optional(),
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

    /**
     * Callers compose objects behind proxies — an Immer draft inside a producer, a reactive object from a UI
     * framework — and a proxy over plain data is plain data: it round-trips JSON unchanged, so the gate accepts
     * it. Taking the copy is the engine's own step, and it cannot be the thing that refuses a write the gate
     * already allowed.
     */
    describe("even when the caller composed that action behind a proxy", () => {

        it("stores data written through a plain proxy, detached from what the proxy stood for", () => {
            const behind = { id: "a", meta: { tag: "t" } };

            const stored = storedBy(AliasRowSchema, { type: "create", data: new Proxy(behind, {}) });

            expect(stored[0]).toStrictEqual({ id: "a", meta: { tag: "t" } });
            behind.meta.tag = "changed after the write";
            expect(stored[0]?.meta?.tag).toBe("t");
        });

        it("stores data written from inside a draft, which cannot be handed on once the draft is done", () => {
            let stored: EngineRow[] = [];
            produce({ id: "a", meta: { tag: "t" } }, (draft) => {
                stored = storedBy(AliasRowSchema, { type: "create", data: draft });
            });

            expect(stored[0]).toStrictEqual({ id: "a", meta: { tag: "t" } });
            expect(isDraft(stored[0])).toBe(false);
        });

        it("stores an update's values written through a proxy", () => {
            const behind = { meta: { tag: "new" } };

            const stored = storedBy(AliasRowSchema, { type: "update", data: new Proxy(behind, {}), where: { id: "a" } }, [{ id: "a", meta: { tag: "old" } }]);

            expect(stored[0]?.meta).toStrictEqual({ tag: "new" });
            expect(stored[0]?.meta).not.toBe(behind.meta);
        });

        it("appends elements composed inside a draft, which the draft cannot be asked for once it is done", () => {
            let stored: EngineRow[] = [];
            produce({ id: "a", tags: ["kept"] }, (draft) => {
                stored = storedBy(AliasRowSchema, { type: "push", path: "tags", items: draft.tags, where: { id: "a" } }, [{ id: "a", tags: [] }]);
            });

            expect(stored[0]?.tags).toStrictEqual(["kept"]);
            expect(isDraft(stored[0]?.tags)).toBe(false);
        });

        it("adds elements composed inside a draft, deciding what is already there before taking the copy", () => {
            let stored: EngineRow[] = [];
            produce({ id: "a", rows: [{ rid: "r1" }, { rid: "r2" }] }, (draft) => {
                stored = storedBy(
                    ObjectListRowSchema,
                    { type: "add_to_set", path: "rows", items: draft.rows, unique_by: "deep_equals", where: { id: "a" } },
                    [{ id: "a", rows: [{ rid: "r1" }] }],
                );
            });

            // The element already present is recognised through the proxy, so only the new one is appended.
            expect(stored[0]?.rows).toStrictEqual([{ rid: "r1" }, { rid: "r2" }]);
            expect(isDraft(stored[0]?.rows?.[1])).toBe(false);
        });
    });

    /**
     * A list the caller keeps writing to is not the list that was stored.
     *
     * `items` is carried by reference all the way to the engine, which is what lets a caller compare the action it
     * sent against the outcome it got. The copy the engine takes is therefore the only thing standing between a
     * later edit of that action and a silent rewrite of a record already written.
     */
    describe("even when the caller goes on editing the list it wrote", () => {

        it("stores elements held separately from the ones the action carries", () => {
            const items = [{ rid: "r1" }];
            const stored = storedBy(ObjectListRowSchema, { type: "push", path: "rows", items, where: { id: "a" } }, [{ id: "a", rows: [] }]);

            expect(stored[0]?.rows).toStrictEqual([{ rid: "r1" }]);
            expect(stored[0]?.rows?.[0]).not.toBe(items[0]);
        });

        it("leaves the stored elements as they were when a later edit changes the action's own", () => {
            const items = [{ rid: "r1" }];
            const stored = storedBy(ObjectListRowSchema, { type: "add_to_set", path: "rows", items, unique_by: "deep_equals", where: { id: "a" } }, [{ id: "a", rows: [] }]);

            items[0]!.rid = "changed after the write";

            expect(stored[0]?.rows).toStrictEqual([{ rid: "r1" }]);
        });
    });
});
