import { z } from "zod";
import { isTypeEqual } from "@andyrmitchell/utils";
import type {
  WriteAction,
  WritePayload,
  WritePayloadCreate,
  WritePayloadUpdate,
  WritePayloadDelete,
  WritePayloadArrayScope,
  WritePayloadSetPropertyUndefined,
  WritePayloadDeleteProperty,
  WriteError,
  WriteErrorContext,
  WriteAffectedItem,
  WriteOutcomeOk,
  WriteOutcomeFailed,
  WriteOutcome,
  WriteResult,
} from "./types.ts";
import type {
  WriteChanges,
  WriteToItemsArrayChanges,
  WriteToItemsArrayResult,
} from "./writeToItemsArray/types.ts";
import type {
  DotPropPathToObjectArraySpreadingArrays,
  NonObjectArrayProperty,
} from "../dot-prop-paths/types.ts";
import {
  getWriteFailures,
  getWriteSuccesses,
  getWriteErrors,
} from "./helpers.ts";
// From the public barrel, so the pins cover the export itself as well as the behaviour.
import { isWriteActionArrayScopePayload, readGenericArrayScope } from "./index.ts";
import type { WritePayloadArrayScopeParts } from "./index.ts";
import { validateWriteAction } from "./validateWriteAction.ts";
import {
  WriteErrorSchema,
  WriteActionSchema,
  WriteResultSchema,
  WriteOutcomeSchema,
  WriteOutcomeOkSchema,
  WriteOutcomeFailedSchema,
  WriteAffectedItemSchema,
  makeWriteActionSchema,
} from "./write-action-schemas.ts";

// ═══════════════════════════════════════════════════════════════════
// Test Types (realistic domain shapes)
// ═══════════════════════════════════════════════════════════════════

type Task = {
  id: string;
  title: string;
  count?: number;
  tags?: string[];
  subtasks: {
    sid: string;
    label?: string;
    items: {
      iid: string;
      value?: number;
    }[];
  }[];
  owner?: { name: string; age: number };
};

type Flat = {
  id: string;
  text?: string;
  count?: number;
  tags?: string[];
};

/**
 * Shape whose properties differ in exactly which permission they carry, so the two property-targeting
 * verbs can be shown to offer different paths. Under `exactOptionalPropertyTypes` an optional key and an
 * undefinable value are separate permissions, and this fixture holds one of each plus one of both.
 */
type Profile = {
  id: string;
  removableOnly?: string;
  clearableOnly: string | undefined;
  both?: string | undefined;
  nested: { note?: string | undefined };
  bag: Record<string, string | undefined>;
  "rank.value"?: string | undefined;
  rows: { rid: string }[];
  tags?: string[] | undefined;
};

// ═══════════════════════════════════════════════════════════════════
// 1. WritePayload<T> construction
// ═══════════════════════════════════════════════════════════════════

describe("1. WritePayload<T> construction", () => {
  describe("1.1 Create payload", () => {
    it("accepts valid T as data", () => {
      const _create: WritePayloadCreate<Flat> = {
        type: "create",
        data: { id: "1", text: "hello", count: 5, tags: ["a"] },
      };
    });

    it("rejects extra properties not in T", () => {
      const _create: WritePayloadCreate<Flat> = {
        type: "create",
        // @ts-expect-error: 'extra' does not exist in Flat
        data: { id: "1", extra: true },
      };
    });

    it("rejects wrong type for a known property", () => {
      const _create: WritePayloadCreate<Flat> = {
        type: "create",
        // @ts-expect-error: count should be number, not string
        data: { id: "1", count: "not-a-number" },
      };
    });
  });

  describe("1.2 Update payload", () => {
    it("accepts Partial<T> (subset of fields)", () => {
      const _update: WritePayloadUpdate<Flat> = {
        type: "update",
        data: { text: "new" },
        where: { id: "1" },
      };
    });

    it("accepts scalar array properties (e.g. tags: string[])", () => {
      const _update: WritePayloadUpdate<Flat> = {
        type: "update",
        data: { tags: ["a", "b"] },
        where: { id: "1" },
      };
    });

    it("rejects object-array properties in data", () => {
      const _update: WritePayloadUpdate<Task> = {
        type: "update",
        // @ts-expect-error: subtasks is an object-array, forbidden in update
        data: { subtasks: [] },
        where: { id: "1" },
      };
    });

    it("rejects unknown properties", () => {
      const _update: WritePayloadUpdate<Flat> = {
        type: "update",
        // @ts-expect-error: 'unknown_prop' does not exist
        data: { unknown_prop: "bad" },
        where: { id: "1" },
      };
    });

    it("where-filter is correctly typed to T keys", () => {
      const _update: WritePayloadUpdate<Flat> = {
        type: "update",
        data: { text: "x" },
        where: { id: "1" },
      };

      const _update2: WritePayloadUpdate<Flat> = {
        type: "update",
        data: { text: "x" },
        // @ts-expect-error: 'nonexistent' is not a key of Flat
        where: { nonexistent: "bad" },
      };
    });
  });

  describe("1.3 Delete payload", () => {
    it("accepts valid where-filter", () => {
      const _del: WritePayloadDelete<Flat> = {
        type: "delete",
        where: { id: "1" },
      };
    });

    it("rejects where-filter with unknown keys", () => {
      const _del: WritePayloadDelete<Flat> = {
        type: "delete",
        // @ts-expect-error: 'fake' is not a key of Flat
        where: { fake: "bad" },
      };
    });
  });

  describe("1.4 Array scope payload", () => {
    it("accepts valid scope path to object-array", () => {
      const _scope: WritePayloadArrayScope<Task, "subtasks"> = {
        type: "array_scope",
        scope: "subtasks",
        action: { type: "create", data: { sid: "s1", items: [] } },
        where: { id: "1" },
      };
    });

    it("scoped action is correctly typed to the nested element type", () => {
      const _scope: WritePayloadArrayScope<Task, "subtasks"> = {
        type: "array_scope",
        scope: "subtasks",
        action: {
          type: "update",
          data: { label: "new" }, // label is a key of subtask element
          where: { sid: "s1" },
        },
        where: { id: "1" },
      };
    });

    it("deeply nested scope works (subtasks.items)", () => {
      const _scope: WritePayloadArrayScope<Task, "subtasks.items"> = {
        type: "array_scope",
        scope: "subtasks.items",
        action: { type: "create", data: { iid: "i1", value: 42 } },
        where: { id: "1" },
      };
    });
  });

  describe("1.5 Property-targeting payloads (clear a value, remove a key)", () => {
    it("clears a property whose declared type admits undefined", () => {
      const _clear: WritePayloadSetPropertyUndefined<Profile> = {
        type: "set_property_undefined",
        path: "clearableOnly",
        where: { id: "1" },
      };
    });

    it("refuses to clear a property that may only be absent, never undefined", () => {
      const _clear: WritePayloadSetPropertyUndefined<Profile> = {
        type: "set_property_undefined",
        // @ts-expect-error: `removableOnly?: string` may lose its key, but may not hold undefined
        path: "removableOnly",
        where: { id: "1" },
      };
    });

    it("removes a property declared optional", () => {
      const _remove: WritePayloadDeleteProperty<Profile> = {
        type: "delete_property",
        path: "removableOnly",
        where: { id: "1" },
      };
    });

    it("refuses to remove a property the shape always carries", () => {
      const _remove: WritePayloadDeleteProperty<Profile> = {
        type: "delete_property",
        // @ts-expect-error: `clearableOnly: string | undefined` promises the key is present
        path: "clearableOnly",
        where: { id: "1" },
      };
    });

    it("a property that is both optional and undefinable is offered to both verbs", () => {
      const _clear: WritePayloadSetPropertyUndefined<Profile> = {
        type: "set_property_undefined",
        path: "both",
        where: { id: "1" },
      };
      const _remove: WritePayloadDeleteProperty<Profile> = {
        type: "delete_property",
        path: "both",
        where: { id: "1" },
      };
    });

    it("reaches a nested property, a record key, and a key holding a literal dot", () => {
      const _nested: WritePayloadDeleteProperty<Profile> = {
        type: "delete_property",
        path: "nested.note",
        where: { id: "1" },
      };
      const _record: WritePayloadDeleteProperty<Profile> = {
        type: "delete_property",
        path: "bag.anything",
        where: { id: "1" },
      };
      const _dotted: WritePayloadDeleteProperty<Profile> = {
        type: "delete_property",
        path: "rank\\.value",
        where: { id: "1" },
      };
    });

    it("refuses a path that travels through an array", () => {
      const _remove: WritePayloadDeleteProperty<Profile> = {
        type: "delete_property",
        // @ts-expect-error: array contents are edited by scoping into the array
        path: "rows.rid",
        where: { id: "1" },
      };
    });

    it("refuses a leaf holding an array of objects, while allowing one holding scalars", () => {
      const _objects: WritePayloadDeleteProperty<Profile> = {
        type: "delete_property",
        // @ts-expect-error: discarding a whole collection of objects is not expressible
        path: "rows",
        where: { id: "1" },
      };
      const _scalars: WritePayloadDeleteProperty<Profile> = {
        type: "delete_property",
        path: "tags",
        where: { id: "1" },
      };
    });

    it("rejects a where-filter with unknown keys, like every other verb", () => {
      const _remove: WritePayloadDeleteProperty<Profile> = {
        type: "delete_property",
        path: "removableOnly",
        // @ts-expect-error: 'fake' is not a key of Profile
        where: { fake: "bad" },
      };
    });

    it("both verbs are members of the payload union", () => {
      const _payloads: WritePayload<Profile>[] = [
        { type: "set_property_undefined", path: "both", where: { id: "1" } },
        { type: "delete_property", path: "both", where: { id: "1" } },
      ];
    });
  });

  describe("1.6 An explicit undefined value in written data", () => {
    /** A field whose declared type includes `null`, so the contrast between a stored `null` and a refused `undefined` is expressible. */
    type Marked = { id: string; note: string | null };

    it("is refused in an update where the field's declared type does not admit undefined", () => {
      const _removable: WritePayloadUpdate<Profile> = {
        type: "update",
        // @ts-expect-error: 'removableOnly' is optional without naming undefined, and exactOptionalPropertyTypes holds its value to the declared type — remove the field with delete_property
        data: { removableOnly: undefined },
        where: { id: "1" },
      };
    });

    it("leaves omission and null alone — they are how an update says 'untouched' and 'no value'", () => {
      const _untouched: WritePayloadUpdate<Marked> = {
        type: "update",
        data: {},
        where: { id: "1" },
      };
      const _nulled: WritePayloadUpdate<Marked> = {
        type: "update",
        data: { note: null },
        where: { id: "1" },
      };
      const _created: WritePayloadCreate<Marked> = {
        type: "create",
        data: { id: "1", note: null },
      };
    });

    it("keeps every key of a create required, so a field that can hold no value still has to be given one", () => {
      const _create: WritePayloadCreate<Profile> = {
        type: "create",
        // @ts-expect-error: 'clearableOnly' is a required key, and a create defines the whole item
        data: { id: "1", nested: {}, bag: {}, rows: [] },
      };
    });

    it("keeps an optional key omittable, so a create need not invent a value for it", () => {
      const _create: WritePayloadCreate<Profile> = {
        type: "create",
        data: { id: "1", clearableOnly: "x", nested: {}, bag: {}, rows: [] },
      };
    });

    // KNOWN LIMITATION, pinned deliberately: the undefined ban is enforced at runtime only, the top level of
    // `data` included. Excluding `undefined` structurally would stop a generic caller assigning a row of its
    // own type straight in and would break inferring the row type from the payload at all, so the type keeps
    // each field's declared shape. A value therefore compiles wherever the field itself admits `undefined`;
    // the runtime value gate is the authority, and it rejects these at any depth before anything is stored.
    it("compiles an explicit undefined wherever the field admits one, which the runtime gate is what refuses", () => {
      const _clearable: WritePayloadUpdate<Profile> = {
        type: "update",
        data: { clearableOnly: undefined },
        where: { id: "1" },
      };
      const _both: WritePayloadUpdate<Profile> = {
        type: "update",
        data: { both: undefined },
        where: { id: "1" },
      };
      const _create: WritePayloadCreate<Profile> = {
        type: "create",
        data: { id: "1", clearableOnly: "x", both: undefined, nested: {}, bag: {}, rows: [] },
      };
      const _updateNested: WritePayloadUpdate<Profile> = {
        type: "update",
        data: { nested: { note: undefined } },
        where: { id: "1" },
      };
      const _createNested: WritePayloadCreate<Profile> = {
        type: "create",
        data: { id: "1", clearableOnly: "x", nested: { note: undefined }, bag: { anything: undefined }, rows: [] },
      };
    });
  });

  describe("1.7 Generic callers", () => {
    /** A payload-taking helper whose row type is discovered from the argument alone. */
    function passThrough<T extends Record<string, any>>(p: WritePayload<T>): WritePayload<T> {
      return p;
    }

    it("infers the row type from a create's data alone", () => {
      const p = passThrough({ type: "create", data: { id: "1" } });
      isTypeEqual<typeof p, WritePayload<{ id: string }>>(true);
    });

    it("passes a generic row through a payload-taking helper without casts", () => {
      function viaInference<T extends Record<string, any>>(row: T): WritePayload<T> {
        return passThrough({ type: "create", data: row });
      }
      void viaInference;
    });

    it("assigns a generic row straight into a create payload", () => {
      function direct<T extends Record<string, any>>(row: T): WritePayloadCreate<T> {
        return { type: "create", data: row };
      }
      void direct;
    });

    it("relates a payload-reading callback to the actions it serves when the row type is inferred", () => {
      function helper<T extends Record<string, any>>(actions: ReadonlyArray<WriteAction<T>>, get: (uuid: string) => WritePayload<T> | undefined): void {
        void actions;
        void get;
      }
      function caller<T extends Record<string, any>>(actions: WriteAction<T>[], applied: Map<string, WritePayload<T>>): void {
        helper(actions, (uuid) => applied.get(uuid));
      }
      void caller;
    });

    describe("1.7.1 Reading an array-scope payload whose row type is still generic", () => {
      const scopedPayload: WritePayloadArrayScope<Task, "subtasks"> = {
        type: "array_scope",
        scope: "subtasks",
        action: { type: "update", data: { label: "renamed" }, where: { sid: "s1" } },
        where: { id: "1" },
      };

      /** Consumes an element-level payload by inference — the supported way to spend a scoped action. */
      function applyToElement<E extends Record<string, any>>(w: WritePayload<E>): WritePayload<E> {
        return w;
      }

      it("reads the scope back as a path the row's own vocabulary accepts", () => {
        function scopeOf<T extends Record<string, any>>(p: WritePayloadArrayScope<T>): DotPropPathToObjectArraySpreadingArrays<T> {
          return readGenericArrayScope(p).scope;
        }
        void scopeOf;
      });

      it("hands the scoped action to machinery typed for the elements", () => {
        function forward<T extends Record<string, any>>(p: WritePayloadArrayScope<T>) {
          return applyToElement(readGenericArrayScope(p).action);
        }
        void forward;
      });

      it("narrows a generic payload to the array-scope verb when that verb is tested first", () => {
        function nameTheVerb<T extends Record<string, any>>(p: WritePayload<T>): string {
          if (isWriteActionArrayScopePayload<T>(p)) {
            return readGenericArrayScope(p).scope;
          }
          switch (p.type) {
            case "create":
              return "create";
            default:
              return p.type;
          }
        }
        void nameTheVerb;
      });

      it("hands back the very same payload object", () => {
        expect(readGenericArrayScope<Task, "subtasks">(scopedPayload)).toBe(scopedPayload);
      });

      it("leaves a known row type's scope exactly as precise as it already was", () => {
        // A payload whose row type is already known names its row type here: there is no generic
        // parameter left for the row type to be discovered from.
        const parts = readGenericArrayScope<Task, "subtasks">(scopedPayload);
        isTypeEqual<typeof parts.scope, "subtasks">(true);
        isTypeEqual<typeof parts, WritePayloadArrayScopeParts<Task, "subtasks">>(true);
      });

      it("refuses a direct scope read on a generic payload, which is the reason the helper exists", () => {
        function scopeOfDirectly<T extends Record<string, any>>(p: WritePayloadArrayScope<T>): DotPropPathToObjectArraySpreadingArrays<T> {
          // @ts-expect-error KNOWN LIMITATION: on a generically typed payload `scope` widens to a bare
          // string rather than a path, because the checker cannot resolve the payload member-by-member
          // until the row type is known. `readGenericArrayScope(p).scope` is the supported spelling.
          return p.scope;
        }
        void scopeOfDirectly;
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. WriteAction<T> envelope
// ═══════════════════════════════════════════════════════════════════

describe("2. WriteAction<T> envelope", () => {
  it("accepts valid {type:write, ts, uuid, payload}", () => {
    const _action: WriteAction<Flat> = {
      type: "write",
      ts: Date.now(),
      uuid: "abc-123",
      payload: { type: "create", data: { id: "1" } },
    };
  });

  it("rejects missing uuid", () => {
    // @ts-expect-error: uuid is required
    const _action: WriteAction<Flat> = {
      type: "write",
      ts: Date.now(),
      payload: { type: "create", data: { id: "1" } },
    };
  });

  it("rejects missing ts", () => {
    // @ts-expect-error: ts is required
    const _action: WriteAction<Flat> = {
      type: "write",
      uuid: "abc",
      payload: { type: "create", data: { id: "1" } },
    };
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. WriteResult<T> / WriteOutcome<T> narrowing
// ═══════════════════════════════════════════════════════════════════

describe("3. WriteResult<T> / WriteOutcome<T> narrowing", () => {
  describe("3.1 WriteOutcome discriminated union", () => {
    it("after checking ok:true, affected_items is accessible", () => {
      const outcome: WriteOutcome<Flat> = {} as WriteOutcome<Flat>;
      if (outcome.ok) {
        // Should compile: affected_items exists on WriteOutcomeOk
        const _items = outcome.affected_items;
      }
    });

    it("after checking ok:false, errors and blocked_by_action_uuid are accessible", () => {
      const outcome: WriteOutcome<Flat> = {} as WriteOutcome<Flat>;
      if (!outcome.ok) {
        const _errors = outcome.errors;
        const _blocked = outcome.blocked_by_action_uuid;
        const _unrecoverable = outcome.unrecoverable;
      }
    });

    it("errors is not accessible without narrowing", () => {
      const outcome: WriteOutcome<Flat> = {} as WriteOutcome<Flat>;
      // @ts-expect-error: errors only exists after narrowing to ok:false
      const _errors = outcome.errors;
    });
  });

  describe("3.2 WriteResult is NOT discriminated", () => {
    it("result.ok and result.actions always accessible regardless of ok value", () => {
      const result: WriteResult<Flat> = {} as WriteResult<Flat>;
      // Both should compile without narrowing
      const _ok = result.ok;
      const _actions = result.actions;
      const _error = result.error;
    });

    it("result.actions[0] requires narrowing before accessing .errors", () => {
      const result: WriteResult<Flat> = { ok: false, actions: [] };
      // Provide a dummy outcome to test compile-time narrowing
      const outcome: WriteOutcome<Flat> = {
        ok: true,
        action_uuid: "x",
      };
      // @ts-expect-error: outcome is WriteOutcome, must narrow to access errors
      const _errors = outcome.errors;
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. WriteError discriminated union
// ═══════════════════════════════════════════════════════════════════

describe("4. WriteError discriminated union", () => {
  describe("4.1 Narrowing on type", () => {
    it("type:schema -> .issues accessible", () => {
      const error: WriteError = {} as WriteError;
      if (error.type === "schema") {
        const _issues = error.issues;
      }
    });

    it("type:custom -> .message accessible", () => {
      const error: WriteError = {} as WriteError;
      if (error.type === "custom") {
        const _msg = error.message;
      }
    });

    it(".issues not accessible on type:custom", () => {
      const error: WriteError = {} as WriteError;
      if (error.type === "custom") {
        // @ts-expect-error: issues only exists on type:'schema'
        const _issues = error.issues;
      }
    });

    it("type:missing_key -> .primary_key accessible", () => {
      const error: WriteError = {} as WriteError;
      if (error.type === "missing_key") {
        const _pk = error.primary_key;
      }
    });

    it("type:blocked -> .blocked_by_action_uuid accessible", () => {
      const error: WriteError = {} as WriteError;
      if (error.type === "blocked") {
        const _uuid = error.blocked_by_action_uuid;
      }
    });
  });

  describe("4.2 Exhaustiveness", () => {
    it("switch on all WriteError.type variants: unhandled resolves to never", () => {
      const error: WriteError = {} as WriteError;
      switch (error.type) {
        case "custom":
          break;
        case "schema":
          break;
        case "missing_key":
          break;
        case "update_altered_key":
          break;
        case "create_duplicated_key":
          break;
        case "blocked":
          break;
        case "uuid_conflict":
          break;
        case "invalid_filter":
          break;
        case "invalid_scope":
          break;
        case "invalid_data_value":
          break;
        case "invalid_property_path":
          break;
        default: {
          // If all cases are handled, this should resolve to never
          const _exhaustive: never = error;
        }
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Helper function return types
// ═══════════════════════════════════════════════════════════════════

describe("6. Helper function return types", () => {
  it("getWriteFailures returns WriteOutcomeFailed<T>[]", () => {
    const result: WriteResult<Flat> = { ok: false, actions: [] };
    const failures = getWriteFailures(result);
    isTypeEqual<typeof failures, WriteOutcomeFailed<Flat>[]>(true);
    // Accessing .errors should work without narrowing (already narrowed)
    if (failures[0]) {
      const _errors = failures[0].errors;
    }
  });

  it("getWriteSuccesses returns WriteOutcomeOk<T>[]", () => {
    const result: WriteResult<Flat> = { ok: true, actions: [] };
    const successes = getWriteSuccesses(result);
    isTypeEqual<typeof successes, WriteOutcomeOk<Flat>[]>(true);
    if (successes[0]) {
      const _items = successes[0].affected_items;
    }
  });

  it("getWriteErrors returns WriteErrorContext[]", () => {
    const result: WriteResult<Flat> = { ok: false, actions: [] };
    const errors = getWriteErrors(result);
    isTypeEqual<typeof errors, WriteErrorContext[]>(true);
    if (errors[0]) {
      const _type = errors[0].type;
      const _pk = errors[0].item_pk;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Path & Property Type Helpers
// ═══════════════════════════════════════════════════════════════════

describe("7. Path & Property Type Helpers", () => {
  it("DotPropPathToObjectArraySpreadingArrays<T> correctly infers paths", () => {
    type Paths = DotPropPathToObjectArraySpreadingArrays<Task>;
    // These should be valid paths
    const _p1: Paths = "subtasks";
    const _p2: Paths = "subtasks.items";
  });

  it("NonObjectArrayProperty<T>: exactly the non-object-array keys", () => {
    type NonObjArr = NonObjectArrayProperty<Task>;
    // These should be valid
    const _k1: NonObjArr = "id";
    const _k2: NonObjArr = "title";
    const _k3: NonObjArr = "count";
    const _k4: NonObjArr = "tags"; // scalar array: allowed

    // @ts-expect-error: subtasks is an object-array, should be excluded
    const _k5: NonObjArr = "subtasks";
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Schema <-> Type alignment (bidirectional)
// ═══════════════════════════════════════════════════════════════════

describe("8. Schema <-> Type alignment", () => {
  it("z.infer of WriteActionSchema satisfies WriteAction<any>", () => {
    isTypeEqual<z.infer<typeof WriteActionSchema>, WriteAction<any>>(true);
  });

  it("z.infer of WriteResultSchema satisfies WriteResult<any>", () => {
    isTypeEqual<z.infer<typeof WriteResultSchema>, WriteResult<any>>(true);
  });

  it("z.infer of WriteOutcomeSchema satisfies WriteOutcome<any>", () => {
    isTypeEqual<z.infer<typeof WriteOutcomeSchema>, WriteOutcome<any>>(true);
  });

  it("z.infer of WriteErrorSchema satisfies WriteError", () => {
    isTypeEqual<z.infer<typeof WriteErrorSchema>, WriteError>(true);
  });

  it("z.infer of WriteOutcomeOkSchema satisfies WriteOutcomeOk<any>", () => {
    isTypeEqual<z.infer<typeof WriteOutcomeOkSchema>, WriteOutcomeOk<any>>(
      true,
    );
  });

  it("z.infer of WriteOutcomeFailedSchema satisfies WriteOutcomeFailed<any>", () => {
    isTypeEqual<
      z.infer<typeof WriteOutcomeFailedSchema>,
      WriteOutcomeFailed<any>
    >(true);
  });

  it("z.infer of WriteAffectedItemSchema satisfies WriteAffectedItem<any>", () => {
    isTypeEqual<
      z.infer<typeof WriteAffectedItemSchema>,
      WriteAffectedItem<any>
    >(true);
  });

  it("makeWriteActionSchema validates correctly against runtime data", () => {
    const schema = z.object({ id: z.string(), text: z.string() });
    const actionSchema = makeWriteActionSchema(schema);

    const valid = actionSchema.safeParse({
      type: "write",
      ts: 1,
      uuid: "x",
      payload: { type: "create", data: { id: "1", text: "hi" } },
    });
    expect(valid.success).toBe(true);

    const invalid = actionSchema.safeParse({
      type: "write",
      ts: 1,
      uuid: "x",
      payload: { type: "create", data: { id: "1", text: "hi", extra: true } },
    });
    expect(invalid.success).toBe(false);
  });

  // The parse gate must agree with the write engine on which array_scope scopes are writable: any scope
  // the engine would reject as invalid_scope must fail safeParse here — as a value, never a throw — so a
  // store gating on the schema admits nothing the engine will refuse.
  describe("makeWriteActionSchema rejects an unwritable array_scope.scope as a parse failure, never a throw", () => {
    const RowSchema = z.object({
      id: z.string(),
      profile: z.object({ n: z.string() }).optional(),
      children: z
        .array(
          z.object({
            cid: z.string(),
            items: z.array(z.object({ iid: z.string() })),
          }),
        )
        .optional(),
    });
    const actionSchema = makeWriteActionSchema(RowSchema);
    const scopedAction = (
      scope: string,
      nested: unknown = { type: "update", data: {}, where: { cid: "c1" } },
    ) => ({
      type: "write",
      ts: 1,
      uuid: "u",
      payload: { type: "array_scope", scope, action: nested, where: { id: "1" } },
    });

    it.each([
      "constructor",
      "children.constructor",
      "toString",
      "nonexistent",
      "id",
      "profile",
    ])("fails safeParse for scope %j without throwing", (scope) => {
      expect(() => actionSchema.safeParse(scopedAction(scope))).not.toThrow();
      expect(actionSchema.safeParse(scopedAction(scope)).success).toBe(false);
    });

    it("accepts a top-level and a nested object-array scope", () => {
      expect(actionSchema.safeParse(scopedAction("children")).success).toBe(true);
      expect(
        actionSchema.safeParse(
          scopedAction("children.items", { type: "update", data: {}, where: { iid: "i1" } }),
        ).success,
      ).toBe(true);
    });

    it("accepts a DECLARED field named after an inherited member outside the disallowed trio", () => {
      const declaresToString = z.object({
        id: z.string(),
        toString: z.array(z.object({ tid: z.string() })),
      });
      const s = makeWriteActionSchema(declaresToString);
      expect(
        s.safeParse(scopedAction("toString", { type: "update", data: {}, where: { tid: "t1" } })).success,
      ).toBe(true);
    });

    it("rejects a DECLARED constructor field — the runtime reader can never traverse that segment", () => {
      const declaresConstructor = z.object({
        id: z.string(),
        constructor: z.array(z.object({ kid: z.string() })),
      });
      const s = makeWriteActionSchema(declaresConstructor);
      const action = scopedAction("constructor", { type: "update", data: {}, where: { kid: "k1" } });
      expect(() => s.safeParse(action)).not.toThrow();
      expect(s.safeParse(action).success).toBe(false);
    });
  });

  // The parse gate must agree with the write engine on which properties a caller may clear or remove: any
  // path the engine would reject as invalid_property_path must fail safeParse here — as a value, never a
  // throw — so a store gating on the schema admits nothing the engine will refuse.
  describe("makeWriteActionSchema rejects an unwritable property path as a parse failure, never a throw", () => {
    const RowSchema = z.object({
      id: z.string(),
      nickname: z.string().optional(),
      profile: z.object({ note: z.string().optional() }),
      bag: z.record(z.string(), z.string().optional()),
      rows: z.array(z.object({ rid: z.string() })),
    });
    const actionSchema = makeWriteActionSchema(RowSchema);
    const propertyAction = (type: string, path: string) => ({
      type: "write",
      ts: 1,
      uuid: "u",
      payload: { type, path, where: { id: "1" } },
    });

    it.each([
      "constructor",
      "bag.",
      "nonexistent",
      "id",
      "rows.rid",
      "rows",
    ])("fails safeParse for delete_property path %j without throwing", (path) => {
      const action = propertyAction("delete_property", path);
      expect(() => actionSchema.safeParse(action)).not.toThrow();
      expect(actionSchema.safeParse(action).success).toBe(false);
    });

    it("accepts the paths the engine will write through, at every depth", () => {
      for (const path of ["nickname", "profile.note", "bag.anything"]) {
        expect(actionSchema.safeParse(propertyAction("delete_property", path)).success).toBe(true);
        expect(actionSchema.safeParse(propertyAction("set_property_undefined", path)).success).toBe(true);
      }
    });

    it("holds each verb to its own permission on the same schema", () => {
      // The record's values are optional, so its keys may be cleared; a plain required field may be neither.
      expect(actionSchema.safeParse(propertyAction("set_property_undefined", "id")).success).toBe(false);
      expect(actionSchema.safeParse(propertyAction("delete_property", "id")).success).toBe(false);
    });

    it("leaves the path to the engine when no row schema is supplied", () => {
      // Without a schema there is nothing to resolve against, so the payload parses and the engine judges it.
      const untyped = makeWriteActionSchema();
      expect(untyped.safeParse(propertyAction("delete_property", "anything.at.all")).success).toBe(true);
    });
  });

  describe("makeWriteActionSchema rejects an explicit undefined in written data", () => {
    const RowSchema = z.object({
      id: z.string(),
      nickname: z.string().optional(),
      profile: z.object({ note: z.string().optional() }),
    });
    const actionSchema = makeWriteActionSchema(RowSchema);
    const dataAction = (payload: unknown) => ({ type: "write", ts: 1, uuid: "u", payload });

    it("refuses it in an update, which the row schema on its own would admit", () => {
      // `nickname` is declared optional, so the row schema parses the undefined happily — the gate is what refuses it.
      expect(RowSchema.partial().safeParse({ nickname: undefined }).success).toBe(true);
      expect(actionSchema.safeParse(dataAction({ type: "update", data: { nickname: undefined }, where: { id: "1" } })).success).toBe(false);
    });

    it("refuses it in a create", () => {
      expect(actionSchema.safeParse(dataAction({ type: "create", data: { id: "1", nickname: undefined, profile: {} } })).success).toBe(false);
    });

    it("refuses it at any depth", () => {
      expect(actionSchema.safeParse(dataAction({ type: "update", data: { profile: { note: undefined } }, where: { id: "1" } })).success).toBe(false);
    });

    it("refuses it with no row schema too, because the fault is in the value rather than the shape", () => {
      const untyped = makeWriteActionSchema();
      expect(untyped.safeParse(dataAction({ type: "update", data: { anything: undefined }, where: { id: "1" } })).success).toBe(false);
    });

    it("accepts the same data with the key omitted, and with a null value", () => {
      expect(actionSchema.safeParse(dataAction({ type: "update", data: {}, where: { id: "1" } })).success).toBe(true);
      expect(actionSchema.safeParse(dataAction({ type: "update", data: { nickname: "ann" }, where: { id: "1" } })).success).toBe(true);

      const NullableRowSchema = z.object({ id: z.string(), note: z.string().nullable() });
      expect(makeWriteActionSchema(NullableRowSchema).safeParse(dataAction({ type: "update", data: { note: null }, where: { id: "1" } })).success).toBe(true);
    });

    /**
     * The gate reads what the caller wrote, not what the row schema makes of it.
     *
     * A row schema is free to invent values a caller never supplied and to replace ones it did, so judging
     * the parsed data asks the wrong question in both directions. Each case states the engine's own verdict
     * beside the gate's, because the two agreeing is the whole point of having the gate.
     */
    describe("judging the caller's own data, not the row schema's rendering of it", () => {
      const HouseSchema = z.object({
        id: z.string(),
        scores: z.record(z.enum(["home", "away"]), z.number().optional()),
        tag: z.string().default("x"),
      });
      const houseAction = makeWriteActionSchema(HouseSchema);

      it("accepts data whose undefined values the row schema invents", () => {
        // Parsing `{}` against this record materialises every declared name, holding undefined — values the
        // caller never wrote, and which the gate must not attribute to them.
        expect(Object.getOwnPropertyNames(HouseSchema.shape.scores.parse({}))).toEqual(["home", "away"]);

        const action = dataAction({ type: "update", data: { scores: {} }, where: { id: "1" } });
        expect(houseAction.safeParse(action).success).toBe(true);
        expect(validateWriteAction(action as WriteAction<any>, HouseSchema)).toEqual([]);
      });

      it("refuses an undefined the row schema would quietly replace with a default", () => {
        // The default fires during parsing, so a gate reading the parsed data sees `tag: 'x'` — a value the
        // write language forbids the caller from asking for, laundered into one it allows.
        expect(HouseSchema.partial().parse({ tag: undefined })).toEqual({ tag: "x" });

        for (const payload of [
          { type: "update", data: { tag: undefined }, where: { id: "1" } },
          { type: "create", data: { id: "1", scores: {}, tag: undefined } },
        ]) {
          const action = dataAction(payload);
          expect(houseAction.safeParse(action).success).toBe(false);
          expect(validateWriteAction(action as WriteAction<any>, HouseSchema)[0]?.type).toBe("invalid_data_value");
        }
      });

      it("refuses it behind a prefault, which substitutes just as a default does", () => {
        const PrefaultSchema = z.object({ id: z.string(), tag: z.string().prefault("x") });
        const action = dataAction({ type: "update", data: { tag: undefined }, where: { id: "1" } });
        expect(makeWriteActionSchema(PrefaultSchema).safeParse(action).success).toBe(false);
        expect(validateWriteAction(action as WriteAction<any>, PrefaultSchema)[0]?.type).toBe("invalid_data_value");
      });

      it("still enforces the row's shape, so checking the raw value costs no validation", () => {
        expect(houseAction.safeParse(dataAction({ type: "update", data: { tag: 5 }, where: { id: "1" } })).success).toBe(false);
        expect(houseAction.safeParse(dataAction({ type: "update", data: { unknown: "k" }, where: { id: "1" } })).success).toBe(false);
      });
    });
  });

  it("WriteResultSchema validates a minimal result", () => {
    expect(WriteResultSchema.safeParse({ ok: true, actions: [] }).success).toBe(
      true,
    );
  });

  it("a schema error without serialised_schema is schema-valid and round-trips (serialised_schema is optional)", () => {
    // Schema serialisation is best-effort; when it cannot be produced the `schema` error omits
    // serialised_schema entirely. The error — and a failed outcome carrying it — must still parse
    // and losslessly round-trip JSON (the boundary safeParses these without any normalising clone).
    const err = { type: "schema" as const, issues: [] };
    expect(WriteErrorSchema.safeParse(err).success).toBe(true);
    const outcome = { ok: false as const, action_uuid: "u1", errors: [err] };
    expect(WriteOutcomeFailedSchema.safeParse(outcome).success).toBe(true);
    expect(JSON.parse(JSON.stringify(outcome))).toEqual(outcome);
  });
});
