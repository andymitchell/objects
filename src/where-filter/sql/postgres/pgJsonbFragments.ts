/**
 * Pure Postgres JSONB SQL-fragment builders, shared by the translator's emitters.
 *
 * Each function returns a SQL string and holds no state, so the type-faithful jsonb comparisons and array
 * guards live in one place rather than being re-derived at every call site.
 */

/** Binds a scalar literal as a statement argument and returns its `$N` placeholder. */
export type BindValue = (value: string | number | boolean) => string;

/** Maps our $type names to Postgres jsonb_typeof() return values ('bool' → 'boolean'). */
export function mapTypeToPostgres(typeName: string): string {
    return typeName === 'bool' ? 'boolean' : typeName;
}

/**
 * Compare an array value's length, guarding the array-only `jsonb_array_length` against a non-array value.
 *
 * A `null | array` (or optional) field can hold a JSON null at runtime, on which `jsonb_array_length` errors
 * ("cannot get array length of a scalar"). A `CASE` — not `AND`, since Postgres does not guarantee operand
 * evaluation order and could still run the length function on the null — yields `false` for any non-array,
 * reproducing the value-driven JS matcher, which never reports a size for a non-array.
 */
export function arraySizeEquals(jsonbExpr: string, placeholder: string): string {
    return `CASE WHEN jsonb_typeof(${jsonbExpr}) = 'array' THEN jsonb_array_length(${jsonbExpr}) = ${placeholder} ELSE false END`;
}

/**
 * Coerce a jsonb expression to an array before spreading it with `jsonb_array_elements`.
 *
 * A non-array source (a JSON null under a nullable-array field) errors ("cannot extract elements from a
 * scalar"); coercing it to an empty array spreads to zero rows instead, reproducing the value-driven JS
 * matcher, which finds no elements in a non-array.
 */
export function guardedJsonbArray(jsonbExpr: string): string {
    return `CASE WHEN jsonb_typeof(${jsonbExpr}) = 'array' THEN ${jsonbExpr} ELSE '[]'::jsonb END`;
}

/** Bind a scalar and wrap it as JSONB of its own type, so equality stays type-faithful (JSON `true` ≠ `1` ≠ `"true"`). */
export function toJsonbParam(value: string | number | boolean, bind: BindValue): string {
    const placeholder = bind(value);
    const cast = typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'numeric' : 'text';
    return `to_jsonb(${placeholder}::${cast})`;
}

/**
 * Translate JS RegExp flags ($options) into a Postgres embedded-option prefix `(?…)`, so `col ~ '(?…)pattern'`
 * reproduces `new RegExp(pattern, $options).test(value)`. Newline-sensitivity is chosen to match JS: 'm' makes
 * `^`/`$` match at line boundaries; 's' makes `.` match a newline; the base (neither) keeps `.` off newlines and
 * `^`/`$` at the string ends. Returns undefined for a flag Postgres cannot faithfully express (→ skip).
 */
export function pgRegexOptionPrefix(options: string | undefined): string | undefined {
    const flags = new Set([...(options ?? '')]);
    const i = flags.delete('i');
    const m = flags.delete('m');
    const s = flags.delete('s');
    if (flags.size > 0) return undefined; // a flag (g/u/y/…) with no faithful Postgres equivalent
    // Newline-sensitivity letter: (m,s)→w, (m,!s)→n, (!m,s)→s, (!m,!s)→p.
    const nl = m ? (s ? 'w' : 'n') : (s ? 's' : 'p');
    return `(?${i ? 'i' : ''}${nl})`;
}
