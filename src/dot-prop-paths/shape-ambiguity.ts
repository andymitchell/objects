import {
    getZodKind,
    unwrap,
    isTransparentWrapper,
    getArrayElement,
    getObjectShape,
    getUnionOptions,
    isDiscriminatedUnion,
    getLiteralValues,
    getEnumValues,
    type ZodKind,
    type AnyZodSchema,
} from "../zod/introspection.ts";

/** Scalar JSON leaf kinds — text/number/bool values a schema-driven engine compares by strict equality. */
type ScalarKind = "string" | "number" | "boolean";

/** One top-level shape an alternative can occupy at a path — the unit the array-coexistence rule decides over. */
type Occupant =
    | { category: "array" }
    | { category: "object" }
    | { category: "null" }
    | { category: "scalar"; scalarKind: ScalarKind }
    | { category: "other" };

/**
 * One field whose declared schema is shape-ambiguous: at the same dot-prop path it admits an array shape AND a
 * non-array (scalar or object) shape, which a schema-driven engine cannot represent.
 */
export type ShapeAmbiguity = {
    /** Dot-prop path of the offending field (array elements and union variants are nameless, matching the SQL node map). */
    dotprop_path: string;
    /** The colliding top-level kinds at the path — an array kind plus ≥1 non-array (scalar or object) — for a debuggable message. */
    arm_kinds: ZodKind[];
};

/**
 * One field whose declared union mixes ≥2 distinct scalar kinds (and no array/object arm) — e.g.
 * `z.union([z.boolean(), z.number(), z.string()])`. A schema-driven engine cannot pick one column type for it, so
 * it must compare the field as a raw JSON value rather than a single typed cast.
 */
export type MultiScalarUnion = {
    dotprop_path: string;
    /** The distinct scalar kinds the field can take (≥2). */
    scalar_kinds: ScalarKind[];
};

/**
 * Find every path that can be an array AND a non-array (scalar or object) at the same place — e.g.
 * `z.union([z.string(), z.array(z.string())])`, or a field that is a scalar in one object arm and an array in a
 * sibling arm (`z.union([z.object({ v: z.string() }), z.object({ v: z.array(z.string()) })])`).
 *
 * Why: the value-driven JS matcher (`matchJavascriptObject`) and the schema-driven SQL emitter agree only on an
 * unambiguous schema. When a path can be both an array and a non-array, the emitter faces an irreversible
 * spread-vs-cast choice it cannot settle from the schema alone — so the path is the lowest-common-denominator
 * boundary callers opting into universal schema conformance must reject. Alternatives are gathered across union
 * arms AND the same field across sibling object arms (so a cross-arm collision is caught), nested unions are
 * flattened, a null-valued literal counts as null (so `literal(null) | array` is the supported nullable array), a
 * tuple counts as an array and a discriminated union as an object (so `tuple | object` and
 * `discriminatedUnion | array` are caught); scalar|scalar, array|array, array|null, object|null, scalar|object and
 * a bare discriminated union are all representable and pass.
 *
 * @example
 * findShapeAmbiguousPaths(z.object({ owner: z.union([z.string(), z.array(z.string())]) }));
 * // [{ dotprop_path: 'owner', arm_kinds: ['string', 'array'] }]
 */
export function findShapeAmbiguousPaths(schema: AnyZodSchema): ShapeAmbiguity[] {
    return analyze(schema).ambiguous;
}

/**
 * Find every path whose alternatives mix ≥2 distinct scalar kinds and no array/object arm (e.g.
 * `z.union([z.boolean(), z.number(), z.string(), z.null()])`, including a field that is a string in one object arm
 * and a number in a sibling arm).
 *
 * Why: a schema-driven SQL emitter casts a column to one type from the schema; a multi-scalar path has no single
 * type, so a first-arm cast (e.g. `::boolean`) would coerce other scalars (`'1'`/`'true'`) loosely and cast-error
 * on arbitrary strings — diverging from the JS matcher's strict `===`. The emitter must instead compare the path
 * as a raw JSON value. A single-scalar-kind`|null` union (`boolean|null`, `string|null`) is excluded — its single
 * cast is already faithful — as is any array/non-array path (that is shape-ambiguous, rejected separately).
 *
 * @example
 * findMultiScalarUnionPaths(z.object({ secret: z.union([z.boolean(), z.number(), z.string()]) }));
 * // [{ dotprop_path: 'secret', scalar_kinds: ['boolean', 'number', 'string'] }]
 */
export function findMultiScalarUnionPaths(schema: AnyZodSchema): MultiScalarUnion[] {
    const { ambiguous, multiScalar } = analyze(schema);
    const ambiguousPaths = new Set(ambiguous.map((a) => a.dotprop_path));
    // A shape-ambiguous path is rejected up-front, so never report it as multi-scalar too.
    return multiScalar.filter((m) => !ambiguousPaths.has(m.dotprop_path));
}

/** Single walk producing both analyses (deduped by path) so the two detectors share one traversal. */
function analyze(schema: AnyZodSchema): { ambiguous: ShapeAmbiguity[]; multiScalar: MultiScalarUnion[] } {
    const ambiguous = new Map<string, ZodKind[]>();
    const multiScalar = new Map<string, ScalarKind[]>();
    walkAlternatives([schema], "", ambiguous, multiScalar);
    return {
        ambiguous: [...ambiguous].map(([dotprop_path, arm_kinds]) => ({ dotprop_path, arm_kinds })),
        multiScalar: [...multiScalar].map(([dotprop_path, scalar_kinds]) => ({ dotprop_path, scalar_kinds })),
    };
}

/**
 * Classify the alternatives reaching one path, flag any array/non-array collision, then descend.
 *
 * Why: a path's shape must be judged across ALL its alternatives at once — union arms AND the same field across
 * sibling object arms share one path, so a scalar in one arm and an array in another collide even though no single
 * arm is both (the cross-arm miss earlier rounds reasoned about union nodes locally and never saw). An array
 * CONTAINER and its nameless ELEMENT are walked as separate calls at the same path, so a plain `array(scalar)`
 * never looks like a scalar+array collision.
 */
function walkAlternatives(
    schemas: readonly AnyZodSchema[],
    path: string,
    ambiguous: Map<string, ZodKind[]>,
    multiScalar: Map<string, ScalarKind[]>,
): void {
    const flat = flatten(schemas);
    const occupants = occupantShapes(flat);
    const hasArray = occupants.some((o) => o.category === "array");
    const hasObject = occupants.some((o) => o.category === "object");
    const hasScalar = occupants.some((o) => o.category === "scalar");
    const scalarKinds = new Set<ScalarKind>(
        occupants.flatMap((o) => (o.category === "scalar" ? [o.scalarKind] : [])),
    );

    if (hasArray && (hasScalar || hasObject)) {
        // First-write-wins keeps the shallowest collision per path; arm_kinds spans the flattened alternatives.
        if (!ambiguous.has(path)) ambiguous.set(path, distinctKinds(flat));
    } else if (!hasArray && !hasObject && scalarKinds.size >= 2 && !ambiguous.has(path)) {
        multiScalar.set(path, [...scalarKinds]);
    }

    // Descend object arms together so a field shared across sibling object arms is judged at one path (the cross-arm fix).
    const objectArms = flat.filter((s) => getZodKind(s) === "object");
    if (objectArms.length > 0) {
        const keys = new Set<string>();
        for (const arm of objectArms) for (const key of Object.keys(getObjectShape(arm))) keys.add(key);
        for (const key of keys) {
            const children: AnyZodSchema[] = [];
            for (const arm of objectArms) {
                const shape = getObjectShape(arm);
                if (key in shape) children.push(shape[key]!);
            }
            walkAlternatives(children, path ? `${path}.${key}` : key, ambiguous, multiScalar);
        }
    }

    // Descend array elements as one nameless call at the same path, merging every array arm's element.
    const arrayArms = flat.filter((s) => getZodKind(s) === "array");
    if (arrayArms.length > 0) walkAlternatives(arrayArms.map(getArrayElement), path, ambiguous, multiScalar);
}

/** Step through transparent wrappers and expand non-discriminated unions, leaving concrete shapes to classify. */
function flatten(schemas: readonly AnyZodSchema[]): AnyZodSchema[] {
    const out: AnyZodSchema[] = [];
    for (const schema of schemas) {
        const kind = getZodKind(schema);
        if (isTransparentWrapper(kind)) out.push(...flatten([unwrap(schema)]));
        else if (kind === "union" && !isDiscriminatedUnion(schema)) out.push(...flatten(getUnionOptions(schema)));
        else out.push(schema);
    }
    return out;
}

/**
 * Map each already-flattened schema to the top-level shape(s) it can occupy.
 *
 * Why: a tuple is an array and a discriminated union is an object for representability — leaving them opaque (their
 * old `other` classification) silently hid `tuple | object` and `discriminatedUnion | array` collisions. Their
 * contents stay opaque (not descended) so a bare tuple/DU is one category and is not over-flagged. An enum is
 * classified by its members' runtime types (a numeric enum is number-scalar), so a `string | enum(numeric)` union is
 * correctly seen as multi-scalar rather than one string column.
 */
function occupantShapes(flat: readonly AnyZodSchema[]): Occupant[] {
    const out: Occupant[] = [];
    for (const schema of flat) {
        const kind = getZodKind(schema);
        if (kind === "array" || kind === "tuple") out.push({ category: "array" });
        else if (kind === "object" || kind === "record" || (kind === "union" && isDiscriminatedUnion(schema)))
            out.push({ category: "object" });
        else if (kind === "null" || kind === "undefined" || kind === "void") out.push({ category: "null" });
        else if (kind === "string" || kind === "number" || kind === "boolean")
            out.push({ category: "scalar", scalarKind: kind });
        else if (kind === "enum") out.push(...getEnumValues(schema).map(literalShape)); // classify by member runtime type — a numeric enum is number-scalar, not string
        else if (kind === "literal") out.push(...getLiteralValues(schema).map(literalShape));
        else out.push({ category: "other" }); // lazy, bigint, date, custom, … contribute no representable shape
    }
    return out;
}

/** Classify a single literal value by its runtime type — a null/undefined literal is null, never scalar. */
function literalShape(value: unknown): Occupant {
    if (value === null || value === undefined) return { category: "null" };
    if (typeof value === "string") return { category: "scalar", scalarKind: "string" };
    if (typeof value === "number") return { category: "scalar", scalarKind: "number" };
    if (typeof value === "boolean") return { category: "scalar", scalarKind: "boolean" };
    return { category: "other" }; // bigint, symbol, object literal, …
}

/** Distinct top-level kinds among the flattened alternatives, for a human-readable collision message. */
function distinctKinds(flat: readonly AnyZodSchema[]): ZodKind[] {
    return [...new Set(flat.map(getZodKind))];
}
