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
import { findNonJsonValues, type NonJsonValueIssue } from "../utils/findNonJsonValues.ts";
import { PrimaryKeyValueSchema } from "../utils/getKeyValue.ts";
import { JsonValueSchema } from "@andymitchell/clone-to-json-safe";

export function makeWriteActionSchema<
  T extends Record<string, any> = Record<string, any>,
>(objectSchema?: z.ZodObject<any>): z.ZodType<WriteAction<T>> {
  return makeWriteActionAndPayloadSchema(objectSchema).writeAction;
}
export function makeWritePayloadSchema(objectSchema?: z.ZodObject<any>) {
  return makeWriteActionAndPayloadSchema(objectSchema).payload;
}

/**
 * Whether `data` holds an explicit `undefined` at any depth. Row schemas cannot answer this — an optional or
 * `.any()` field parses `undefined` happily — so the two data-carrying verbs are guarded with it, and the parse
 * gate then admits exactly what the write engine will accept. Single-sourced with the engine's value walk.
 */
function holdsExplicitUndefined(data: unknown): boolean {
  const issues: NonJsonValueIssue[] = [];
  findNonJsonValues(data, "", issues, { flagUndefined: true });
  return issues.some((issue) => issue.undefined_value);
}

/** Rejection wording for the two data-carrying verbs, naming the JSON-safe way to say what was intended. */
const UNDEFINED_DATA_MESSAGE = {
  create: "A create defines the whole item, so omit the key rather than giving it the value undefined",
  update:
    "Clearing or removing a property is 'set_property_undefined' / 'delete_property'; an update cannot carry the value undefined",
} as const;

/**
 * Guard a row schema so the written data is judged as the caller wrote it, then validated as usual.
 *
 * A row schema renders `data` before anything downstream sees it: a default replaces an explicit `undefined`
 * with a value the write language forbids asking for, and an exhaustively-keyed record invents present-undefined
 * keys the caller never wrote. Reading the raw input settles both, and matches what the write engine — which
 * walks the submitted values — will accept.
 *
 * @param dataSchema The row schema the data must satisfy.
 * @param message Rejection wording naming this verb's JSON-safe alternative.
 * @returns A schema that refuses an explicit `undefined` at any depth of the input, and otherwise parses as
 * `dataSchema` does.
 */
function withoutExplicitUndefined<S extends z.ZodType>(dataSchema: S, message: string) {
  return z
    .unknown()
    .superRefine((raw, ctx) => {
      if (holdsExplicitUndefined(raw)) ctx.addIssue({ code: "custom", message });
    })
    .pipe(dataSchema);
}

function makeWriteActionAndPayloadSchema(objectSchema?: z.ZodObject<any>) {
  const schema: z.ZodTypeAny = objectSchema ?? z.record(z.string(), z.any());
  const WritePayloadCreateSchema = z.object({
    type: z.literal("create"),
    data: withoutExplicitUndefined(
      objectSchema ? objectSchema.strict() : schema,
      UNDEFINED_DATA_MESSAGE.create,
    ),
  });

  const WritePayloadUpdateSchema = z.object({
    type: z.literal("update"),
    data: withoutExplicitUndefined(
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
