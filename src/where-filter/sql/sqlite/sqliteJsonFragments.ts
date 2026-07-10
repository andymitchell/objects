/** Binds a value as a positional statement argument, returning the `?` that stands for it. */
export type BindValue = (value: unknown) => string;

/** Narrow an operand to the scalar kinds a SQL comparison can bind. */
export function asScalarOperand(value: unknown): string | number | boolean {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    throw new Error("Placeholders for SQL can only be string/number/boolean");
}

/**
 * Compare an array's length, guarding the array-only `json_array_length` against a non-array or missing value.
 *
 * SQLite's `json_array_length` does not error on a non-array — it returns 0 — so a `null | array` field holding a
 * JSON null would make `{$size: 0}` spuriously match. A `CASE` (rather than an `AND`) yields a DEFINITE `false`
 * for every non-array and for a missing path: under `AND`, a missing path leaves `json_type = 'array'` as SQL
 * NULL, which does not negate and so breaks `$nor` and any enclosing negation. This reproduces the value-driven
 * matcher, which reports no size for a non-array or absent field.
 */
export function arraySizeEquals(sourceExpr: string, pathLiteral: string, placeholder: string): string {
    return `CASE WHEN json_type(${sourceExpr}, ${pathLiteral}) = 'array' THEN json_array_length(${sourceExpr}, ${pathLiteral}) = ${placeholder} ELSE 0 END`;
}

/** json_type tags a JSON number as `integer` or `real`, and a JSON boolean as `true` or `false`. */
const JSON_TYPE_TAGS: Record<string, string> = {
    'string': 'text',
    'object': 'object',
    'array': 'array',
    'null': 'null',
};

/**
 * A `$type` check, as a comparison of the value's json_type tag.
 *
 * @param columnExpr An expression yielding JSON to address.
 * @param pathLiteral The quoted JSON path of the value within it.
 * @param typeName The type asked for.
 * @param bind Binds a literal as a statement argument.
 * @returns A definite boolean SQL expression. `number` accepts both of json_type's numeric tags, and `bool` both
 *   of its boolean tags (divergence #5).
 */
export function jsonTypeTest(columnExpr: string, pathLiteral: string, typeName: string, bind: BindValue): string {
    if (typeName === 'number') return `json_type(${columnExpr}, ${pathLiteral}) IN (${bind('integer')}, ${bind('real')})`;
    if (typeName === 'bool') return `json_type(${columnExpr}, ${pathLiteral}) IN (${bind('true')}, ${bind('false')})`;
    return `json_type(${columnExpr}, ${pathLiteral}) = ${bind(JSON_TYPE_TAGS[typeName] ?? typeName)}`;
}

/**
 * Key-order-insensitive deep equality of a stored JSON value against a literal object or array.
 *
 * SQLite's `json()`/`jsonb()` comparison preserves object key order, so a reordered-but-equal object would wrongly
 * differ — and comparing serialized text would additionally make whitespace significant. Instead compare the two
 * values' `json_tree` node sets: two JSON values are deeply equal iff they expose the same set of `(fullkey, type,
 * atom)` nodes. `fullkey` encodes the structural path (object keys AND array indices), so key order is irrelevant
 * while array order and scalar types stay significant. Emitted as a mutual `NOT EXISTS` set-difference, which is
 * exact because each tree's fullkeys are unique. This matches the value-driven matcher's `deepEql` and Postgres's
 * `jsonb` equality.
 *
 * @param accessorExpr An expression yielding valid JSON text. A missing path is SQL NULL, and `json_tree(NULL)`
 *   yields no rows — a definite non-match.
 * @param value The literal to compare against.
 * @param bind Binds a literal as a statement argument.
 */
export function jsonDeepEquals(accessorExpr: string, value: unknown, bind: BindValue): string {
    const literalA = bind(value);
    const literalB = bind(value);
    return `NOT EXISTS (SELECT s.fullkey, s.type, s.atom FROM json_tree(${accessorExpr}) s EXCEPT SELECT a.fullkey, a.type, a.atom FROM json_tree(${literalA}) a) `
        + `AND NOT EXISTS (SELECT b.fullkey, b.type, b.atom FROM json_tree(${literalB}) b EXCEPT SELECT s.fullkey, s.type, s.atom FROM json_tree(${accessorExpr}) s)`;
}

/**
 * Strict JSON value-equality of one scalar: the json_type tag AND the value.
 *
 * SQLite reads a stored JSON `true` and a stored `1` back as the same `1`, so a comparison on the extracted value
 * alone conflates them — as it conflates the number `7` with the string `"7"`. Naming the type tag alongside the
 * value reproduces the value-driven matcher's `===`.
 *
 * @param typeExpr An expression yielding the value's json_type tag.
 * @param valueExpr An expression yielding the extracted value.
 * @param value The scalar to compare against.
 * @param bind Binds a literal as a statement argument.
 */
export function strictJsonValueEquals(typeExpr: string, valueExpr: string, value: string | number | boolean, bind: BindValue): string {
    if (typeof value === 'boolean') return `${typeExpr} = '${value ? 'true' : 'false'}'`;
    const placeholder = bind(value);
    if (typeof value === 'number') return `(${typeExpr} IN ('integer', 'real') AND ${valueExpr} = ${placeholder})`;
    return `(${typeExpr} = 'text' AND ${valueExpr} = ${placeholder})`;
}
