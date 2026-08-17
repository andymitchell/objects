import { z } from "zod";
import {
  UpdatingMethodSchema,
  WhereFilterSchema,
} from "../where-filter/schemas.ts";
import { isTypeEqual } from "@andyrmitchell/utils";
import type {
  WriteAction,
  WriteError,
  WriteErrorContext,
  WriteAffectedItem,
  WriteOutcomeOk,
  WriteOutcomeFailed,
  WriteOutcome,
  WriteOutcomeOkCore,
  WriteOutcomeFailedCore,
  WriteOutcomeCore,
  WriteResult,
  WritePayloadArrayScope,
  WritePayloadUpdate,
  WritePayload,
} from "./types.ts";
import { resolveArrayScope } from "./arrayScopeResolution.ts";
import { resolvePropertyPathTarget } from "./propertyPathResolution.ts";
import { findUnwritableDataValues } from "./validateWritePayload.ts";
import { PrimaryKeyValueSchema } from "../utils/getKeyValue.ts";
import { JsonValueSchema } from "@andymitchell/clone-to-json-safe";

/**
 * Build a schema that checks a whole write action against the shape of the items it writes.
 *
 * A write action is one instruction — create this item, update everything matching this filter, push these
 * elements onto that array — expressed as a JSON document so it can be queued, logged, sent over a wire and
 * replayed later. Parsing one answers a single question: would the write engine accept this instruction? The
 * envelope and the verb's own grammar are checked, and the verbs that carry item data have that data checked
 * against `objectSchema`.
 *
 * Parsing judges and never rewrites. An accepted action carries its item data exactly as it was written: a
 * default, prefault, coercion, catch or transform in the row schema is something the data is measured against,
 * never something applied to it. That is what makes the answer worth trusting — the write engine stores the
 * values submitted to it, so a gate answering for a rewritten version would be answering about a different
 * write.
 *
 * @param objectSchema The shape of a stored item. Omit it when no shape is known: the action's grammar and the
 * JSON-safety of what it writes are still checked, item data is measured against nothing, and a `path` naming a
 * property is left for the engine to judge. An `array_scope` resolves its scope against the shape, so it cannot
 * be accepted without one.
 * @returns A schema whose parse output is the action, typed as `WriteAction<T>`.
 *
 * @example
 * ```ts
 * const Row = z.object({ id: z.string(), title: z.string(), views: z.number().default(0) });
 * const schema = makeWriteActionSchema<z.input<typeof Row>>(Row);
 *
 * const parsed = schema.parse(incoming);
 * // A create of `{ id: 'a', title: 'Hi' }` is accepted and carries exactly that — no `views: 0` is added,
 * // and the stored item has no `views` either.
 * ```
 *
 * @remarks
 * Instantiate `T` with `z.input<typeof rowSchema>` whenever the row schema substitutes or respells values
 * (`.default()`, `.prefault()`, `z.coerce`, `.catch()`, `.transform()`). The input type is what a caller may
 * write, and therefore what an accepted action carries.
 *
 * Values a write action cannot carry are refused however tolerantly the row schema treats them: an explicit
 * `undefined`, a non-finite number, or anything with no JSON form, at any depth of the data. The write engine
 * refuses the same values for the same reason, so neither can admit a write the other would turn away.
 *
 * The as-written guarantee is about item data — a create's or update's `data`, including the nested action of
 * an `array_scope`. The rest of a payload is rebuilt by its own schema: unrecognised keys are dropped, and a
 * `where` clause comes back meaning the same thing without necessarily holding its keys in the same order.
 */
export function makeWriteActionSchema<
  T extends Record<string, any> = Record<string, any>,
>(objectSchema?: z.ZodObject<any>): z.ZodType<WriteAction<T>> {
  return makeWriteActionAndPayloadSchema(objectSchema).writeAction;
}
/**
 * Build a schema for a write action's payload — the instruction on its own, without the envelope that carries
 * it.
 *
 * A write action wraps its payload alongside a uuid and a timestamp, so that a queue can identify and order it.
 * Anything holding a payload without that envelope validates it with this: the nested action of an
 * `array_scope`, or a caller composing the envelope at the point of dispatch.
 *
 * Parsing judges and never rewrites, exactly as it does for a whole action: item data is carried as written.
 *
 * @param objectSchema The shape of a stored item. Omit it when no shape is known: the payload's grammar and the
 * JSON-safety of what it writes are still checked, item data is measured against nothing, and a `path` naming a
 * property is left for the engine to judge. An `array_scope` resolves its scope against the shape, so it cannot
 * be accepted without one.
 * @returns A schema for one payload — a union with an arm per write verb, distinguished by `type`.
 *
 * @see {@link makeWriteActionSchema} for the parse contract in full, and for how to type a row schema that
 * substitutes values.
 */
export function makeWritePayloadSchema(objectSchema?: z.ZodObject<any>) {
  return makeWriteActionAndPayloadSchema(objectSchema).payload;
}

/** Rejection wording for the two data-carrying verbs, naming the JSON-safe way to say what was intended. */
const UNDEFINED_DATA_MESSAGE = {
  create: "A create defines the whole item, so omit the key rather than giving it the value undefined",
  update:
    "Clearing or removing a property is 'set_property_undefined' / 'delete_property'; an update cannot carry the value undefined",
} as const;

/**
 * Rejection wording for a value that cannot cross a JSON boundary, one per fault the write engine reports. The
 * value itself is never quoted — an error may be logged, and the path already locates it.
 */
const UNWRITABLE_VALUE_MESSAGE = {
  non_finite: "A written value must survive a JSON round trip, and a non-finite number does not",
  malformed: "A written value must survive a JSON round trip, and this value has no JSON form",
} as const;

/**
 * Judge written data against a row schema without letting the schema rewrite it.
 *
 * A row schema is a yardstick here, not a renderer. Measured normally it would hand back its own rendering of
 * the data — a default in place of an omitted key, a coerced number in place of the string that was written, an
 * exhaustively-keyed record in place of the two keys the caller supplied — and every one of those is a value
 * attributed to a caller who never wrote it. The write engine walks and stores the submitted values, so a gate
 * that answered for the rendering would be answering about a different write.
 *
 * The values a write action may carry are narrower than the values a row schema may declare, and that question
 * is settled on the raw data first: an explicit `undefined`, a non-finite number, or a value with no JSON form
 * is refused however tolerantly the row schema treats it, because the engine refuses it too.
 *
 * @param dataSchema The row schema the data must satisfy.
 * @param message Rejection wording naming this verb's JSON-safe alternative to an explicit `undefined`.
 * @returns A schema that refuses values a write action cannot carry, requires `dataSchema` to accept the raw
 * value, and carries that raw value through unchanged.
 *
 * @remarks
 * The row schema's own issues are reported as its own, and abort the surrounding union arm exactly as a directly
 * applied schema would, so a caller reading `error.issues` sees the same shape either way. An unwritable value
 * suppresses them: no purpose is served by explaining a shape whose values cannot be written at all.
 *
 * What an accepted parse hands back is the caller's own object, by reference, rather than a copy of it.
 *
 * A row schema holding an asynchronous check answers only under `parseAsync`, as such a schema does anywhere in
 * Zod — a synchronous parse of an action guarded by one throws.
 */
function validatedAsWritten<S extends z.ZodType>(dataSchema: S, message: string) {
  return z.custom<z.output<S>>().superRefine((raw, ctx) => {
    const unwritable = findUnwritableDataValues(raw);
    if (unwritable.some((issue) => issue.undefined_value)) {
      // One answer for the whole write: the remedy is the same wherever in `data` the undefined was written.
      ctx.addIssue({ code: "custom", message });
      return;
    }
    if (unwritable.length > 0) {
      for (const issue of unwritable) {
        ctx.addIssue({
          code: "custom",
          message: UNWRITABLE_VALUE_MESSAGE[issue.reason],
          path: issue.path ? issue.path.split(".") : [],
        });
      }
      return;
    }
    const report = (error: z.ZodError) => {
      for (const issue of error.issues) ctx.addIssue({ ...issue, continue: false });
    };
    try {
      const result = dataSchema.safeParse(raw);
      if (!result.success) report(result.error);
    } catch (e) {
      // A row schema with an asynchronous check cannot answer here. Returning its promise hands the wait back
      // to Zod, which awaits it under `parseAsync` and refuses a synchronous parse — the rule any asynchronous
      // schema follows.
      if (!(e instanceof z.core.$ZodAsyncError)) throw e;
      return dataSchema.safeParseAsync(raw).then((result) => {
        if (!result.success) report(result.error);
      });
    }
  });
}

function makeWriteActionAndPayloadSchema(objectSchema?: z.ZodObject<any>) {
  const schema: z.ZodTypeAny = objectSchema ?? z.record(z.string(), z.any());
  const WritePayloadCreateSchema = z.object({
    type: z.literal("create"),
    data: validatedAsWritten(
      objectSchema ? objectSchema.strict() : schema,
      UNDEFINED_DATA_MESSAGE.create,
    ),
  });

  const WritePayloadUpdateSchema = z.object({
    type: z.literal("update"),
    data: validatedAsWritten(
      objectSchema ? objectSchema.partial().strict() : schema,
      UNDEFINED_DATA_MESSAGE.update,
    ),
    where: WhereFilterSchema,
    method: UpdatingMethodSchema.optional(),
  });
  isTypeEqual<
    z.infer<typeof WritePayloadUpdateSchema>["where"],
    WritePayloadUpdate<any>["where"]
  >(true);
  isTypeEqual<
    z.infer<typeof WritePayloadUpdateSchema>["method"],
    WritePayloadUpdate<any>["method"]
  >(true);

  const WritePayloadArrayCreateSchema = z
    .object({
      type: z.literal("array_scope"),
      scope: z.string(),
      action: z.record(z.string(), z.any()), // This gets tighter control in the .refine below
      where: WhereFilterSchema,
    })
    .refine(
      (data) => {
        const result = checkArrayScopeAction(
          schema,
          data as WritePayloadArrayScope<any>,
        );
        return result;
      },
      {
        message: "Value does not match the schema at the specified path",
        path: ["value"],
      },
    );

  const WritePayloadDeleteSchema = z.object({
    type: z.literal("delete"),
    where: WhereFilterSchema,
  });

  const WritePayloadAddToSetSchema = z.object({
    type: z.literal("add_to_set"),
    path: z.string(),
    items: z.array(z.any()),
    unique_by: z.enum(["deep_equals", "pk"]),
    where: WhereFilterSchema,
  });

  const WritePayloadPushSchema = z.object({
    type: z.literal("push"),
    path: z.string(),
    items: z.array(z.any()),
    where: WhereFilterSchema,
  });

  const WritePayloadPullSchema = z.object({
    type: z.literal("pull"),
    path: z.string(),
    items_where: z.union([WhereFilterSchema, z.array(z.any())]),
    where: WhereFilterSchema,
  });

  const WritePayloadIncSchema = z.object({
    type: z.literal("inc"),
    path: z.string(),
    amount: z.number(),
    where: WhereFilterSchema,
  });

  // Single-sourced with the write engine's preflight (resolvePropertyPathTarget), so the parse gate admits
  // exactly the properties the engine will write through — no gate/engine drift. Without an `objectSchema`
  // there is nothing to resolve against, so the path is left to the engine to judge.
  const WritePayloadSetPropertyUndefinedSchema = z
    .object({
      type: z.literal("set_property_undefined"),
      path: z.string(),
      where: WhereFilterSchema,
    })
    .refine(
      (data) =>
        !objectSchema ||
        resolvePropertyPathTarget(schema, data.path, "set_property_undefined").ok,
      {
        message: "Path is not a property this schema allows to hold undefined",
        path: ["path"],
      },
    );

  const WritePayloadDeletePropertySchema = z
    .object({
      type: z.literal("delete_property"),
      path: z.string(),
      where: WhereFilterSchema,
    })
    .refine(
      (data) =>
        !objectSchema ||
        resolvePropertyPathTarget(schema, data.path, "delete_property").ok,
      {
        message: "Path is not a property this schema allows to be absent",
        path: ["path"],
      },
    );

  const WritePayloadSchema = z.union([
    WritePayloadCreateSchema,
    WritePayloadUpdateSchema,
    WritePayloadDeleteSchema,
    WritePayloadArrayCreateSchema,
    WritePayloadAddToSetSchema,
    WritePayloadPushSchema,
    WritePayloadPullSchema,
    WritePayloadIncSchema,
    WritePayloadSetPropertyUndefinedSchema,
    WritePayloadDeletePropertySchema,
  ]);

  const WriteActionSchema = z.object({
    type: z.literal("write"),
    ts: z.number(),
    uuid: z.string(),
    payload: WritePayloadSchema,
  }) as z.ZodType<WriteAction<any>>;

  return { writeAction: WriteActionSchema, payload: WritePayloadSchema };
}

export const WriteActionSchema = makeWriteActionSchema<any>();
isTypeEqual<z.infer<typeof WriteActionSchema>, WriteAction<any>>(true);

// The assertion above passes by construction — `makeWriteActionSchema` casts its return to
// `z.ZodType<WriteAction<any>>`. The payload factory does not cast, so its inferred type can be held to the
// declared union for real. Whole-union equality is unattainable by design: `update.data`, `array_scope.action`
// and `pull.items_where` are declared with path-derived and recursive types that the payload schema
// deliberately types loosely, then narrows in a `.refine`. The discriminant set is the part that must match
// exactly — it is what fails when a variant gains a schema but no type, or a type but no schema.
type InferredPayload = z.infer<ReturnType<typeof makeWritePayloadSchema>>;
isTypeEqual<InferredPayload["type"], WritePayload<any>["type"]>(true);

// The property-targeting arms carry no loosely-typed field, so they are held to full structural equality.
isTypeEqual<
  Extract<InferredPayload, { type: "set_property_undefined" }>,
  Extract<WritePayload<any>, { type: "set_property_undefined" }>
>(true);
isTypeEqual<
  Extract<InferredPayload, { type: "delete_property" }>,
  Extract<WritePayload<any>, { type: "delete_property" }>
>(true);

function checkArrayScopeAction(
  schema: z.ZodTypeAny,
  data: WritePayloadArrayScope<any>,
): boolean {
  // Single-sourced with the write engine's preflight (resolveArrayScope), so the parse gate admits
  // exactly the scopes the engine will write through — no gate/engine drift.
  const resolution = resolveArrayScope(schema, data.scope);
  if (!resolution.ok) {
    return false;
  }
  const subActionSchema = makeWriteActionAndPayloadSchema(resolution.elementSchema);
  const result = subActionSchema.payload.safeParse(data.action).success;
  return result;
}

// ─── WriteError (renamed from WriteCommonError) ───

export const WriteErrorSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("custom"),
      message: z.string().optional(),
    })
    .loose(),
  z.object({
    type: z.literal("schema"),
    issues: z.array(z.any()) as z.ZodType<z.ZodIssue[]>,
    serialised_schema: JsonValueSchema.optional(),
  }),
  z.object({
    type: z.literal("missing_key"),
    primary_key: z.union([z.string(), z.number(), z.symbol()]),
  }),
  z.object({
    type: z.literal("create_duplicated_key"),
    primary_key: z.union([z.string(), z.number(), z.symbol()]),
  }),
  z.object({
    type: z.literal("update_altered_key"),
    primary_key: z.union([z.string(), z.number(), z.symbol()]),
  }),
  z.object({
    type: z.literal("uuid_conflict"),
    uuid: z.string(),
  }),
  z.object({
    type: z.literal("invalid_filter"),
    where_path: z.string().optional(),
    reason: z.enum(["unknown_field", "type_mismatch", "non_finite", "malformed"]),
  }),
  z.object({
    type: z.literal("invalid_scope"),
    scope: z.string(),
    reason: z.enum(["disallowed_segment", "unknown_path", "not_an_object_array"]),
  }),
  z.object({
    type: z.literal("invalid_data_value"),
    data_path: z.string().optional(),
    reason: z.enum(["non_finite", "malformed"]),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal("invalid_property_path"),
    path: z.string(),
    reason: z.enum([
      "disallowed_segment",
      "unknown_path",
      "traverses_array",
      "object_array_property",
      "not_undefinable",
      "not_optional",
      "primary_key",
    ]),
  }),
  z.object({
    type: z.literal("blocked"),
    blocked_by_action_uuid: z.string(),
  }),
]);
isTypeEqual<z.infer<typeof WriteErrorSchema>, WriteError>(true);

// ─── WriteErrorContext ───

export function makeWriteErrorContextSchema() {
  return WriteErrorSchema.and(
    z.object({
      item_pk: PrimaryKeyValueSchema.optional(),
    }),
  ) as z.ZodType<WriteErrorContext>;
}

// ─── WriteAffectedItem ───

export const WriteAffectedItemSchema = z.object({
  item_pk: PrimaryKeyValueSchema,
  item: z.any().optional(),
});
isTypeEqual<z.infer<typeof WriteAffectedItemSchema>, WriteAffectedItem<any>>(
  true,
);

// ─── WriteOutcome*Core (per-action atoms, no `affected_items`) ───

export function makeWriteOutcomeOkCoreSchema<
  T extends Record<string, any> = Record<string, any>,
>() {
  return z.object({
    ok: z.literal(true),
    action_uuid: z.string(),
  });
}
export const WriteOutcomeOkCoreSchema = makeWriteOutcomeOkCoreSchema<any>();
isTypeEqual<z.infer<typeof WriteOutcomeOkCoreSchema>, WriteOutcomeOkCore<any>>(
  true,
);

export function makeWriteOutcomeFailedCoreSchema<
  T extends Record<string, any> = Record<string, any>,
>() {
  return z.object({
    ok: z.literal(false),
    action_uuid: z.string(),
    // `errors` is a non-empty tuple `[WriteErrorContext, ...WriteErrorContext[]]`. `z.tuple([x], x)`
    // expresses that in the inferred type natively; v4's `.nonempty()` only enforces ≥1 at runtime
    // (it infers a plain `T[]`, dropping the compile-time guarantee). To relax later, switch to
    // `z.array(makeWriteErrorContextSchema()).nonempty()` → `WriteErrorContext[]` (then `errors[0]`
    // becomes possibly-undefined under noUncheckedIndexedAccess).
    errors: z.tuple([makeWriteErrorContextSchema()], makeWriteErrorContextSchema()),
    unrecoverable: z.boolean().optional(),
    back_off_until_ts: z.number().optional(),
    blocked_by_action_uuid: z.string().optional(),
  });
}
export const WriteOutcomeFailedCoreSchema =
  makeWriteOutcomeFailedCoreSchema<any>();
isTypeEqual<
  z.infer<typeof WriteOutcomeFailedCoreSchema>,
  WriteOutcomeFailedCore<any>
>(true);

export function makeWriteOutcomeCoreSchema<
  T extends Record<string, any> = Record<string, any>,
>() {
  return z.discriminatedUnion("ok", [
    makeWriteOutcomeOkCoreSchema<T>(),
    makeWriteOutcomeFailedCoreSchema<T>(),
  ]);
}
export const WriteOutcomeCoreSchema = makeWriteOutcomeCoreSchema<any>();
isTypeEqual<z.infer<typeof WriteOutcomeCoreSchema>, WriteOutcomeCore<any>>(
  true,
);

// ─── WriteOutcome (Core + `affected_items`; discriminated union on `ok`) ───

export function makeWriteOutcomeOkSchema<
  T extends Record<string, any> = Record<string, any>,
>() {
  return makeWriteOutcomeOkCoreSchema<T>().extend({
    affected_items: z
      .array(WriteAffectedItemSchema as z.ZodType<WriteAffectedItem<T>>)
      .optional(),
  });
}
export const WriteOutcomeOkSchema = makeWriteOutcomeOkSchema<any>();
isTypeEqual<z.infer<typeof WriteOutcomeOkSchema>, WriteOutcomeOk<any>>(true);

export function makeWriteOutcomeFailedSchema<
  T extends Record<string, any> = Record<string, any>,
>() {
  return makeWriteOutcomeFailedCoreSchema<T>().extend({
    affected_items: z
      .array(WriteAffectedItemSchema as z.ZodType<WriteAffectedItem<T>>)
      .optional(),
    tested_item: (z.any() as z.ZodType<T | undefined>).optional(),
  });
}
export const WriteOutcomeFailedSchema = makeWriteOutcomeFailedSchema<any>();
isTypeEqual<z.infer<typeof WriteOutcomeFailedSchema>, WriteOutcomeFailed<any>>(
  true,
);

export function makeWriteOutcomeSchema<
  T extends Record<string, any> = Record<string, any>,
>() {
  return z.discriminatedUnion("ok", [
    makeWriteOutcomeOkSchema<T>(),
    makeWriteOutcomeFailedSchema<T>(),
  ]);
}
export const WriteOutcomeSchema = makeWriteOutcomeSchema<any>();
isTypeEqual<z.infer<typeof WriteOutcomeSchema>, WriteOutcome<any>>(true);

// ─── WriteResult ───

export function makeWriteResultSchema<
  T extends Record<string, any> = Record<string, any>,
>() {
  return z.object({
    ok: z.boolean(),
    actions: z.array(makeWriteOutcomeSchema<T>()),
    error: z.object({ message: z.string() }).optional(),
  });
}
export const WriteResultSchema = makeWriteResultSchema<any>();
isTypeEqual<z.infer<typeof WriteResultSchema>, WriteResult<any>>(true);
