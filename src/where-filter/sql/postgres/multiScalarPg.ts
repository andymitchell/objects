import type { Predicate } from "../../ast/index.ts";
import type { ValueComparisonRangeOperatorsTyped } from "../../types.ts";
import { ValueComparisonRangeOperatorsSqlFunctions } from "../sharedSqlOperators.ts";

/**
 * Emit a comparison against a Postgres JSONB field whose union mixes several scalar kinds
 * (`boolean | number | string`).
 *
 * Such a field has no single column type to cast to, so every equality is decided against the RAW jsonb value
 * (`to_jsonb` keeps JSON `true` ≠ `1` ≠ `"true"`, matching matchJavascriptObject's `===`), and every range
 * comparison is bracketed to the operand's own type: a value of another type is a definite non-match rather than
 * a cast error, which keeps an enclosing `NOT` sound under SQL three-valued logic.
 *
 * @param predicate The field condition.
 * @param rawId An expression yielding the stored value as raw jsonb (`col->'x'`, never text-extracted).
 * @param toJsonbParam Binds a scalar literal and wraps it as jsonb of its own type (`to_jsonb($N::cast)`).
 * @param bindPlaceholder Binds a scalar literal as a bare `$N` placeholder, for a range's typed value comparison.
 * @returns The comparison, or `undefined` when the predicate is not one this strict reading answers — `$exists`,
 *   `$type`, `$not` and `$regex` fall through to the ordinary typed handling.
 *
 * @example
 * emitMultiScalarPgComparison({ kind: 'scalar', value: true }, "col->'k'", toJsonbParam, bind);
 * // → `(col->'k' IS NOT NULL AND col->'k' = to_jsonb($1::boolean))` — a stored `1` does not match
 */
export function emitMultiScalarPgComparison(
    predicate: Predicate,
    rawId: string,
    toJsonbParam: (value: string | number | boolean) => string,
    bindPlaceholder: (value: string | number | boolean) => string,
): string | undefined {
    switch (predicate.kind) {
        case 'scalar':
            // A bare `{ field: null }` names absence or a stored JSON null — match SQL NULL (missing path) or the
            // JSON null, never the first-arm typed cast that would error on a string/number row.
            if (predicate.value === null) return `(${rawId} IS NULL OR ${rawId} = 'null'::jsonb)`;
            return `(${rawId} IS NOT NULL AND ${rawId} = ${toJsonbParam(predicate.value)})`;
        case 'eq':
            if (predicate.operand === null) return `(${rawId} IS NULL OR ${rawId} = 'null'::jsonb)`;
            // Nothing equals NaN — short-circuit to a constant rather than binding NaN as jsonb. See MONGO-DIVERGENCES.md §7.
            if (typeof predicate.operand === 'number' && Number.isNaN(predicate.operand)) return '1 = 0';
            return `(${rawId} IS NOT NULL AND ${rawId} = ${toJsonbParam(predicate.operand)})`;
        case 'ne':
            // "ne matches missing" like matchJavascriptObject; `$ne: null` matches every value.
            if (predicate.operand === null) return '1 = 1';
            // NaN equals nothing, so $ne: NaN matches every value — short-circuit before the strict path. See MONGO-DIVERGENCES.md §7.
            if (typeof predicate.operand === 'number' && Number.isNaN(predicate.operand)) return '1 = 1';
            return `(${rawId} IS NULL OR ${rawId} != ${toJsonbParam(predicate.operand as string | number | boolean)})`;
        case 'in':
            if (predicate.operand.length === 0) return '1 = 0';
            return `(${rawId} IS NOT NULL AND ${rawId} IN (${predicate.operand.map(v => toJsonbParam(v as string | number | boolean)).join(', ')}))`;
        case 'nin':
            if (predicate.operand.length === 0) return '1 = 1';
            return `(${rawId} IS NULL OR ${rawId} NOT IN (${predicate.operand.map(v => toJsonbParam(v as string | number | boolean)).join(', ')}))`;
        case 'range': {
            // A range operand applies only to a stored value of the operand's own type — matchJavascriptObject
            // throws when the runtime types differ. Compare within that type in the THEN; any other stored type
            // hits the ELSE and is a definite non-match (never a silent coercion, never a cast error).
            const operandIsNumber = typeof predicate.bounds[0]?.operand === 'number';
            const valueExpr = `(${rawId} #>> '{}')${operandIsNumber ? '::numeric' : ''}`;
            const comparisons = predicate.bounds.map(bound => {
                if (typeof bound.operand === 'number' && Number.isNaN(bound.operand)) return '1=0'; // MongoDB: every comparison with NaN is false. See MONGO-DIVERGENCES.md §7.
                return ValueComparisonRangeOperatorsSqlFunctions[bound.operator as ValueComparisonRangeOperatorsTyped](valueExpr, bindPlaceholder(bound.operand as string | number | boolean));
            });
            const body = comparisons.length > 1 ? `(${comparisons.join(' AND ')})` : comparisons[0]!;
            return `CASE WHEN jsonb_typeof(${rawId}) = '${operandIsNumber ? 'number' : 'string'}' THEN ${body} ELSE false END`;
        }
        default:
            return undefined;
    }
}
