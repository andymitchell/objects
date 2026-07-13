import { ValueComparisonRangeOperators } from "../consts.ts";

/**
 * Which field-condition payload an operator may appear in. A `value` operator constrains a scalar field
 * (`$eq`, a range bound, `$regex`, …); an `array` operator constrains an array field (`$elemMatch`, `$all`,
 * `$size`); an operator meaningful on both (`$in`, `$nin`, `$not`, `$exists`, `$type`) lists both.
 */
export type OperatorCategory = 'value' | 'array';

/**
 * The engine-neutral facts about one field-condition operator.
 *
 * @property name The `$`-prefixed key, e.g. `$eq`.
 * @property categories The payload(s) the operator may appear in.
 * @property broadening Whether carrying ONLY this operator classifies a leaf as *broadening* for the
 *   validator — i.e. the operator can match widely, so its lone presence never proves a clause "matches
 *   nothing". This is a STATIC over-approximation that exists to keep the validator free of false positives,
 *   not a statement of literal missing-field behaviour: `$not` and `$exists` broaden only for a particular
 *   operand (`$not:{$exists:false}`, `$exists:false`) and `$eq` only as `$eq:null` — the validator resolves
 *   those operand-conditional cases itself. `$type` is listed because the validator does not reason about
 *   runtime types at all, so it can never prove a `$type` leaf matches nothing.
 */
export type OperatorMeta = {
    readonly name: string;
    readonly categories: readonly OperatorCategory[];
    readonly broadening: boolean;
};

/**
 * The single declarative source of the filter language's field-condition operators. Every consumer reads this
 * list rather than re-declaring "which operators exist": the parser's {@link isOperatorKey} recognises exactly
 * these keys, the validator derives its broadening set from the `broadening` flag, and the gate's operator
 * payloads admit exactly these per category — a correspondence pinned by `operators.test.ts` so the gate,
 * parser and this registry cannot silently drift apart when an operator is added.
 *
 * Adding an operator: add one entry here, a field to the matching gate payload (`schemas.ts`), a `parseOperator`
 * case ({@link parseFieldPredicate}), and an `emitPredicate` arm in each SQL translator. The drift-guard test
 * reds until the gate and parser catch up.
 */
export const OPERATORS: readonly OperatorMeta[] = [
    // Value-only.
    { name: '$eq', categories: ['value'], broadening: false },
    { name: '$ne', categories: ['value'], broadening: true },
    { name: '$regex', categories: ['value'], broadening: false },
    // `$options` is never a predicate on its own — it tunes a co-occurring `$regex` — but it IS an operator
    // key, so a payload carrying it reads as an operator payload rather than a sub-document.
    { name: '$options', categories: ['value'], broadening: false },
    ...ValueComparisonRangeOperators.map((name): OperatorMeta => ({ name, categories: ['value'], broadening: false })),
    // Shared across the value and array payloads.
    { name: '$in', categories: ['value', 'array'], broadening: false },
    { name: '$nin', categories: ['value', 'array'], broadening: true },
    { name: '$not', categories: ['value', 'array'], broadening: true },
    { name: '$exists', categories: ['value', 'array'], broadening: true },
    { name: '$type', categories: ['value', 'array'], broadening: true },
    // Array-only.
    { name: '$elemMatch', categories: ['array'], broadening: false },
    { name: '$all', categories: ['array'], broadening: false },
    { name: '$size', categories: ['array'], broadening: false },
];

const namesInCategory = (category: OperatorCategory): readonly string[] =>
    OPERATORS.filter(o => o.categories.includes(category)).map(o => o.name);

/** The operators a value (scalar) field condition may carry. */
export const valueOperatorNames: readonly string[] = namesInCategory('value');
/** The operators an array field condition may carry. */
export const arrayOperatorNames: readonly string[] = namesInCategory('array');
/** The operators the validator treats as broadening (see {@link OperatorMeta.broadening}). */
export const broadeningOperatorNames: readonly string[] = OPERATORS.filter(o => o.broadening).map(o => o.name);

const OPERATOR_KEY_SET: ReadonlySet<string> = new Set(OPERATORS.map(o => o.name));

/** Whether a key names a field-condition operator rather than a field of a sub-document. */
export const isOperatorKey = (key: string): boolean => OPERATOR_KEY_SET.has(key);
