import { isOperatorKey } from "../../ast/index.ts";

/**
 * Reduce a filter to its *shape* — the structure a disagreement is really about, with the concrete operands
 * thrown away.
 *
 * Two filters share a shape when they apply the same operators, in the same nesting, to fields of the same
 * kind. `{tags:{$eq:'a'}}` and `{scores:{$eq:9}}` are one shape; `{tags:{$eq:'a'}}` and `{tags:{$size:1}}` are
 * two. A fuzz run produces thousands of disagreeing *filters* but only a handful of disagreeing *shapes*, and
 * it is the shapes that a human triages — so this function is what makes the oracle's output reviewable.
 *
 * Field names collapse to their kind (`array` / `scalar`), because a divergence that hits `tags` hits `scores`
 * for the same reason: the field is an array, not that it is called `tags`.
 *
 * @param filter - Any filter the generator produced.
 * @param isArrayField - Whether a given dot-prop path names an array-valued field in the row schema.
 * @returns A canonical, stable string. Equal strings mean "the same kind of disagreement".
 *
 * @example
 * filterShape({ tags: { $eq: 'a' } }, isArr);    // 'array:{$eq}'
 * filterShape({ scores: { $eq: 9 } }, isArr);    // 'array:{$eq}'  — same shape
 * filterShape({ name: { $eq: 'ann' } }, isArr);  // 'scalar:{$eq}' — different shape
 *
 * @remarks
 * Granularity is load-bearing. Too coarse and two unrelated bugs merge into one entry and one gets missed; too
 * fine and the report inflates into noise. Operator identity and field kind are kept because they change the
 * semantics; operand values are dropped because they do not.
 */
export function filterShape(filter: unknown, isArrayField: (path: string) => boolean): string {
    return shapeOf(filter, isArrayField);
}

function shapeOf(node: unknown, isArrayField: (path: string) => boolean): string {
    if (node === null || typeof node !== 'object') return 'value';
    if (Array.isArray(node)) return `[${node.length === 0 ? '' : 'value'}]`;

    const entries = Object.entries(node as Record<string, unknown>);
    if (entries.length === 0) return '{}';

    const parts = entries.map(([key, value]) => {
        // A logic node: recurse into every arm, sort so arm order never splits a shape.
        if (key === '$and' || key === '$or' || key === '$nor') {
            const arms = (Array.isArray(value) ? value : []).map(arm => shapeOf(arm, isArrayField)).sort();
            return `${key}[${arms.join(',')}]`;
        }
        // An operator: keep its name; describe its operand only where the operand's STRUCTURE carries meaning.
        if (isOperatorKey(key)) return `${key}${operandShape(key, value, isArrayField)}`;
        // Otherwise a field path: collapse the name to its kind, and describe the condition applied to it.
        return `${isArrayField(key) ? 'array' : 'scalar'}:${conditionShape(value, isArrayField)}`;
    });

    return parts.sort().join('&');
}

/** An operator's operand is shape-relevant only when it nests a predicate or its emptiness changes the verdict. */
function operandShape(op: string, operand: unknown, isArrayField: (path: string) => boolean): string {
    // `$not` and `$elemMatch` carry a whole predicate — its structure is the point.
    if (op === '$not' || op === '$elemMatch') return `(${conditionShape(operand, isArrayField)})`;
    // An empty list is a distinct shape from a populated one ($all:[] is MONGO-DIVERGENCES.md #2).
    if (Array.isArray(operand)) return operand.length === 0 ? '(empty)' : '(list)';
    return '';
}

/** The right-hand side of a field: a bare value, an exact array, or an operator payload. */
function conditionShape(condition: unknown, isArrayField: (path: string) => boolean): string {
    if (condition === null || typeof condition !== 'object') return 'value';
    if (Array.isArray(condition)) return 'exactArray';

    const keys = Object.keys(condition as Record<string, unknown>);
    if (keys.length === 0) return '{}';
    if (!keys.some(isOperatorKey)) return 'object';

    const ops = keys
        .map(k => `${k}${operandShape(k, (condition as Record<string, unknown>)[k], isArrayField)}`)
        .sort();
    return `{${ops.join(',')}}`;
}
