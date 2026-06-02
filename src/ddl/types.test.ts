import { describe, it, expectTypeOf } from "vitest";
import type {
  DDL,
  DDLRoot,
  ListRules,
  ListRulesCore,
  RootListRules,
  SortableKeyRule,
} from "./types.ts";
import type { resolveDdlListRules } from "./resolveDdlListRules.ts";
import type { SortEntry } from "../query/types.ts";
import type { OwnershipRule } from "../ownership/types.ts";
import type {
  DotPropPathsUnion,
  PrimaryKeyProperties,
} from "../dot-prop-paths/types.ts";

// ═══════════════════════════════════════════════════════════════════
// Fixtures — collection shapes that exercise the DDL contract
// ═══════════════════════════════════════════════════════════════════

/** Flat collection: no arrays, so the root "." list is the only list scope. */
type Flat = { id: string; name: string; rank: number; active?: boolean };

/** Flat collection with a scalar array — a scalar array is NOT a list scope. */
type WithTags = { id: string; label: string; tags: string[] };

/** One level of object array — yields a single nested list scope. */
type Nested = {
  id: string;
  title: string;
  rows: { rid: string; weight: number; note?: string }[];
};

/** Object array inside object array — yields two nested, dotted list scopes. */
type Deep = {
  id: string;
  groups: { gid: string; items: { iid: string; qty: number }[] }[];
};

/** Collection with an identifier field usable by a `basic` ownership rule. */
type Owned = { id: string; owner_id: string };

// ═══════════════════════════════════════════════════════════════════
// 1. Authoring a DDL document
// ═══════════════════════════════════════════════════════════════════

describe("Authoring a DDL document", () => {
  it("accepts a complete flat-collection DDL", () => {
    const _ddl: DDL<Flat> = {
      version: 1,
      lists: {
        ".": {
          primary_key: "id",
          default_ordering_key: { key: "id", direction: 1 },
        },
      },
      ownership: { type: "none" },
    };
  });

  it("rejects a document that omits the version", () => {
    // @ts-expect-error: version is required
    const _ddl: DDL<Flat> = {
      lists: {
        ".": {
          primary_key: "id",
          default_ordering_key: { key: "id", direction: 1 },
        },
      },
      ownership: { type: "none" },
    };
  });

  it("rejects a document that omits the ownership rule", () => {
    // @ts-expect-error: ownership is required
    const _ddl: DDL<Flat> = {
      version: 1,
      lists: {
        ".": {
          primary_key: "id",
          default_ordering_key: { key: "id", direction: 1 },
        },
      },
    };
  });

  it("rejects a document that omits the list map", () => {
    // @ts-expect-error: lists is required
    const _ddl: DDL<Flat> = {
      version: 1,
      ownership: { type: "none" },
    };
  });

  it("rejects unknown top-level properties on the document", () => {
    const _ddl: DDL<Flat> = {
      version: 1,
      lists: {
        ".": {
          primary_key: "id",
          default_ordering_key: { key: "id", direction: 1 },
        },
      },
      ownership: { type: "none" },
      // @ts-expect-error: 'extra' is not part of the DDL document
      extra: true,
    };
  });

  it("is a DDL root extended with a list map", () => {
    const _root: DDLRoot<Flat> = {} as DDL<Flat>;
  });

  it("types the ownership field as the collection's ownership rule", () => {
    expectTypeOf<DDL<Owned>["ownership"]>().toEqualTypeOf<OwnershipRule<Owned>>();
  });

  it("accepts a basic ownership rule bound to an identifier field", () => {
    const _ddl: DDL<Owned> = {
      version: 1,
      lists: {
        ".": {
          primary_key: "id",
          default_ordering_key: { key: "id", direction: 1 },
        },
      },
      ownership: {
        type: "basic",
        property_type: "id",
        path: "owner_id",
        format: "uuid",
      },
    };
  });

  it("rejects a malformed ownership rule", () => {
    const _ddl: DDL<Owned> = {
      version: 1,
      lists: {
        ".": {
          primary_key: "id",
          default_ordering_key: { key: "id", direction: 1 },
        },
      },
      // @ts-expect-error: a 'basic' ownership rule requires property_type, path and format
      ownership: { type: "basic" },
    };
  });

  it("never lets a document field degrade to any", () => {
    expectTypeOf<DDL<Flat>["version"]>().not.toBeAny();
    expectTypeOf<DDL<Flat>["lists"]>().not.toBeAny();
    expectTypeOf<DDL<Flat>["ownership"]>().not.toBeAny();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. The list map keys
// ═══════════════════════════════════════════════════════════════════

describe("The list map keys", () => {
  it('always requires the whole-collection "." entry', () => {
    const _ddl: DDL<Flat> = {
      version: 1,
      // @ts-expect-error: the root '.' list is mandatory
      lists: {},
      ownership: { type: "none" },
    };
  });

  it("exposes only the root list for a collection with no object arrays", () => {
    expectTypeOf<keyof DDL<Flat>["lists"]>().toEqualTypeOf<".">();
  });

  it("does not expose a list scope for a scalar-array property", () => {
    expectTypeOf<keyof DDL<WithTags>["lists"]>().toEqualTypeOf<".">();
  });

  it("rejects a scalar-array property used as a list key", () => {
    const _ddl: DDL<WithTags> = {
      version: 1,
      lists: {
        ".": {
          primary_key: "id",
          default_ordering_key: { key: "id", direction: 1 },
        },
        // @ts-expect-error: 'tags' is a scalar array, not a list scope
        tags: { primary_key: "id" },
      },
      ownership: { type: "none" },
    };
  });

  it("exposes a list scope for each object-array path", () => {
    expectTypeOf<keyof DDL<Nested>["lists"]>().toEqualTypeOf<"." | "rows">();
  });

  it("spreads nested arrays so each deeply-nested object array is a list scope", () => {
    expectTypeOf<keyof DDL<Deep>["lists"]>().toEqualTypeOf<
      "." | "groups" | "groups.items"
    >();
  });

  it("rejects a list key that is not an object-array path of the collection", () => {
    const _ddl: DDL<Nested> = {
      version: 1,
      lists: {
        ".": {
          primary_key: "id",
          default_ordering_key: { key: "id", direction: 1 },
        },
        rows: { primary_key: "rid" },
        // @ts-expect-error: 'nonsense' is not an object-array path of Nested
        nonsense: { primary_key: "rid" },
      },
      ownership: { type: "none" },
    };
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. A list's primary key
// ═══════════════════════════════════════════════════════════════════

describe("A list's primary key", () => {
  it("is one of the collection's identifier-capable fields", () => {
    expectTypeOf<RootListRules<Flat>["primary_key"]>().toEqualTypeOf<
      PrimaryKeyProperties<Flat>
    >();
  });

  it("accepts a string identifier field", () => {
    const _ddl: DDL<Flat> = {
      version: 1,
      lists: {
        ".": {
          primary_key: "name",
          default_ordering_key: { key: "id", direction: 1 },
        },
      },
      ownership: { type: "none" },
    };
  });

  it("accepts a numeric identifier field", () => {
    const _ddl: DDL<Flat> = {
      version: 1,
      lists: {
        ".": {
          primary_key: "rank",
          default_ordering_key: { key: "id", direction: 1 },
        },
      },
      ownership: { type: "none" },
    };
  });

  it("rejects a property name absent from the collection", () => {
    const _ddl: DDL<Flat> = {
      version: 1,
      lists: {
        ".": {
          // @ts-expect-error: 'nonexistent' is not a property of Flat
          primary_key: "nonexistent",
          default_ordering_key: { key: "id", direction: 1 },
        },
      },
      ownership: { type: "none" },
    };
  });

  it("rejects a property that is neither a string nor a number", () => {
    const _ddl: DDL<Flat> = {
      version: 1,
      lists: {
        ".": {
          // @ts-expect-error: 'active' is a boolean, not an identifier-capable field
          primary_key: "active",
          default_ordering_key: { key: "id", direction: 1 },
        },
      },
      ownership: { type: "none" },
    };
  });

  it("on a nested list, is a field of the array element rather than the parent", () => {
    expectTypeOf<DDL<Nested>["lists"]["rows"]["primary_key"]>().toEqualTypeOf<
      PrimaryKeyProperties<Nested["rows"][number]>
    >();
  });

  it("rejects a parent-collection field as a nested primary key", () => {
    const _ddl: DDL<Nested> = {
      version: 1,
      lists: {
        ".": {
          primary_key: "id",
          default_ordering_key: { key: "id", direction: 1 },
        },
        // @ts-expect-error: 'id' belongs to Nested, not to a row element
        rows: { primary_key: "id" },
      },
      ownership: { type: "none" },
    };
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Ordering and sortable-key declarations
// ═══════════════════════════════════════════════════════════════════

describe("Ordering and sortable-key declarations", () => {
  it("declares the default ordering as a sort entry over the collection", () => {
    expectTypeOf<
      NonNullable<ListRules<Nested>["default_ordering_key"]>
    >().toEqualTypeOf<SortEntry<Nested>>();
  });

  it("allows the default ordering key to differ from the primary key", () => {
    const _ddl: DDL<Flat> = {
      version: 1,
      lists: {
        ".": {
          primary_key: "id",
          default_ordering_key: { key: "name", direction: -1 },
        },
      },
      ownership: { type: "none" },
    };
  });

  it("rejects an ordering key that is not a path of the collection", () => {
    const _ddl: DDL<Flat> = {
      version: 1,
      lists: {
        ".": {
          primary_key: "id",
          default_ordering_key: {
            // @ts-expect-error: 'nonsense' is not a dot-prop path of Flat
            key: "nonsense",
            direction: 1,
          },
        },
      },
      ownership: { type: "none" },
    };
  });

  it("rejects an ordering direction other than ascending or descending", () => {
    const _ddl: DDL<Flat> = {
      version: 1,
      lists: {
        ".": {
          primary_key: "id",
          default_ordering_key: {
            key: "id",
            // @ts-expect-error: direction must be 1 or -1
            direction: 0,
          },
        },
      },
      ownership: { type: "none" },
    };
  });

  it("leaves the sortable-keys allowlist optional and read-only", () => {
    expectTypeOf<ListRules<Flat>["sortable_keys"]>().toEqualTypeOf<
      ReadonlyArray<SortableKeyRule<Flat>> | undefined
    >();
  });

  it("accepts a sortable-key rule with an optional direction restriction", () => {
    const _ddl: DDL<Flat> = {
      version: 1,
      lists: {
        ".": {
          primary_key: "id",
          default_ordering_key: { key: "id", direction: 1 },
          // `direction` omitted = both directions; `1`/`-1` restricts.
          sortable_keys: [{ key: "name" }, { key: "rank", direction: -1 }],
        },
      },
      ownership: { type: "none" },
    };
    expect(_ddl.lists["."].sortable_keys?.[1]?.direction).toBe(-1);
  });

  it("rejects an out-of-range direction on a sortable-key rule", () => {
    const _ddl: DDL<Flat> = {
      version: 1,
      lists: {
        ".": {
          primary_key: "id",
          default_ordering_key: { key: "id", direction: 1 },
          // @ts-expect-error: direction must be 1 | -1
          sortable_keys: [{ key: "title", direction: 2 }],
        },
      },
      ownership: { type: "none" },
    };
    expect(_ddl).toBeDefined();
  });

  it("accepts an empty sortable-keys allowlist", () => {
    const _ddl: DDL<Flat> = {
      version: 1,
      lists: {
        ".": {
          primary_key: "id",
          default_ordering_key: { key: "id", direction: 1 },
          sortable_keys: [],
        },
      },
      ownership: { type: "none" },
    };
  });

  it("rejects a sortable key that is not a path of the collection", () => {
    const _ddl: DDL<Flat> = {
      version: 1,
      lists: {
        ".": {
          primary_key: "id",
          default_ordering_key: { key: "id", direction: 1 },
          // @ts-expect-error: 'nonsense' is not a dot-prop path of Flat
          sortable_keys: [{ key: "nonsense" }],
        },
      },
      ownership: { type: "none" },
    };
  });

  it("rejects unknown properties on a list rule", () => {
    const _ddl: DDL<Flat> = {
      version: 1,
      lists: {
        ".": {
          primary_key: "id",
          default_ordering_key: { key: "id", direction: 1 },
          // @ts-expect-error: 'bogus' is not part of a list rule
          bogus: true,
        },
      },
      ownership: { type: "none" },
    };
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Root vs nested list rules
// ═══════════════════════════════════════════════════════════════════

describe("Root vs nested list rules", () => {
  it('types the root "." list as the root list rules', () => {
    expectTypeOf<DDL<Flat>["lists"]["."]>().toEqualTypeOf<RootListRules<Flat>>();
  });

  it("exposes the root list rules for an unresolved generic collection type", () => {
    // Pins the deferred-conditional case: for a bare generic T, DDL<T>['lists']['.']
    // must stay RootListRules<T>, never widen to a RootListRules<any> | RootListRules<T> union.
    function _rootRulesOf<T extends Record<string, any>>(ddl: DDL<T>): RootListRules<T> {
      return ddl.lists["."];
    }
    // _rootRulesOf's return type IS the assertion; reference it so noUnusedLocals stays quiet.
    expect(typeof _rootRulesOf).toBe("function");
  });

  it("types a nested list as list rules over the array element type", () => {
    expectTypeOf<DDL<Nested>["lists"]["rows"]>().toEqualTypeOf<
      ListRules<Nested["rows"][number]>
    >();
  });

  it("requires a default ordering key on the root list", () => {
    const _ddl: DDL<Flat> = {
      version: 1,
      lists: {
        // @ts-expect-error: default_ordering_key is mandatory on the root '.' list
        ".": { primary_key: "id" },
      },
      ownership: { type: "none" },
    };
  });

  it("does not require a default ordering key on a nested list", () => {
    const _ddl: DDL<Nested> = {
      version: 1,
      lists: {
        ".": {
          primary_key: "id",
          default_ordering_key: { key: "id", direction: 1 },
        },
        rows: { primary_key: "rid" },
      },
      ownership: { type: "none" },
    };
  });

  it("makes the default ordering key required on the root form", () => {
    expectTypeOf<
      RootListRules<Flat>["default_ordering_key"]
    >().toEqualTypeOf<SortEntry<Flat>>();
  });

  it("leaves the default ordering key optional on the public list form", () => {
    expectTypeOf<ListRules<Flat>["default_ordering_key"]>().toEqualTypeOf<
      SortEntry<Flat> | undefined
    >();
  });

  it("treats every root list rule as a valid list rule", () => {
    const _asList: ListRules<Flat> = {} as RootListRules<Flat>;
  });

  it("does not treat a public list rule as a valid root list rule", () => {
    // @ts-expect-error: ListRules may omit default_ordering_key, RootListRules may not
    const _asRoot: RootListRules<Flat> = {} as ListRules<Flat>;
  });

  it("tightens exactly the default ordering key and nothing else", () => {
    expectTypeOf<
      Omit<RootListRules<Flat>, "default_ordering_key">
    >().toEqualTypeOf<Omit<ListRules<Flat>, "default_ordering_key">>();
  });

  it("treats the public list rules as the same contract as its core", () => {
    expectTypeOf<ListRules<Flat>>().toEqualTypeOf<ListRulesCore<Flat>>();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. A DDL for an unconstrained collection (any)
// ═══════════════════════════════════════════════════════════════════

describe("A DDL for an unconstrained collection (any)", () => {
  it("collapses the list map to just the root list", () => {
    expectTypeOf<keyof DDL<any>["lists"]>().toEqualTypeOf<".">();
  });

  it("widens the root primary key to a plain string", () => {
    expectTypeOf<DDL<any>["lists"]["."]["primary_key"]>().toEqualTypeOf<string>();
  });

  it("still requires the version", () => {
    // @ts-expect-error: version is required even for DDL<any>
    const _ddl: DDL<any> = {
      lists: {
        ".": {
          primary_key: "id",
          default_ordering_key: { key: "id", direction: 1 },
        },
      },
      ownership: { type: "none" },
    };
  });

  it("still requires a default ordering key on the root list", () => {
    const _ddl: DDL<any> = {
      version: 1,
      lists: {
        // @ts-expect-error: default_ordering_key is mandatory on the root '.' list
        ".": { primary_key: "id" },
      },
      ownership: { type: "none" },
    };
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Resolving list rules from a DDL
// ═══════════════════════════════════════════════════════════════════

describe("Resolving list rules from a DDL", () => {
  it("returns either a list rule or undefined", () => {
    expectTypeOf<ReturnType<typeof resolveDdlListRules>>().toEqualTypeOf<
      ListRules<any> | undefined
    >();
  });

  it("never returns a rule that has degraded to any", () => {
    expectTypeOf<
      NonNullable<ReturnType<typeof resolveDdlListRules>>
    >().not.toBeAny();
  });

  it("accepts any string as the path argument", () => {
    expectTypeOf<
      Parameters<typeof resolveDdlListRules>[1]
    >().toEqualTypeOf<string>();
  });
});
