import {
    getZodKind,
    getSchemaChildren,
    type AnyZodSchema,
} from "../zod/introspection.ts";

/** How a path's schema rewrites the value a schema-driven backend would otherwise read verbatim. */
type NormalizationReason = "coerce" | "transform" | "pipe";

/**
 * One field whose declared schema normalizes the value on parse — a `z.coerce.*` flag or a transform / pipe /
 * preprocess node — so the value a consumer reads back differs from the raw stored value.
 */
export type SchemaNormalization = {
    /** Dot-prop path of the normalizing field (array elements and union variants are nameless, matching the SQL node map). */
    dotprop_path: string;
    /** Which normalization the path carries, for a debuggable message. */
    reason: NormalizationReason;
};

/**
 * Find every path whose schema normalizes a value a schema-driven backend cannot replicate — a `z.coerce.*` field,
 * or a transform / pipe / preprocess node.
 *
 * Why: the value-driven JS matcher (`matchJavascriptObject`) compares the raw stored value, while a schema-driven
 * SQL emitter casts per the declared type. A normalizing schema makes the two disagree even on conforming data —
 * `z.coerce.number()` accepts the stored string `'1'`, which the matcher's strict `===` rejects against `1` but a
 * `::numeric` cast matches. The value the matcher sees and the value SQL compares are no longer the same value, so
 * a path that normalizes is the lowest-common-denominator boundary callers opting into universal schema conformance
 * must reject. `.refine()`, `.default()`, `.catch()` and other transparent wrappers are NOT normalizations — they
 * validate or supply a fallback without rewriting a present, conforming value — and are descended through.
 *
 * @example
 * findNormalizingPaths(z.object({ id: z.string(), n: z.coerce.number() }));
 * // [{ dotprop_path: 'n', reason: 'coerce' }]
 */
export function findNormalizingPaths(schema: AnyZodSchema): SchemaNormalization[] {
    const out = new Map<string, NormalizationReason>();
    walk(schema, "", new Set(), out);
    return [...out].map(([dotprop_path, reason]) => ({ dotprop_path, reason }));
}

/**
 * Record a normalizing node at its path, else descend its children.
 *
 * Why: `ancestors` tracks only the current DFS stack, so a `z.lazy` self-reference (a schema reachable from itself)
 * is broken while a schema legitimately shared across sibling branches is still visited at each path.
 */
function walk(
    schema: AnyZodSchema,
    path: string,
    ancestors: Set<AnyZodSchema>,
    out: Map<string, NormalizationReason>,
): void {
    const reason = normalizationReason(schema);
    if (reason) {
        // First-write-wins keeps the shallowest reason per path; the whole field is rejected, so do not descend.
        if (!out.has(path)) out.set(path, reason);
        return;
    }
    if (ancestors.has(schema)) return;
    ancestors.add(schema);
    for (const child of getSchemaChildren(schema)) {
        const childPath =
            child.relation === "field" || child.relation === "item"
                ? path
                    ? `${path}.${child.key}`
                    : String(child.key)
                : path;
        walk(child.schema, childPath, ancestors, out);
    }
    ancestors.delete(schema);
}

/** Classify a single node's normalization, reading the coerce flag Zod stores on a primitive `_zod.def`. */
function normalizationReason(schema: AnyZodSchema): NormalizationReason | undefined {
    const kind = getZodKind(schema);
    if (kind === "transform") return "transform";
    // `.transform()`, `.pipe()` and `z.preprocess()` are all kind `pipe` (with a `transform` on one side).
    if (kind === "pipe") return "pipe";
    const def = schema._zod.def as { coerce?: boolean };
    if (def.coerce === true) return "coerce";
    return undefined;
}
