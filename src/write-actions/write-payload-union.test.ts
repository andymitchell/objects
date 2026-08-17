/**
 * `WritePayload<T>` is a contract, not a formality: annotating a value with it must reject every
 * payload the shape cannot honour.
 *
 * The union is assembled from key filters and path generators, several of which are indexed mapped
 * types. An indexed mapped type that receives a non-key resolves to `unknown`, and one `unknown`
 * member makes the whole union accept anything — silently, with no error anywhere to notice. So the
 * first thing these tests establish is that the union resolved at all; everything after that checks
 * a specific verb's terms.
 *
 * Fixtures are declared locally and deliberately plain, so what a test proves can be read off the
 * shape beside it.
 */
import { describe, it, expectTypeOf } from "vitest";
import { isTypeEqual } from "@andyrmitchell/utils";
import type {
  WriteAction,
  WritePayload,
  WritePayloadArrayScope,
} from "./types.ts";

/** Object arrays at two levels, plus optional fields — the shape a real row tends to have. */
type Task = {
  id: string;
  title: string;
  priority: number;
  label?: string;
  tags: string[];
  subs: { sid: string; hint?: string; items: { iid: string }[] }[];
};

/** A scalar array and nothing nested: no scope to write into. */
type Flat = { id: string; text?: string; count: number; tags: string[] };

/** No arrays at all. */
type ScalarOnly = { id: string; label?: string; score: number };

/** An array reachable only through a parent that may be absent. */
type OptParent = { id: string; box?: { rows: { rid: string }[] } };

/** An array whose element type admits `undefined`, as a row read back from a sparse source may declare. */
type SparseElements = { id: string; tags: (string | undefined)[] };

/** An array whose element arrives as either an object or a scalar. */
type MixedElements = { id: string; mix: ({ tag: string } | string)[] };

/** An array whose element is itself an array. */
type ListOfLists = { id: string; grid: string[][] };

/** An array whose element is known to have keys, without saying which. */
type LooseElements = { id: string; rows: Record<string, unknown>[] };

/** Object arrays declared in the flavours that make a key optional or undefinable. */
type WithOptObjArr = {
  id: string;
  nullOnly: null;
  children?: { cid: string }[];
  audit: { aid: string }[] | undefined;
};

describe("The payload union", () => {

  it("resolves to a union of verbs rather than to unknown", () => {
    expectTypeOf<WritePayload<Task>>().not.toBeUnknown();
    expectTypeOf<WritePayload<Flat>>().not.toBeUnknown();
    expectTypeOf<WritePayload<ScalarOnly>>().not.toBeUnknown();
  });

  it("offers every verb to a shape that can honour every verb", () => {
    isTypeEqual<
      WritePayload<Task>["type"],
      | "create"
      | "update"
      | "delete"
      | "array_scope"
      | "add_to_set"
      | "push"
      | "pull"
      | "inc"
      | "set_property_undefined"
      | "delete_property"
    >(true);
  });

  it("withholds scoping from a shape with no array of objects to scope into", () => {
    isTypeEqual<
      WritePayload<Flat>["type"],
      | "create"
      | "update"
      | "delete"
      | "add_to_set"
      | "push"
      | "pull"
      | "inc"
      | "set_property_undefined"
      | "delete_property"
    >(true);
  });

  it("withholds every array verb from a shape with no arrays", () => {
    isTypeEqual<
      WritePayload<ScalarOnly>["type"],
      | "create"
      | "update"
      | "delete"
      | "inc"
      | "set_property_undefined"
      | "delete_property"
    >(true);
  });

  it("rejects a verb it does not define", () => {
    // @ts-expect-error: 'frobnicate' is not a write verb
    const _bad: WritePayload<Task> = { type: "frobnicate", where: { id: "1" } };
  });

  it("checks a payload reached through the action wrapper just as closely", () => {
    const _push: WriteAction<Task>["payload"] = {
      type: "push",
      path: "tags",
      items: ["a"],
      where: { id: "1" },
    };
    const _bad: WriteAction<Task>["payload"] = {
      type: "push",
      // @ts-expect-error: 'title' holds a string, not an array
      path: "title",
      items: ["a"],
      where: { id: "1" },
    };
  });
});

describe("Array verbs", () => {

  it("push appends items of the element type at the path", () => {
    const _objects: WritePayload<Task> = {
      type: "push",
      path: "subs",
      items: [{ sid: "s1", items: [] }],
      where: { id: "1" },
    };
    const _scalars: WritePayload<Flat> = {
      type: "push",
      path: "tags",
      items: ["urgent"],
      where: { id: "1" },
    };
  });

  it("push refuses items of the wrong element type", () => {
    const _wrong: WritePayload<Flat> = {
      type: "push",
      path: "tags",
      // @ts-expect-error: 'tags' holds strings
      items: [1],
      where: { id: "1" },
    };
  });

  it("refuses an undefined element even where the element type admits one", () => {
    // A list position cannot be left empty, so JSON writes an undefined element as null — a value the list did
    // not hold. A field that may hold one is still not a field a write may put one into.
    const _push: WritePayload<SparseElements> = {
      type: "push",
      path: "tags",
      // @ts-expect-error: a written element cannot be undefined; leave it out, or write the null JSON would
      items: ["a", undefined],
      where: { id: "1" },
    };
    const _addToSet: WritePayload<SparseElements> = {
      type: "add_to_set",
      path: "tags",
      // @ts-expect-error: a written element cannot be undefined; leave it out, or write the null JSON would
      items: [undefined],
      unique_by: "deep_equals",
      where: { id: "1" },
    };
    // The control: only the undefined half of the element type is withheld, not the element type itself.
    const _defined: WritePayload<SparseElements> = {
      type: "push",
      path: "tags",
      items: ["a"],
      where: { id: "1" },
    };
  });

  it("add_to_set requires the rule that decides what counts as already present", () => {
    const _ok: WritePayload<Flat> = {
      type: "add_to_set",
      path: "tags",
      items: ["urgent"],
      unique_by: "deep_equals",
      where: { id: "1" },
    };
    // @ts-expect-error: unique_by names how membership is decided, and has no default
    const _missing: WritePayload<Flat> = {
      type: "add_to_set",
      path: "tags",
      items: ["urgent"],
      where: { id: "1" },
    };
  });

  describe("deciding what counts as already present", () => {

    it("reads a primary key off the element where the element has keys to read", () => {
      const _byKey: WritePayload<Task> = {
        type: "add_to_set",
        path: "subs",
        items: [{ sid: "s1", items: [] }],
        unique_by: "pk",
        where: { id: "1" },
      };
      const _byValue: WritePayload<Flat> = {
        type: "add_to_set",
        path: "tags",
        items: ["urgent"],
        unique_by: "deep_equals",
        where: { id: "1" },
      };
    });

    it("refuses a primary key where the element is a scalar that has none", () => {
      const _scalars: WritePayload<Flat> = {
        type: "add_to_set",
        path: "tags",
        items: ["urgent"],
        // @ts-expect-error: a string has no key to be unique by; compare strings by value
        unique_by: "pk",
        where: { id: "1" },
      };
    });

    it("offers a primary key to an element known to have keys without saying which", () => {
      const _loose: WritePayload<LooseElements> = {
        type: "add_to_set",
        path: "rows",
        items: [{ rid: "r1" }],
        unique_by: "pk",
        where: { id: "1" },
      };
    });

    it("refuses a primary key where the element is itself a list", () => {
      const _lists: WritePayload<ListOfLists> = {
        type: "add_to_set",
        path: "grid",
        items: [["a"]],
        // @ts-expect-error: a list has no key to be unique by, however object-like it looks
        unique_by: "pk",
        // An empty filter matches every item. This shape cannot name one of its own keys here: a
        // field holding an array of arrays collapses its whole filter key domain, a gap pinned in
        // the where-filter type tests.
        where: {},
      };
    });

    it("refuses a primary key where only some elements could carry one", () => {
      const _mixed: WritePayload<MixedElements> = {
        type: "add_to_set",
        path: "mix",
        items: ["x"],
        // @ts-expect-error: an element that may arrive as a scalar cannot be relied on for a key
        unique_by: "pk",
        where: { id: "1" },
      };
    });

    it("keeps both rules where the shape says nothing about the element", () => {
      const _any: WritePayload<any> = {
        type: "add_to_set",
        path: "anything",
        items: [{ id: "1" }],
        unique_by: "pk",
        where: {},
      };
      const _openRecord: WritePayload<Record<string, any>> = {
        type: "add_to_set",
        path: "anything",
        items: [{ id: "1" }],
        unique_by: "pk",
        where: {},
      };
    });

    it("still names the rules it knows on a shape that describes no element", () => {
      // The control for the test above: a shape with nothing to say about its elements could offer
      // `unique_by` as anything at all, and then accepting 'pk' there would prove nothing.
      const _any: WritePayload<any> = {
        type: "add_to_set",
        path: "anything",
        items: [],
        // @ts-expect-error: membership is decided by one of two named rules, whatever the element
        unique_by: "nonsense",
        where: {},
      };
      const _openRecord: WritePayload<Record<string, any>> = {
        type: "add_to_set",
        path: "anything",
        items: [],
        // @ts-expect-error: membership is decided by one of two named rules, whatever the element
        unique_by: "nonsense",
        where: {},
      };
    });
  });

  it("pull selects elements by filter in an object array, and by value in a scalar array", () => {
    const _objects: WritePayload<Task> = {
      type: "pull",
      path: "subs",
      items_where: { sid: "s1" },
      where: { id: "1" },
    };
    const _scalars: WritePayload<Flat> = {
      type: "pull",
      path: "tags",
      items_where: ["urgent"],
      where: { id: "1" },
    };
  });

  it("pull refuses a filter where only values can identify an element", () => {
    const _filterOnScalars: WritePayload<Flat> = {
      type: "pull",
      path: "tags",
      // @ts-expect-error: a scalar array is pulled by value, not by filter
      items_where: { tags: "urgent" },
      where: { id: "1" },
    };
  });

  it("inc names a number property and nothing else", () => {
    const _ok: WritePayload<Task> = {
      type: "inc",
      path: "priority",
      amount: 1,
      where: { id: "1" },
    };
    const _absent: WritePayload<Task> = {
      type: "inc",
      // @ts-expect-error: inc must name the number property it moves
      path: undefined,
      amount: 1,
      where: { id: "1" },
    };
  });
});

describe("Scoping into an array of objects", () => {

  it("checks the nested action against the element type at that scope", () => {
    const _ok: WritePayload<Task> = {
      type: "array_scope",
      scope: "subs",
      action: { type: "update", data: { hint: "h" }, where: { sid: "s1" } },
      where: { id: "1" },
    };
    const _wrongKey: WritePayload<Task> = {
      type: "array_scope",
      scope: "subs",
      // @ts-expect-error: 'title' belongs to the task, not to a sub
      action: { type: "update", data: { title: "t" }, where: { sid: "s1" } },
      where: { id: "1" },
    };
  });

  it("scopes to a nested array through its parent array", () => {
    const _deep: WritePayload<Task> = {
      type: "array_scope",
      scope: "subs.items",
      action: { type: "create", data: { iid: "i1" } },
      where: { id: "1" },
    };
  });

  it("scopes to an array reachable only through an optional parent", () => {
    const _throughOptional: WritePayload<OptParent> = {
      type: "array_scope",
      scope: "box.rows",
      action: { type: "create", data: { rid: "r1" } },
      where: { id: "1" },
    };
  });

  it("holds its terms when written to one scope and read as any", () => {
    // A payload built for a single scope is still a payload of the whole shape. This only holds if
    // the union carries one variant per scope: a single variant covering every scope at once has to
    // reconcile the element types of all of them, and the nested action degrades to what they share.
    const scoped: WritePayloadArrayScope<Task, "subs"> = {
      type: "array_scope",
      scope: "subs",
      action: { type: "update", data: { hint: "h" }, where: { sid: "s1" } },
      where: { id: "1" },
    };
    const _widened: WritePayload<Task> = scoped;
  });
});

describe("Writing a whole property", () => {

  it("refuses to replace an array of objects, in any declaration flavour", () => {
    const _optional: WritePayload<WithOptObjArr> = {
      type: "update",
      // @ts-expect-error: an array of objects is edited element by element, with array_scope
      data: { children: [] },
      where: { id: "1" },
    };
    const _undefinable: WritePayload<WithOptObjArr> = {
      type: "update",
      // @ts-expect-error: an array of objects is edited element by element, with array_scope
      data: { audit: [] },
      where: { id: "1" },
    };
  });

  it("allows a property whose only value is null", () => {
    const _nulled: WritePayload<WithOptObjArr> = {
      type: "update",
      data: { nullOnly: null },
      where: { id: "1" },
    };
  });
});
