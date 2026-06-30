
import type { WhereFilterDefinition } from "../types.ts";
import type { ValueComparisonRangeOperators } from "../consts.ts";
import type { DotPropPathConversionError, PreparedStatementArgument, SqlDialect } from "../../utils/sql/types.ts";

// Re-export base SQL types from canonical location
export type { PreparedStatementArgument, PreparedStatementArgumentOrObject, SqlDialect } from '../../utils/sql/types.ts';
export { isPreparedStatementArgument } from '../../utils/sql/types.ts';

/**
 * Dialect-specific abstraction for converting a single dot-prop path + filter value into SQL.
 * Implementations know how to map WhereFilterDefinition leaf values to dialect-specific SQL fragments,
 * and declare the SQL dialect they target via the `dialect` field so callers can verify the pairing.
 *
 * ```
 * compileWhereFilter(filter, translator)
 *   └─ recursive walk ─► translator.generateSql(path, leaf, args, errors, root)
 *                              └─ dialect-specific SQL fragment
 * ```
 *
 * @example
 * class MyTranslator implements IPropertyTranslator<MyType> {
 *   readonly dialect = 'pg' as const;
 *   generateSql(path, filter, args, errors, root) { return `col->>'${path}' = $1`; }
 * }
 */
export interface IPropertyTranslator<T extends Record<string, any>> {
    /** SQL dialect this translator emits — used by `prepareWhereClause` to detect mismatched pairings. */
    readonly dialect: SqlDialect;
    /**
     * Schema-level errors found when the translator was built from a Zod schema (currently: a shape-ambiguous
     * `scalar | array` field). When present and non-empty, `compileWhereFilter` short-circuits to
     * `{ success: false, errors }` before walking the filter. Undefined for translators built from a pre-derived
     * node map (no schema to inspect).
     */
    readonly schemaErrors?: WhereClauseError[];
    generateSql(dotpropPath: string, filter: WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[], errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>): string;
}

/** Error from a sub-filter that could not be compiled to SQL (has filter context). */
export type WhereClauseFilterError = {
    kind: 'filter';
    sub_filter: WhereFilterDefinition;
    root_filter: WhereFilterDefinition;
    message: string;
};

/** Error from a dot-prop path conversion failure (no filter context available). */
export type WhereClausePathError = {
    kind: 'path_conversion';
    error: DotPropPathConversionError;
    message: string;
};

/** Error when a translator's declared dialect does not match the dialect requested by the caller. */
export type WhereClauseDialectMismatchError = {
    kind: 'dialect_mismatch';
    expected: SqlDialect;
    actual: SqlDialect;
    message: string;
};

/**
 * Error when a field's schema is shape-ambiguous — it admits both a scalar and an array at the same path
 * (e.g. `z.union([z.string(), z.array(z.string())])`). A schema-driven SQL emitter cannot decide whether to
 * text-compare the field or spread it as an array, so the whole clause is rejected rather than guessing.
 */
export type WhereClauseSchemaAmbiguityError = {
    kind: 'schema_ambiguous';
    dotprop_path: string;
    message: string;
};

/**
 * Error when a field's schema normalizes the value on parse — a `z.coerce.*` flag or a transform / pipe /
 * preprocess node (e.g. `z.coerce.number()`). A schema-driven SQL emitter compares the raw stored value, so a
 * schema that rewrites it would silently diverge from the value-driven matcher; the whole clause is rejected.
 */
export type WhereClauseSchemaNormalizationError = {
    kind: 'schema_normalizes';
    dotprop_path: string;
    message: string;
};

/** Discriminated union of where-clause compilation errors. All variants carry `.message` for uniform access. */
export type WhereClauseError = WhereClauseFilterError | WhereClausePathError | WhereClauseDialectMismatchError | WhereClauseSchemaAmbiguityError | WhereClauseSchemaNormalizationError;

/**
 * Discriminated union result from SQL where-clause builders.
 * Consumers must check `.success` before accessing statement fields.
 */
export type PreparedWhereClauseResult =
    | { success: true; } & PreparedWhereClauseStatement
    | { success: false; errors: WhereClauseError[] };


export type PreparedWhereClauseStatement = { where_clause_statement: string, statement_arguments: PreparedStatementArgument[] };

/** Maps range operators to dialect-agnostic SQL comparison functions (>, <, >=, <=). */
export type ValueComparisonRangeOperatorSqlFunctions = {
    [K in typeof ValueComparisonRangeOperators[number]]: (sqlKey: string, parameterizedQueryPlaceholder: string) => string;
};
