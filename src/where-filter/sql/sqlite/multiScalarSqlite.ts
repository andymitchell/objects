import type { Predicate } from "../../ast/index.ts";
import { ValueComparisonRangeOperatorsSqlFunctions } from "../sharedSqlOperators.ts";
import { asScalarOperand, strictJsonValueEquals } from "./sqliteJsonFragments.ts";
import type { BindValue } from "./sqliteJsonFragments.ts";

/**
 * Emit a comparison against a field whose union mixes several scalar kinds (`boolean | number | string`).
 *
 * Such a field has no single SQL type to compare in, so every equality is decided by json_type tag plus value, and
 * every range comparison is bracketed to the operand's own type: a value of another type is a definite non-match
 * rather than an error, which keeps an enclosing `NOT` sound under SQL three-valued logic.
 *
 * @param predicate The field condition.
 * @param typeExpr An expression yielding the stored value's json_type tag.
 * @param valueExpr An expression yielding the stored value.
 * @param bind Binds a literal as a statement argument.
 * @returns The comparison, or `undefined` when the predicate is not one this strict reading answers — a bare
 *   `null` (which names absence rather than a scalar arm), `$exists`, `$type`, `$not` and `$regex` all fall
 *   through to the ordinary typed handling.
 *
 * @example
 * emitMultiScalarComparison({ kind: 'scalar', value: true }, typeExpr, valueExpr, bind);
 * // → `typeExpr = 'true'` — a stored `1` does not match
 */
export function emitMultiScalarComparison(predicate: Predicate, typeExpr: string, valueExpr: string, bind: BindValue): string | undefined {
    const strict = (value: unknown): string => strictJsonValueEquals(typeExpr, valueExpr, asScalarOperand(value), bind);

    switch (predicate.kind) {
        case 'scalar':
            if (predicate.value === null) return undefined;
            return strict(predicate.value);
        case 'eq':
            if (predicate.operand === null) return `(${typeExpr} IS NULL OR ${typeExpr} = 'null')`;
            // Nothing equals NaN — short-circuit to a constant rather than the strict comparison. See MONGO-DIVERGENCES.md §7.
            if (typeof predicate.operand === 'number' && Number.isNaN(predicate.operand)) return '1 = 0';
            return strict(predicate.operand);
        case 'ne':
            if (predicate.operand === null) return '1 = 1'; // "ne matches missing" — $ne null matches every value
            // NaN equals nothing, so $ne: NaN matches every value — short-circuit before the strict path. See MONGO-DIVERGENCES.md §7.
            if (typeof predicate.operand === 'number' && Number.isNaN(predicate.operand)) return '1 = 1';
            return `(${typeExpr} IS NULL OR NOT (${strict(predicate.operand)}))`;
        case 'in':
            if (predicate.operand.length === 0) return '1 = 0';
            return `(${predicate.operand.map(strict).join(' OR ')})`;
        case 'nin':
            if (predicate.operand.length === 0) return '1 = 1';
            return `(${typeExpr} IS NULL OR NOT (${predicate.operand.map(strict).join(' OR ')}))`;
        case 'range': {
            const operandIsNumber = typeof predicate.bounds[0]?.operand === 'number';
            const typeGuard = operandIsNumber ? `${typeExpr} IN ('integer', 'real')` : `${typeExpr} = 'text'`;
            const comparisons = predicate.bounds.map(bound => {
                if (typeof bound.operand === 'number' && Number.isNaN(bound.operand)) return '1=0'; // MongoDB: every comparison with NaN is false. See MONGO-DIVERGENCES.md §7.
                return ValueComparisonRangeOperatorsSqlFunctions[bound.operator](valueExpr, bind(bound.operand));
            });
            const body = comparisons.length > 1 ? `(${comparisons.join(' AND ')})` : comparisons[0]!;
            return `CASE WHEN ${typeGuard} THEN ${body} ELSE 1=0 END`;
        }
        default:
            return undefined;
    }
}
