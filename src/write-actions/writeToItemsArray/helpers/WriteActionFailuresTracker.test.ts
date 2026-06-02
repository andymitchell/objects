import { z } from "zod";
import { expectTypeOf } from "vitest";
import WriteActionFailuresTracker from "./WriteActionFailuresTracker.ts";
import { TreeNodeSchema } from "../../../dot-prop-paths/zod.ts";
import type {
  WriteAction,
  WriteError,
  WriteOutcomeFailed,
} from "../../types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

// The workhorse schema for behaviour tests. `name` carries a runtime-only
// constraint, so an item can be type-valid yet fail validation.
const FlatSchema = z.object({ id: z.string(), name: z.string().min(3) }).strict();
type FlatItem = z.infer<typeof FlatSchema>;

const validFlat: FlatItem = { id: "1", name: "first task" };
const invalidFlat: FlatItem = { id: "2", name: "no" };
// An item whose primary key resolves to '' (falsy) — it cannot be matched.
const noPkItem: FlatItem = { id: "", name: "no" };

// Schemas exercised only through serialised_schema; each is fed a failing item.
const NestedSchema = z
  .object({ id: z.string(), profile: z.object({ age: z.number().min(0) }) })
  .strict();
type NestedItem = z.infer<typeof NestedSchema>;
const invalidNested: NestedItem = { id: "n1", profile: { age: -1 } };

const RichSchema = z
  .object({
    id: z.string(),
    tags: z.array(z.string().min(1)),
    note: z.string().optional(),
    score: z.number().nullable(),
    flag: z.boolean().default(false),
  })
  .strict();
type RichItem = z.infer<typeof RichSchema>;
const invalidRich: RichItem = { id: "r1", tags: [""], score: null, flag: false };

type LazyItem = { id: string; child?: LazyItem };
const LazySchema: z.ZodType<LazyItem> = z.lazy(() =>
  z.object({ id: z.string().min(3), child: LazySchema.optional() }),
);
const invalidLazy: LazyItem = { id: "no" };

const DiscriminatedSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("a"), id: z.string().min(3) }),
  z.object({ kind: z.literal("b"), id: z.string().min(3) }),
]);
type DiscriminatedItem = z.infer<typeof DiscriminatedSchema>;
const invalidDiscriminated: DiscriminatedItem = { kind: "a", id: "no" };

const ExoticSchema = z
  .object({
    id: z.string().min(3),
    bag: z.set(z.string()),
    lookup: z.record(z.string(), z.number()),
  })
  .strict();
type ExoticItem = z.infer<typeof ExoticSchema>;
const invalidExotic: ExoticItem = { id: "no", bag: new Set(), lookup: {} };

// F1: a top-level union of objects sharing a common `id` key.
const TopUnionSchema = z.union([
  z.object({ id: z.string(), a: z.string().min(3) }),
  z.object({ id: z.string(), b: z.string().min(3) }),
]);
type TopUnionItem = z.infer<typeof TopUnionSchema>;
const invalidTopUnion: TopUnionItem = { id: "u1", a: "no" };

// F2: a union nested under an object key.
const NestedUnionSchema = z.object({
  id: z.string(),
  k: z.union([z.object({ a: z.string().min(3) }), z.object({ a: z.number() })]),
});
type NestedUnionItem = z.infer<typeof NestedUnionSchema>;
const invalidNestedUnion: NestedUnionItem = { id: "nu1", k: { a: "no" } };

// A refined object schema that always rejects. In v4 `.refine()` returns the object itself, so the walker descends into its fields.
const RefinedSchema = z
  .object({ id: z.string() })
  .strict()
  .refine(() => false, "always rejected");
type RefinedItem = z.infer<typeof RefinedSchema>;
const refinedItem: RefinedItem = { id: "1" };

/** A minimal create action carrying `data`. */
function makeAction<T extends Record<string, any>>(
  data: T,
  uuid = "action-1",
): WriteAction<T> {
  return { type: "write", ts: 0, uuid, payload: { type: "create", data } };
}

/**
 * The first failure's schema error, narrowed. Throws if no schema error was
 * recorded, so callers can rely on the narrowed shape.
 */
function schemaErrorOf<T extends Record<string, any>>(
  tracker: WriteActionFailuresTracker<T>,
) {
  const error = tracker.get()[0]?.errors.find((e) => e.type === "schema");
  if (!error || error.type !== "schema") {
    throw new Error("expected a schema error on the first recorded failure");
  }
  return error;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("raising the halt signal", () => {
  test("a tracker with no failures signals it is safe to continue", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    expect(tracker.shouldHalt()).toBe(false);
  });

  test("a single recorded failure raises the halt signal", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    tracker.report(makeAction(validFlat), validFlat, {
      type: "custom",
      message: "boom",
    });
    expect(tracker.shouldHalt()).toBe(true);
  });

  test("the halt signal stays raised once any action has failed", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    tracker.report(makeAction(validFlat, "a1"), validFlat, {
      type: "custom",
    });
    tracker.report(makeAction(validFlat, "a2"), validFlat, {
      type: "custom",
    });
    expect(tracker.shouldHalt()).toBe(true);
  });

  test("the halt signal always agrees with whether failures are on record", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    expect(tracker.shouldHalt()).toBe(tracker.length() > 0);
    tracker.report(makeAction(validFlat), validFlat, { type: "custom" });
    expect(tracker.shouldHalt()).toBe(tracker.length() > 0);
  });
});

describe("gating writes on schema validity", () => {
  test("an item that satisfies the schema passes and records nothing", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    expect(tracker.testSchema(makeAction(validFlat), validFlat)).toBe(true);
    expect(tracker.length()).toBe(0);
  });

  test("an item that violates the schema fails and is recorded once", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    expect(tracker.testSchema(makeAction(invalidFlat), invalidFlat)).toBe(false);
    expect(tracker.length()).toBe(1);
    expect(tracker.get()[0]!.errors.length).toBe(1);
    expect(tracker.get()[0]!.errors[0]!.type).toBe("schema");
  });

  test("the offending item is recorded verbatim alongside the error", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    tracker.testSchema(makeAction(invalidFlat), invalidFlat);
    expect(schemaErrorOf(tracker).tested_item).toEqual(invalidFlat);
  });

  test("the Zod issues are carried through and point at the offending field", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    tracker.testSchema(makeAction(invalidFlat), invalidFlat);
    const issues = schemaErrorOf(tracker).issues;
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.path.includes("name"))).toBe(true);
  });

  test("a schema violation marks the action as permanently unrecoverable", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    tracker.testSchema(makeAction(invalidFlat), invalidFlat);
    expect(tracker.get()[0]!.unrecoverable).toBe(true);
  });

  test("re-checking the same failing item leaves a single record", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const action = makeAction(invalidFlat);
    tracker.testSchema(action, invalidFlat);
    tracker.testSchema(action, invalidFlat);
    expect(tracker.length()).toBe(1);
    expect(tracker.get()[0]!.affected_items?.length).toBe(1);
    expect(tracker.get()[0]!.errors.length).toBe(1);
  });

  test("a failing item with no usable primary key de-duplicates by its content", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const action = makeAction(noPkItem);
    tracker.testSchema(action, noPkItem);
    tracker.testSchema(action, noPkItem);
    const failure = tracker.get()[0]!;
    // With no usable primary key the item is matched by deep value equality, so
    // re-checking the same item collapses onto one affected-item record.
    expect(failure.affected_items?.length).toBe(1);
    expect(failure.errors.length).toBe(1);
  });

  test("two distinct items that both lack a usable primary key stay separate", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const action = makeAction(noPkItem);
    tracker.testSchema(action, { id: "", name: "no" });
    tracker.testSchema(action, { id: "", name: "xy" });
    // Different content, so value-equality keeps them as separate affected items.
    expect(tracker.get()[0]!.affected_items?.length).toBe(2);
  });

  test("two distinct failing items under one action collect in a single record", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const action = makeAction(invalidFlat);
    tracker.testSchema(action, { id: "i1", name: "no" });
    tracker.testSchema(action, { id: "i2", name: "no" });
    expect(tracker.length()).toBe(1);
    expect(tracker.get()[0]!.affected_items?.length).toBe(2);
  });

  test("failing items under different actions produce separate records", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    tracker.testSchema(makeAction(invalidFlat, "a1"), invalidFlat);
    tracker.testSchema(makeAction(invalidFlat, "a2"), invalidFlat);
    expect(tracker.length()).toBe(2);
  });
});

describe("accumulating and de-duplicating errors", () => {
  test("reporting an error against a new action creates one failure holding it", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    tracker.report(makeAction(validFlat), validFlat, {
      type: "custom",
      message: "boom",
    });
    expect(tracker.length()).toBe(1);
    const error = tracker.get()[0]!.errors[0]!;
    expect(error.type).toBe("custom");
    if (error.type === "custom") expect(error.message).toBe("boom");
  });

  test("reporting the identical error twice keeps a single error", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const action = makeAction(validFlat);
    tracker.report(action, validFlat, { type: "custom", message: "same" });
    tracker.report(action, validFlat, { type: "custom", message: "same" });
    expect(tracker.get()[0]!.errors.length).toBe(1);
  });

  test("an equivalent error supplied as a separate object is still de-duplicated", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const action = makeAction(validFlat);
    const first: WriteError = { type: "missing_key", primary_key: "id" };
    const second: WriteError = { type: "missing_key", primary_key: "id" };
    tracker.report(action, validFlat, first);
    tracker.report(action, validFlat, second);
    expect(tracker.get()[0]!.errors.length).toBe(1);
  });

  test("two genuinely different errors for one item are both kept", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const action = makeAction(validFlat);
    tracker.report(action, validFlat, { type: "custom", message: "first" });
    tracker.report(action, validFlat, { type: "custom", message: "second" });
    expect(tracker.get()[0]!.errors.length).toBe(2);
  });

  const unrecoverableErrors: WriteError[] = [
    { type: "schema", issues: [] },
    { type: "missing_key", primary_key: "id" },
    { type: "create_duplicated_key", primary_key: "id" },
    { type: "update_altered_key", primary_key: "id" },
    { type: "permission_denied", reason: "not-owner" },
  ];

  test.each(unrecoverableErrors)(
    'an error of type "$type" marks the action as unrecoverable',
    (errorDetails) => {
      const tracker = new WriteActionFailuresTracker(FlatSchema, {
        primary_key: "id",
      });
      tracker.report(makeAction(validFlat), validFlat, errorDetails);
      expect(tracker.get()[0]!.unrecoverable).toBe(true);
    },
  );

  test("a custom error leaves the action recoverable", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    tracker.report(makeAction(validFlat), validFlat, {
      type: "custom",
      message: "soft",
    });
    expect(tracker.get()[0]!.unrecoverable).toBeUndefined();
  });

  test("an unrecoverable error keeps the action unrecoverable when a soft error follows", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const action = makeAction(validFlat);
    tracker.report(action, validFlat, { type: "schema", issues: [] });
    tracker.report(action, validFlat, { type: "custom", message: "soft" });
    expect(tracker.get()[0]!.unrecoverable).toBe(true);
  });

  test("a soft error followed by an unrecoverable one ends up unrecoverable", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const action = makeAction(validFlat);
    tracker.report(action, validFlat, { type: "custom", message: "soft" });
    tracker.report(action, validFlat, { type: "schema", issues: [] });
    expect(tracker.get()[0]!.unrecoverable).toBe(true);
  });

  test("a reported error is tagged with the item's primary key", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const item: FlatItem = { id: "item-7", name: "abc" };
    tracker.report(makeAction(item), item, { type: "custom", message: "x" });
    expect(tracker.get()[0]!.errors[0]!.item_pk).toBe("item-7");
  });
});

describe("blocking an action behind an earlier failure", () => {
  test("blocking a not-yet-failed action records it with a blocked error", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    tracker.blocked(makeAction(validFlat), "blocker-uuid");
    expect(tracker.length()).toBe(1);
    const failure = tracker.get()[0]!;
    expect(failure.blocked_by_action_uuid).toBe("blocker-uuid");
    // A blocked-only action has no error of its own, so it carries a single `blocked`
    // error naming the blocker — the failure record is never error-less.
    expect(failure.errors.length).toBe(1);
    const error = failure.errors[0]!;
    expect(error.type).toBe("blocked");
    if (error.type === "blocked") {
      expect(error.blocked_by_action_uuid).toBe("blocker-uuid");
    }
    // A blocked action can run once the blocker is resolved, so it stays recoverable.
    expect(failure.unrecoverable).toBeUndefined();
  });

  test("blocking an action that already failed adds a blocked error alongside its own", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const action = makeAction(validFlat);
    tracker.report(action, validFlat, { type: "custom", message: "earlier" });
    tracker.blocked(action, "blocker-uuid");
    expect(tracker.length()).toBe(1);
    const failure = tracker.get()[0]!;
    expect(failure.blocked_by_action_uuid).toBe("blocker-uuid");
    // The action's own error is kept; the blocked error joins it.
    expect(failure.errors.length).toBe(2);
    expect(failure.errors.some((e) => e.type === "custom")).toBe(true);
    expect(failure.errors.some((e) => e.type === "blocked")).toBe(true);
  });

  test("re-blocking the same action keeps one blocked error at the latest blocker", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const action = makeAction(validFlat);
    tracker.blocked(action, "first-blocker");
    tracker.blocked(action, "second-blocker");
    const failure = tracker.get()[0]!;
    expect(failure.blocked_by_action_uuid).toBe("second-blocker");
    // Re-blocking updates the existing blocked error in place rather than appending a second.
    expect(failure.errors.length).toBe(1);
    const error = failure.errors[0]!;
    expect(error.type).toBe("blocked");
    if (error.type === "blocked") {
      expect(error.blocked_by_action_uuid).toBe("second-blocker");
    }
  });

  test("a blocked action raises the halt signal", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    tracker.blocked(makeAction(validFlat), "blocker-uuid");
    expect(tracker.shouldHalt()).toBe(true);
  });
});

describe("merging sub-action failures under a parent", () => {
  const subItem: FlatItem = { id: "sub-1", name: "abc" };

  test("item-scoped sub-errors attach under the parent action", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const subAction: WriteOutcomeFailed<FlatItem> = {
      ok: false,
      action: makeAction(subItem, "sub-action"),
      errors: [
        { type: "custom", message: "sub failure", item_pk: "sub-1", item: subItem },
      ],
      affected_items: [{ item_pk: "sub-1", item: subItem }],
    };
    tracker.mergeUnderAction(makeAction(validFlat, "parent"), [subAction]);

    expect(tracker.length()).toBe(1);
    const merged = tracker.get()[0]!;
    expect(merged.errors.length).toBe(1);
    const error = merged.errors[0]!;
    if (error.type === "custom") expect(error.message).toBe("sub failure");
    expect(merged.affected_items?.[0]?.item_pk).toBe("sub-1");
  });

  test("sub-errors carrying no item context attach to each merged item", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const subAction: WriteOutcomeFailed<FlatItem> = {
      ok: false,
      action: makeAction(subItem, "sub-action"),
      errors: [{ type: "custom", message: "action-level failure" }],
      affected_items: [{ item_pk: "sub-1", item: subItem }],
    };
    tracker.mergeUnderAction(makeAction(validFlat, "parent"), [subAction]);
    const error = tracker.get()[0]!.errors[0]!;
    expect(error.type).toBe("custom");
    expect(error.item_pk).toBe("sub-1");
  });

  test("a sub-item with no item payload contributes nothing", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const subAction: WriteOutcomeFailed<FlatItem> = {
      ok: false,
      action: makeAction(subItem, "sub-action"),
      errors: [{ type: "custom", message: "orphan", item_pk: "sub-1" }],
      affected_items: [{ item_pk: "sub-1" }],
    };
    tracker.mergeUnderAction(makeAction(validFlat, "parent"), [subAction]);
    expect(tracker.length()).toBe(0);
  });

  test("a sub-action with no affected items contributes nothing", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const subAction: WriteOutcomeFailed<FlatItem> = {
      ok: false,
      action: makeAction(subItem, "sub-action"),
      errors: [{ type: "custom", message: "orphan" }],
    };
    tracker.mergeUnderAction(makeAction(validFlat, "parent"), [subAction]);
    expect(tracker.length()).toBe(0);
  });

  test("several sub-actions collect under a single parent record", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const otherItem: FlatItem = { id: "sub-2", name: "def" };
    const subActions: WriteOutcomeFailed<FlatItem>[] = [
      {
        ok: false,
        action: makeAction(subItem, "sub-a"),
        errors: [{ type: "custom", message: "a", item_pk: "sub-1", item: subItem }],
        affected_items: [{ item_pk: "sub-1", item: subItem }],
      },
      {
        ok: false,
        action: makeAction(otherItem, "sub-b"),
        errors: [{ type: "custom", message: "b", item_pk: "sub-2", item: otherItem }],
        affected_items: [{ item_pk: "sub-2", item: otherItem }],
      },
    ];
    tracker.mergeUnderAction(makeAction(validFlat, "parent"), subActions);
    expect(tracker.length()).toBe(1);
    expect(tracker.get()[0]!.affected_items?.length).toBe(2);
    expect(tracker.get()[0]!.errors.length).toBe(2);
  });

  test("merging the same sub-failures twice does not duplicate errors", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const parent = makeAction(validFlat, "parent");
    const subAction: WriteOutcomeFailed<FlatItem> = {
      ok: false,
      action: makeAction(subItem, "sub-action"),
      errors: [
        { type: "custom", message: "sub failure", item_pk: "sub-1", item: subItem },
      ],
      affected_items: [{ item_pk: "sub-1", item: subItem }],
    };
    tracker.mergeUnderAction(parent, [subAction]);
    tracker.mergeUnderAction(parent, [subAction]);
    expect(tracker.get()[0]!.errors.length).toBe(1);
  });

  test("an unrecoverable sub-error makes the parent action unrecoverable", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const subAction: WriteOutcomeFailed<FlatItem> = {
      ok: false,
      action: makeAction(subItem, "sub-action"),
      errors: [
        { type: "schema", issues: [], item_pk: "sub-1", item: subItem },
      ],
      affected_items: [{ item_pk: "sub-1", item: subItem }],
    };
    tracker.mergeUnderAction(makeAction(validFlat, "parent"), [subAction]);
    expect(tracker.get()[0]!.unrecoverable).toBe(true);
  });
});

describe("counting failed actions", () => {
  test("a fresh tracker has a count of zero", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    expect(tracker.length()).toBe(0);
  });

  test("the count reflects failed actions, not the number of errors", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const action = makeAction(validFlat);
    tracker.report(action, validFlat, { type: "custom", message: "e1" });
    tracker.report(action, validFlat, { type: "missing_key", primary_key: "id" });
    tracker.report(action, validFlat, {
      type: "permission_denied",
      reason: "not-owner",
    });
    expect(tracker.length()).toBe(1);
    expect(tracker.get()[0]!.errors.length).toBe(3);
  });

  test("each distinct failed action adds one to the count", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    tracker.report(makeAction(validFlat, "a1"), validFlat, { type: "custom" });
    tracker.report(makeAction(validFlat, "a2"), validFlat, { type: "custom" });
    tracker.report(makeAction(validFlat, "a3"), validFlat, { type: "custom" });
    expect(tracker.length()).toBe(3);
  });
});

describe("snapshotting failures through get()", () => {
  test("a fresh tracker snapshots to an empty list", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    expect(tracker.get()).toEqual([]);
  });

  test("a snapshot reproduces the recorded action and its errors", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const action = makeAction(validFlat);
    tracker.report(action, validFlat, { type: "custom", message: "boom" });
    const snapshot = tracker.get();
    expect(snapshot[0]!.action).toEqual(action);
    expect(snapshot[0]!.errors[0]!.type).toBe("custom");
  });

  test("a snapshot is a deep copy disconnected from later snapshots", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    tracker.report(makeAction(validFlat), validFlat, {
      type: "custom",
      message: "original",
    });
    const first = tracker.get();
    first[0]!.errors.push({ type: "custom", message: "injected" });
    first[0]!.action.uuid = "mutated";
    const second = tracker.get();
    expect(second[0]!.errors.length).toBe(1);
    expect(second[0]!.action.uuid).toBe("action-1");
  });

  test("repeated snapshots are structurally equal", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    tracker.report(makeAction(validFlat), validFlat, { type: "custom" });
    expect(tracker.get()).toEqual(tracker.get());
  });

  test("a snapshot holds copies, not the live action references", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    const action = makeAction(validFlat);
    tracker.report(action, validFlat, { type: "custom" });
    expect(tracker.get()[0]!.action).not.toBe(action);
    expect(tracker.get()[0]!.action).toEqual(action);
  });

  test("a snapshot omits non-JSON values such as functions in a stored item", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    tracker.report(makeAction(validFlat), validFlat, {
      type: "schema",
      issues: [],
      tested_item: { id: "1", doWork: () => "side effect" },
    });
    const error = schemaErrorOf(tracker);
    expect(error.tested_item).toEqual({ id: "1" });
  });

  test("snapshotting a failure whose stored item holds a circular reference succeeds", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    type SelfRef = FlatItem & { self?: SelfRef };
    const circular: SelfRef = { id: "1", name: "abc" };
    circular.self = circular;
    tracker.report(makeAction(validFlat), circular, {
      type: "custom",
      message: "boom",
    });
    expect(() => tracker.get()).not.toThrow();
    const error = tracker.get()[0]!.errors[0]!;
    expect(error.type).toBe("custom");
    if (error.type === "custom") expect(error.message).toBe("boom");
    // The non-circular fields of the stored item survive the snapshot.
    expect(error.item?.id).toBe("1");
    expect(error.item?.name).toBe("abc");
  });
});

describe("serialising the schema for error reports", () => {
  test("a flat object schema serialises into a defined object tree", () => {
    const tracker = new WriteActionFailuresTracker(FlatSchema, {
      primary_key: "id",
    });
    tracker.testSchema(makeAction(invalidFlat), invalidFlat);
    const tree = TreeNodeSchema.parse(schemaErrorOf(tracker).serialised_schema);
    expect(tree.kind).toBe("object");
    expect(tree.children.some((c) => c.name === "name")).toBe(true);
  });

  test("a nested object schema serialises its nested structure", () => {
    const tracker = new WriteActionFailuresTracker(NestedSchema, {
      primary_key: "id",
    });
    tracker.testSchema(makeAction(invalidNested), invalidNested);
    const tree = TreeNodeSchema.parse(schemaErrorOf(tracker).serialised_schema);
    const profile = tree.children.find((c) => c.name === "profile");
    expect(profile?.kind).toBe("object");
    expect(profile?.children.find((c) => c.name === "age")?.kind).toBe(
      "number",
    );
  });

  test("a schema with arrays, optionals, nullables and defaults serialises JSON-safely", () => {
    const tracker = new WriteActionFailuresTracker(RichSchema, {
      primary_key: "id",
    });
    tracker.testSchema(makeAction(invalidRich), invalidRich);
    const schema = schemaErrorOf(tracker).serialised_schema;
    expect(schema).toBeDefined();
    expect(() => JSON.stringify(schema)).not.toThrow();
  });

  test("a recursive lazy schema serialises without hanging or throwing", () => {
    const tracker = new WriteActionFailuresTracker(LazySchema, {
      primary_key: "id",
    });
    tracker.testSchema(makeAction(invalidLazy), invalidLazy);
    const tree = TreeNodeSchema.parse(schemaErrorOf(tracker).serialised_schema);
    expect(tree.kind).toBe("lazy");
  });

  test("exotic leaf types such as set and record serialise JSON-safely", () => {
    const tracker = new WriteActionFailuresTracker(ExoticSchema, {
      primary_key: "id",
    });
    tracker.testSchema(makeAction(invalidExotic), invalidExotic);
    const schema = schemaErrorOf(tracker).serialised_schema;
    expect(schema).toBeDefined();
    expect(() => JSON.stringify(schema)).not.toThrow();
  });

  test("a top-level union of objects serialises every variant as its own subtree", () => {
    const tracker = new WriteActionFailuresTracker(TopUnionSchema, {
      primary_key: "id",
    });
    tracker.testSchema(makeAction(invalidTopUnion), invalidTopUnion);
    const error = schemaErrorOf(tracker);
    const tree = TreeNodeSchema.parse(error.serialised_schema);

    expect(tree.kind).toBe("union");
    expect(tree.children.length).toBe(2);
    expect(tree.children.every((v) => v.kind === "object")).toBe(true);
    expect(tree.children.every((v) => v.union_variant === true)).toBe(true);
    // The union does not compromise the rest of the error.
    expect(error.issues.length).toBeGreaterThan(0);
    expect(tracker.get()[0]!.unrecoverable).toBe(true);
  });

  test("a nested union keeps each variant of the shared key distinct", () => {
    const tracker = new WriteActionFailuresTracker(NestedUnionSchema, {
      primary_key: "id",
    });
    tracker.testSchema(makeAction(invalidNestedUnion), invalidNestedUnion);
    const tree = TreeNodeSchema.parse(schemaErrorOf(tracker).serialised_schema);

    const unionNode = tree.children.find((c) => c.name === "k");
    expect(unionNode?.kind).toBe("union");
    expect(unionNode?.children.length).toBe(2);
    // Both variants of `k.a` survive with their own type — no first-wins loss.
    const variant1A = unionNode?.children[0]?.children.find(
      (c) => c.name === "a",
    );
    const variant2A = unionNode?.children[1]?.children.find(
      (c) => c.name === "a",
    );
    expect(variant1A?.kind).toBe("string");
    expect(variant2A?.kind).toBe("number");
  });

  test("the serialised schema survives a second JSON round-trip unchanged", () => {
    const tracker = new WriteActionFailuresTracker(NestedUnionSchema, {
      primary_key: "id",
    });
    tracker.testSchema(makeAction(invalidNestedUnion), invalidNestedUnion);
    const schema = schemaErrorOf(tracker).serialised_schema;
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
  });

  test("a refined object schema descends into its fields", () => {
    const tracker = new WriteActionFailuresTracker(RefinedSchema, {
      primary_key: "id",
    });
    tracker.testSchema(makeAction(refinedItem), refinedItem);
    const tree = TreeNodeSchema.parse(schemaErrorOf(tracker).serialised_schema);
    // `.refine()` returns the underlying object (no effects wrapper), so the walker descends
    // into its fields rather than treating the schema as an opaque leaf.
    expect(tree.kind).toBe("object");
    expect(tree.children.some((c) => c.name === "id")).toBe(true);
  });

  test("a discriminated union serialises as a defined but shallow opaque node", () => {
    const tracker = new WriteActionFailuresTracker(DiscriminatedSchema, {
      primary_key: "id",
    });
    tracker.testSchema(
      makeAction(invalidDiscriminated),
      invalidDiscriminated,
    );
    const tree = TreeNodeSchema.parse(schemaErrorOf(tracker).serialised_schema);
    // A discriminated union extends ZodUnion in v4, but the walker guards it before the union
    // branch so it stays an opaque leaf (its variants are not expanded).
    expect(tree.kind).toBe("union");
    expect(tree.children.length).toBe(0);
  });
});

describe("the public type contract", () => {
  const tracker = new WriteActionFailuresTracker(FlatSchema, {
    primary_key: "id",
  });

  test("get() is typed as an array of failed write outcomes", () => {
    expectTypeOf(tracker.get()).toEqualTypeOf<WriteOutcomeFailed<FlatItem>[]>();
  });

  test("the halt signal and count are a boolean and a number", () => {
    expectTypeOf(tracker.shouldHalt()).toBeBoolean();
    expectTypeOf(tracker.length()).toBeNumber();
  });

  test("testSchema is typed to return a boolean", () => {
    expectTypeOf(tracker.testSchema).returns.toBeBoolean();
  });

  test("the recording methods are typed to return void", () => {
    expectTypeOf(tracker.report).returns.toBeVoid();
    expectTypeOf(tracker.blocked).returns.toBeVoid();
    expectTypeOf(tracker.mergeUnderAction).returns.toBeVoid();
  });
});
