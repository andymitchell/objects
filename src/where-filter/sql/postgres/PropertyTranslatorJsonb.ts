import { z } from "zod";
import type { ValueComparisonRangeOperatorsTyped, WhereFilterDefinition } from "../../types.ts";
import { convertSchemaToDotPropPathTree } from "../../../dot-prop-paths/schema-tree.ts";
import type { TreeNode, TreeNodeMap, ZodKind } from "../../../dot-prop-paths/schema-tree.ts";
import { isUnspreadableRecordPath, resolvePath } from "../../../dot-prop-paths/resolvePath.ts";
import type { ResolvedPath } from "../../../dot-prop-paths/resolvePath-types.ts";
import { findShapeAmbiguousPaths, findMultiScalarUnionPaths } from "../../../dot-prop-paths/shape-ambiguity.ts";
import { findNormalizingPaths } from "../../../dot-prop-paths/schema-normalization.ts";
import isPlainObject from "../../../utils/isPlainObject.ts";
import { convertDotPropPathToPostgresJsonPath, UNSAFE_WARNING } from "./convertDotPropPathToPostgresJsonPath.ts";
import { pgJsonbAccessor } from "../../../utils/sql/postgres/pgJsonbAccessor.ts";
import { isLogicFilter } from "../../typeguards.ts";
import { isOperatorKey, matchesMissingField, negationCore, parseFieldPredicate, partitionNegations } from "../../ast/index.ts";
import type { ElemMatchBody, Predicate } from "../../ast/index.ts";
import { planSqlArrayTraversal } from "../planSqlArrayTraversal.ts";
import type { SqlPredicate, TraverseArrayPredicate } from "../planSqlArrayTraversal.ts";
import { reconstructFieldCondition } from "../reconstructFieldCondition.ts";
import { compileWhereFilterRecursive } from "../compileWhereFilter.ts";
import { isPreparedStatementArgument } from "../types.ts";
import type { IPropertyTranslator, PreparedStatementArgument, PreparedStatementArgumentOrObject, SqlDialect, WhereClauseError, WhereClauseFilterReasonCode } from "../types.ts";
import { ValueComparisonRangeOperatorsSqlFunctions } from "../sharedSqlOperators.ts";
import { emitMultiScalarPgComparison } from "./multiScalarPg.ts";
import { arraySizeEquals, guardedJsonbArray, mapTypeToPostgres, pgRegexOptionPrefix, toJsonbParam } from "./pgJsonbFragments.ts";
import type { BindValue } from "./pgJsonbFragments.ts";
import { spreadJsonbArrays } from "./spreadJsonbArrays.ts";


/**
 * Where a predicate is being compared.
 *
 * A field condition reads differently depending on what it is held against: the column's own field, or one
 * element of an array the emitter has already spread. `customSqlIdentifier` names the element; its absence means
 * the field itself, where missing-ness is a question worth asking.
 */
type EmitContext = {
    /** The expression holding the value under comparison, when it is an array element rather than the field. */
    readonly customSqlIdentifier?: string;
    /** A spread element's raw jsonb column, so a mixed-scalar element compares type-faithfully (JSON `7` ≠ `"7"`). */
    readonly customRawJsonb?: string | undefined;
    /** The path crosses an array but ends at a scalar or object, which is read from every spread element. */
    readonly spreadLeafBelowArray?: boolean;
};

/** Yields a fresh `jsonb_array_elements` alias each call, so sibling and nested spreads never shadow one another. */
type AliasFactory = () => string;

/** The operators whose verdict on a field the schema does not describe is decided before any SQL is emitted. */
const MISSING_FIELD_KINDS: ReadonlySet<Predicate['kind']> = new Set<Predicate['kind']>(['ne', 'nin', 'not', 'exists', 'type', 'size']);

/** Whether an `$elemMatch` body describes an object element's fields, rather than an element's own value. */
function isSubDocumentBody(body: ElemMatchBody): body is ElemMatchBody & { objectFilter: WhereFilterDefinition } {
    return body.objectFilter !== undefined && !Object.keys(body.objectFilter).some(isOperatorKey);
}

/**
 * Whether a predicate compares against a boolean, which only the RAW jsonb value can answer.
 *
 * Postgres has no `text = boolean` operator (and `numeric = boolean` errors), so a boolean operand cannot be
 * compared against a text- or numeric-projected reading of the stored value — the projection that every array
 * element and every mixed-scalar union is read through. Equality is also type-strict here (matchJavascriptObject's
 * `===`), so a boolean must match a stored boolean and be inert against a stored `1` or `"true"`, which only a
 * jsonb-to-jsonb comparison preserves.
 *
 * This is a property of the OPERAND, not of the operator or the field: it holds for a homogeneous boolean array's
 * elements exactly as it does for a `boolean | number | string` union.
 */
function hasBooleanOperand(predicate: Predicate): boolean {
    switch (predicate.kind) {
        case 'in':
        case 'nin':
            return predicate.operand.some(value => typeof value === 'boolean');
        case 'eq':
        case 'ne':
            return typeof predicate.operand === 'boolean';
        case 'scalar':
            return typeof predicate.value === 'boolean';
        default:
            // A range bound cannot be a boolean, and $regex/$exists/$type/$size/$all take no scalar operand of
            // their own. `$not` is decided by the predicate it wraps, which is emitted in its own right.
            return false;
    }
}

/**
 * Postgres JSONB implementation of IPropertyTranslator.
 * Generates SQL fragments for a single JSONB column using TreeNodeMap for type-aware casting,
 * array spreading via jsonb_array_elements, and parameterised placeholders.
 */
class BasePropertyTranslatorJsonb<T extends Record<string, any> = Record<string, any>> implements IPropertyTranslator<T> {
    readonly dialect: SqlDialect = 'pg';
    /** Schema-level errors found at construction from a Zod schema (shape-ambiguous fields); see {@link IPropertyTranslator}. */
    schemaErrors: WhereClauseError[] = [];
    /** Dot-prop paths whose union mixes ≥2 scalar kinds — compared as raw JSON values, not a single typed cast. */
    protected multiScalarPaths: Set<string> = new Set();
    protected nodeMap: TreeNodeMap;
    protected sqlColumnName: string;
    protected doNotSpreadArray: boolean;
    /** Accumulated path conversion errors, merged into caller's errors array after generateSql completes. */
    private conversionErrors: WhereClauseError[] = [];

    constructor(nodeMap: TreeNodeMap, sqlColumnName: string, doNotSpreadArray?: boolean) {
        this.nodeMap = nodeMap;
        this.sqlColumnName = sqlColumnName;
        this.doNotSpreadArray = doNotSpreadArray ?? false;
        // A literal-kind field (a lone z.literal, or a same-scalar-kind union of literals like
        // z.union([z.literal(0), z.literal(1)])) has no single Postgres column cast — the converter rejects it as
        // an unsupported kind. Compare it as a raw JSON value, type-faithfully, exactly like a multi-scalar union
        // (so a numeric-literal field's 0 matches a stored 0 but not a stored "0"). A mixed-scalar literal union is
        // already covered by findMultiScalarUnionPaths.
        for (const path of Object.keys(nodeMap)) {
            if (nodeMap[path]?.kind === 'literal') this.multiScalarPaths.add(path);
        }
    }

    /** Wraps convertDotPropPathToPostgresJsonPath, using this instance's column name and nodeMap. On failure, records error and returns 'FALSE'. */
    private getSqlIdentifier(dotPropPath: string, errorIfNotAsExpected?: ZodKind[], customColumnName?: string): string {
        const result = convertDotPropPathToPostgresJsonPath(customColumnName ?? this.sqlColumnName, dotPropPath, this.nodeMap, errorIfNotAsExpected);
        if (!result.success) {
            this.conversionErrors.push({ kind: 'path_conversion', error: result.error, message: result.error.message });
            return 'FALSE';
        }
        return result.expression;
    }

    /** A path-conversion error in the shape the shared converter produces, so callers classify it uniformly. */
    private pathError(type: 'invalid_path' | 'unsupported_kind', dotPropPath: string, message: string): WhereClauseError {
        return { kind: 'path_conversion', error: { type, dotPropPath, message }, message };
    }

    /** The raw jsonb accessor (`(col->'a'->'b')`) for a resolved path — every key quoted, so a key can only be data. */
    private pathAccessor(resolved: ResolvedPath, asText: boolean): string {
        return pgJsonbAccessor(this.sqlColumnName, resolved.segments, { asText });
    }

    /**
     * Fresh `jsonb_array_elements` aliases for one field condition, continuing the numbering of any spread already
     * emitted. The prefix is derived from the column, so a translator scoped to a spread element cannot collide
     * with the spread that produced that element.
     */
    private aliasFactory(alreadyUsed: number): AliasFactory {
        let next = alreadyUsed;
        return () => `${this.sqlColumnName}_e${++next}`;
    }

    /** Pushes a value into the statementArguments array and returns its `$N` placeholder. Objects/arrays are JSON.stringify'd first. */
    protected generatePlaceholder(value: PreparedStatementArgumentOrObject, statementArguments: PreparedStatementArgument[]): string {
        if (isPlainObject(value) || Array.isArray(value)) value = JSON.stringify(value);
        if (!isPreparedStatementArgument(value)) {
            throw new Error("Placeholders for SQL can only be string/number/boolean");
        }
        statementArguments.push(value);
        return `$${statementArguments.length}`;
    }

    /** A binder over one statement's argument list, for the jsonb fragment builders that take literals. */
    private binder(statementArguments: PreparedStatementArgument[]): BindValue {
        return (value: string | number | boolean) => this.generatePlaceholder(value, statementArguments);
    }

    /**
     * Record a $regex translation failure. A 'not well-defined' message routes the seam to a REJECTION (an invalid
     * pattern/flag — the JS oracle throws on those too); any other message routes it to a SKIP (a capability gap).
     * Pushed to conversionErrors so it surfaces whether or not the caller threaded an errors array.
     */
    private pushRegexError(dotpropPath: string, filter: unknown, rootFilter: WhereFilterDefinition<T> | undefined, reasonCode: WhereClauseFilterReasonCode, message: string): void {
        const sub = { [dotpropPath]: filter } as WhereFilterDefinition;
        this.conversionErrors.push({ kind: 'filter', reasonCode, sub_filter: sub, root_filter: rootFilter ?? sub, message });
    }

    /**
     * Forces leaf comparisons to a definite TRUE/FALSE so any enclosing NOT (from $nor or a parent $not) doesn't
     * propagate NULL under SQL 3VL. Unconditional for a resolvable path, so semantics agree with
     * matchJavascriptObject regardless of schema annotation; PG folds the guard against NOT NULL columns.
     */
    private optionalWrapper(resolved: ResolvedPath, sqlIdentifier: string, query: string): string {
        if (!resolved.known) return query;
        return `(${sqlIdentifier} IS NOT NULL AND ${query})`;
    }

    /** Wraps Mongo "matches missing" operators ($ne / $nin / $not) with `(IS NULL OR <q>)`. */
    private optionalWrapperNullMatches(resolved: ResolvedPath, sqlIdentifier: string, query: string): string {
        if (!resolved.known) return query;
        return `(${sqlIdentifier} IS NULL OR ${query})`;
    }

    /**
     * Generates a SQL fragment for a single dot-prop path and its filter value.
     *
     * The path is resolved ONCE and the resolution travels with the condition, so every accessor, JSON accessor
     * and node lookup below reads it rather than re-splitting the raw path. The condition is parsed into a predicate
     * tree, and a path ending at an array is planned as a traversal that binds the whole condition to one leaf array.
     */
    generateSql(dotpropPath: string, filter: WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[], errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>): string {
        this.conversionErrors = [];

        const result = resolvePath(dotpropPath, this.nodeMap);
        let sql: string;
        if (!result.success) {
            this.conversionErrors.push(this.pathError('invalid_path', dotpropPath, `Invalid dotPropPath. ${UNSAFE_WARNING}`));
            sql = 'FALSE';
        } else if (isUnspreadableRecordPath(result.resolved)) {
            // Array spreading is planned from the schema's path map, which has no node for a record's dynamic key.
            // Refuse the path for EVERY operator — including those that build their own accessor — so a caller sees
            // an acknowledged capability gap rather than a confident `false` for a row that plainly matches.
            this.conversionErrors.push(this.pathError('unsupported_kind', dotpropPath, `A dotPropPath that crosses an array beneath a record key cannot be addressed. ${UNSAFE_WARNING}`));
            sql = 'FALSE';
        } else {
            sql = this.emitFieldCondition(dotpropPath, result.resolved, filter, statementArguments, errors, rootFilter);
        }

        if (this.conversionErrors.length > 0) {
            errors.push(...this.conversionErrors);
            this.conversionErrors = [];
        }

        return sql;
    }

    /** Parse the condition, choose how the path reaches its value, then emit. */
    private emitFieldCondition(dotpropPath: string, resolved: ResolvedPath, filter: WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[], errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>): string {
        const parsed = parseFieldPredicate(filter);
        let predicate: SqlPredicate = parsed;
        let context: EmitContext = {};

        if (this.doNotSpreadArray && resolved.arrayDepth === 1 && parsed.kind !== 'exactArray') {
            // A translator scoped to an array element already sits inside that array's spread: the element's own
            // fields are read from it directly. An exact-array operand still compares the whole array.
            context = { customSqlIdentifier: this.getSqlIdentifier(dotpropPath, undefined, this.sqlColumnName) };
        } else if (resolved.arrayDepth > 0) {
            predicate = planSqlArrayTraversal(resolved, parsed);
            // The path crosses an array yet does not end at one: its leaf is read from every spread element.
            if (predicate.kind !== 'traverseArray') context = { spreadLeafBelowArray: true };
        }

        return this.emitPredicate(dotpropPath, resolved, predicate, statementArguments, errors, rootFilter, context);
    }

    /**
     * Emit one predicate. Several operators on one field mean their conjunction, so an `and` node emits each child
     * against the same value and joins them — never a first-operator-wins dispatch.
     */
    private emitPredicate(dotpropPath: string, resolved: ResolvedPath, predicate: SqlPredicate, statementArguments: PreparedStatementArgument[], errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>, context: EmitContext): string {
        if (predicate.kind === 'traverseArray') {
            return this.emitTraverseArray(dotpropPath, resolved, predicate, statementArguments, errors, rootFilter);
        }
        if (predicate.kind === 'and') {
            const clauses = predicate.children.map(child => this.emitPredicate(dotpropPath, resolved, child, statementArguments, errors, rootFilter, context));
            return `(${clauses.join(' AND ')})`;
        }
        if (context.spreadLeafBelowArray) {
            return this.emitSpreadLeafPredicate(dotpropPath, resolved, predicate, statementArguments, errors, rootFilter);
        }

        const strict = this.emitMultiScalarLeaf(resolved, predicate, statementArguments, context);
        if (strict !== undefined) return strict;

        // A field absent from the schema is always missing. Its verdict is the JS oracle's missing-field verdict.
        // Resolve $exists / $type / $size here (alongside $ne / $nin / $not) BEFORE their emitters interpolate the
        // filter key into the SQL string — so an attacker-controlled key is never a query, only a definite `false`.
        // ($eq / $in / range / $regex / a bare scalar already resolve to FALSE via the path-validating accessor.)
        if (context.customSqlIdentifier === undefined && !resolved.known && MISSING_FIELD_KINDS.has(predicate.kind)) {
            return matchesMissingField(predicate) ? '1=1' : '1=0';
        }

        return this.emitLeafComparison(dotpropPath, resolved, predicate, statementArguments, errors, rootFilter, context);
    }

    /**
     * A mixed-scalar union field compares by strict raw-JSON value-equality rather than in a single SQL type. The
     * comparison reads the field directly, or — when the value is an already-spread array element — that element's
     * own raw jsonb column.
     *
     * @returns The strict comparison, or `undefined` when the field or the predicate is not one it answers.
     */
    private emitMultiScalarLeaf(resolved: ResolvedPath, predicate: Predicate, statementArguments: PreparedStatementArgument[], context: EmitContext): string | undefined {
        // The set's keys are enumerated paths, so a hit counts only for a path that resolved to its node; a
        // collision path resolves unknown (no node) and must not borrow the colliding field's multi-scalar
        // reading. A boolean operand stays independent of the set — it applies to any scalar leaf, including a
        // record value and an array element (see {@link hasBooleanOperand}).
        const applies = ((resolved.node !== undefined && this.multiScalarPaths.has(resolved.lookupPath)) || hasBooleanOperand(predicate))
            && (context.customSqlIdentifier === undefined || context.customRawJsonb !== undefined);
        if (!applies) return undefined;

        const rawId = context.customRawJsonb ?? this.pathAccessor(resolved, false);
        return emitMultiScalarPgComparison(
            predicate,
            rawId,
            value => toJsonbParam(value, this.binder(statementArguments)),
            value => this.generatePlaceholder(value, statementArguments),
        );
    }

    // ── Array traversal — a condition on an array path binds to ONE leaf array ──

    /**
     * Bind the condition to one leaf array, spreading whatever arrays lie above it.
     *
     * When arrays are spread, a row exists per intermediate element and the condition is satisfied if ANY of them
     * holds the leaf array that satisfies it. With no intermediate elements there is no leaf array at all, which is
     * what a missing field means; the condition's own verdict on a missing field then decides.
     */
    private emitTraverseArray(dotpropPath: string, resolved: ResolvedPath, node: TraverseArrayPredicate, statementArguments: PreparedStatementArgument[], errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>): string {
        if (node.intermediates.length === 0) {
            const leafArrayExpr = pgJsonbAccessor(this.sqlColumnName, node.leafSegments, { asText: false });
            const nextAlias = this.aliasFactory(0);
            return this.emitLeafArrayPredicate(dotpropPath, resolved, node, leafArrayExpr, node.child, statementArguments, errors, rootFilter, nextAlias);
        }

        const spread = spreadJsonbArrays(this.sqlColumnName, [...node.intermediates]);
        if (!spread) throw new Error("Could not locate array in path: " + dotpropPath);
        const spreadArrayCount = node.intermediates.filter(intermediate => intermediate.kind === 'array').length;
        const nextAlias = this.aliasFactory(spreadArrayCount);
        const leafArrayExpr = pgJsonbAccessor(spread.output_column, node.leafSegments, { asText: false });

        // A positive condition binds to ONE leaf array; a negation denies the whole path, so it is lifted out of
        // the fold and applied to the condition it wraps. Folding it in would let a clean leaf excuse an
        // offending sibling — `$nin` would admit a row holding the very value it forbids.
        const matchOverLeaves = (child: Predicate): string => {
            const core = negationCore(child);
            if (core) return `NOT (${matchOverLeaves(core)})`;

            const { positive, negations } = partitionNegations(child);
            const terms: string[] = [];
            if (positive) {
                const leafSql = this.emitLeafArrayPredicate(dotpropPath, resolved, node, leafArrayExpr, positive, statementArguments, errors, rootFilter, nextAlias);
                terms.push(`EXISTS (SELECT 1 FROM ${spread.sql} WHERE ${leafSql})`);
            }
            for (const negation of negations) terms.push(matchOverLeaves(negation));
            return terms.length === 1 ? terms[0]! : `(${terms.join(' AND ')})`;
        };

        const overLeaves = matchOverLeaves(node.child);
        return matchesMissingField(node.child)
            ? `(${overLeaves} OR NOT EXISTS (SELECT 1 FROM ${spread.sql}))`
            : overLeaves;
    }

    /**
     * Emit a condition against ONE leaf array, addressed by the jsonb expression `leafArrayExpr`.
     *
     * A conjunction here is the whole point: every operator is judged against the same leaf array, so a `$size`
     * and an `$all` cannot be satisfied by two different arrays reached by the same path.
     */
    private emitLeafArrayPredicate(dotpropPath: string, resolved: ResolvedPath, node: TraverseArrayPredicate, leafArrayExpr: string, predicate: Predicate, statementArguments: PreparedStatementArgument[], errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>, nextAlias: AliasFactory): string {
        const emitChild = (child: Predicate): string => this.emitLeafArrayPredicate(dotpropPath, resolved, node, leafArrayExpr, child, statementArguments, errors, rootFilter, nextAlias);
        const multiScalarElement = this.multiScalarPaths.has(resolved.lookupPath);
        // Spread the leaf array itself, guarding against a non-array value (a JSON null under a nullable-array
        // field), which coerces to an empty array and matches nothing rather than erroring.
        const guardedLeafArray = guardedJsonbArray(leafArrayExpr);
        const elements = (alias: string) => `jsonb_array_elements(${guardedLeafArray}) AS ${alias}`;
        // A comparison operator scanning the elements reads each one as text, cast to numeric when the operand is
        // numeric — otherwise `<`/`>` would compare lexically, where `'-8' < '-9'` is true. The element's RAW jsonb
        // is offered alongside, for the comparisons a text projection cannot express (see {@link hasBooleanOperand}).
        const comparisonElementContext = (alias: string, forPredicate: Predicate): EmitContext => {
            const numeric = (forPredicate.kind === 'eq' || forPredicate.kind === 'ne')
                ? typeof forPredicate.operand === 'number'
                : this.elementNeedsNumericCast(forPredicate);
            return {
                customSqlIdentifier: numeric ? `(${alias} #>> '{}')::numeric` : `${alias} #>> '{}'`,
                customRawJsonb: alias,
            };
        };

        switch (predicate.kind) {
            case 'and':
                return `(${predicate.children.map(emitChild).join(' AND ')})`;

            // $in / $nin read the array as a set: they intersect it rather than compare it whole.
            case 'in': {
                if (predicate.operand.length === 0) return '1 = 0';
                const alias = nextAlias();
                // A boolean operand compares against the element's own jsonb, never its text projection, which has
                // no `= boolean` operator (see {@link hasBooleanOperand}) — as does a mixed-scalar element, whose
                // stored type is not known until it is read.
                if (multiScalarElement || hasBooleanOperand(predicate)) {
                    const vals = predicate.operand.map(v => toJsonbParam(v as string | number | boolean, this.binder(statementArguments)));
                    return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${alias} IN (${vals.join(', ')}))`;
                }
                const placeholders = predicate.operand.map(v => this.generatePlaceholder(v as PreparedStatementArgumentOrObject, statementArguments));
                return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${alias} #>> '{}' IN (${placeholders.join(', ')}))`;
            }
            case 'nin': {
                if (predicate.operand.length === 0) return '1 = 1';
                const alias = nextAlias();
                if (multiScalarElement || hasBooleanOperand(predicate)) {
                    const vals = predicate.operand.map(v => toJsonbParam(v as string | number | boolean, this.binder(statementArguments)));
                    return `NOT EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${alias} IN (${vals.join(', ')}))`;
                }
                const placeholders = predicate.operand.map(v => this.generatePlaceholder(v as PreparedStatementArgumentOrObject, statementArguments));
                return `NOT EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${alias} #>> '{}' IN (${placeholders.join(', ')}))`;
            }

            case 'all': {
                // An empty $all is vacuously satisfied by any array.
                if (predicate.elements.length === 0) return '1 = 1';
                const conditions = predicate.elements.map(operand => {
                    const alias = nextAlias();
                    if (operand === null) {
                        // A JSON null element: compare the raw jsonb element to `'null'::jsonb`. Its text extraction
                        // is SQL NULL and never equals a bound param.
                        return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${alias} = 'null'::jsonb)`;
                    }
                    if (isPlainObject(operand) || Array.isArray(operand)) {
                        // A structural element: EXACT deep equality via jsonb `=` (key-order-insensitive, canonical),
                        // never a serialized-text compare. The JS reference is `value.some(el => deepEql(el, operand))`,
                        // so an element carrying extra keys must NOT match, while one whose keys are reordered must.
                        const placeholder = this.generatePlaceholder(operand as PreparedStatementArgumentOrObject, statementArguments);
                        return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${alias} = ${placeholder}::jsonb)`;
                    }
                    if (multiScalarElement || typeof operand === 'boolean') {
                        // A boolean (or any mixed-scalar element) compares as jsonb-of-its-own-type, so `text = boolean`
                        // (which Postgres has no operator for) never arises.
                        return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${alias} = ${toJsonbParam(operand as string | number | boolean, this.binder(statementArguments))})`;
                    }
                    const placeholder = this.generatePlaceholder(operand as PreparedStatementArgumentOrObject, statementArguments);
                    return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${alias} #>> '{}' = ${placeholder})`;
                });
                return conditions.join(' AND ');
            }

            case 'size':
                return arraySizeEquals(leafArrayExpr, this.generatePlaceholder(predicate.n, statementArguments));

            case 'exists':
                // jsonb_typeof keeps a present JSON null (a value) distinct from a missing key, which the extracted
                // value cannot.
                return predicate.expected
                    ? `jsonb_typeof(${leafArrayExpr}) IS NOT NULL`
                    : `jsonb_typeof(${leafArrayExpr}) IS NULL`;

            case 'type':
                return `jsonb_typeof(${leafArrayExpr}) = ${this.generatePlaceholder(mapTypeToPostgres(predicate.typeName), statementArguments)}`;

            case 'not':
                if (predicate.inner.kind === 'size') {
                    const sizeSql = arraySizeEquals(leafArrayExpr, this.generatePlaceholder(predicate.inner.n, statementArguments));
                    return `(jsonb_typeof(${leafArrayExpr}) IS NULL OR NOT (${sizeSql}))`;
                }
                // Negation complements whatever its operand says about this array — it must not be pushed inside
                // the element scan, which would ask whether SOME element fails the condition instead.
                return `NOT (${emitChild(predicate.inner)})`;

            case 'elemMatch': {
                const alias = nextAlias();
                if (isSubDocumentBody(predicate.body)) {
                    const subTranslator = new PropertyTranslatorPgJsonbSchema(node.leafArrayNode.schema!, alias, true);
                    const result = compileWhereFilterRecursive(predicate.body.objectFilter, statementArguments, subTranslator, errors, rootFilter);
                    return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${result})`;
                }
                if (predicate.body.scalarPredicate.kind === 'compoundObject') {
                    // $exists / $type are field-level notions with no per-element meaning. The JS reference compares
                    // the body as data against each element, and a scalar element never equals that object literal.
                    return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE 1 = 0)`;
                }
                if (predicate.body.scalarPredicate.kind === 'scalar' && typeof predicate.body.scalarPredicate.value === 'string') {
                    // A bare string body asks for containment of that string among the array's elements — the jsonb
                    // `?` operator, scoped to THIS leaf array (never the whole path, which cannot descend an array).
                    const placeholder = this.generatePlaceholder(predicate.body.scalarPredicate.value, statementArguments);
                    return this.optionalWrapper(resolved, leafArrayExpr, `${leafArrayExpr} ? ${placeholder}`);
                }
                const bodyPred = predicate.body.scalarPredicate;
                // The element's text identifier, cast to numeric when the body compares numerically, mirroring the
                // leaf comparison's typed accessor. A range's `<`/`>` would otherwise compare the element as TEXT
                // (`'-8' < '-9'` is lexically true), and a conjunction can hide the range one level down.
                const elementId = this.elementNeedsNumericCast(bodyPred) ? `(${alias} #>> '{}')::numeric` : `${alias} #>> '{}'`;
                const body = this.emitPredicate(dotpropPath, resolved, bodyPred, statementArguments, errors, rootFilter, {
                    customSqlIdentifier: elementId,
                    customRawJsonb: alias,
                });
                return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${body})`;
            }

            case 'compoundObject': {
                const alias = nextAlias();
                if (isLogicFilter(predicate.filter)) {
                    throw new Error("Logic operators ($and/$or/$nor) on array values must use $elemMatch explicitly");
                }
                const subTranslator = new PropertyTranslatorPgJsonbSchema(node.leafArrayNode.schema!, alias, true);
                const result = compileWhereFilterRecursive(predicate.filter, statementArguments, subTranslator, errors, rootFilter);
                return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${result})`;
            }

            case 'scalar':
            case 'undefinedField': {
                const alias = nextAlias();
                const body = this.emitPredicate(dotpropPath, resolved, predicate, statementArguments, errors, rootFilter, {
                    customSqlIdentifier: `${alias} #>> '{}'`,
                    customRawJsonb: alias,
                });
                return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${body})`;
            }

            case 'exactArray':
                // An exact-array operand compares against the LEAF array itself, never the element carrying it.
                return this.optionalWrapper(resolved, leafArrayExpr, `${leafArrayExpr} = ${this.generatePlaceholder(predicate.value as PreparedStatementArgumentOrObject[], statementArguments)}::jsonb`);

            // A comparison operator reads the array element-wise: it holds when SOME element satisfies it.
            case 'eq':
            case 'regex': {
                const alias = nextAlias();
                const body = this.emitPredicate(dotpropPath, resolved, predicate, statementArguments, errors, rootFilter, comparisonElementContext(alias, predicate));
                return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${body})`;
            }

            case 'ne': {
                // `$ne` is the complement of `$eq` — NO element may equal the operand. Negating the comparison
                // inside the scan would instead ask whether SOME element differs, which an array holding both the
                // operand and anything else would satisfy.
                const alias = nextAlias();
                const equality: Predicate = { kind: 'eq', operand: predicate.operand };
                const body = this.emitPredicate(dotpropPath, resolved, equality, statementArguments, errors, rootFilter, comparisonElementContext(alias, equality));
                return `NOT EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${body})`;
            }

            case 'range':
                // Each bound is scanned independently, so different elements may satisfy different bounds:
                // `{$gt: 2, $lt: 4}` holds on `[1, 5]`. Binding every bound to ONE element is the question
                // `$elemMatch` asks, and it answers false on that same array.
                return `(${predicate.bounds.map(bound => {
                    const alias = nextAlias();
                    const oneBound: Predicate = { kind: 'range', bounds: [bound] };
                    const body = this.emitPredicate(dotpropPath, resolved, oneBound, statementArguments, errors, rootFilter, comparisonElementContext(alias, oneBound));
                    return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${body})`;
                }).join(' AND ')})`;
        }
    }

    /**
     * Whether a scalar `$elemMatch` body compares numerically, so the element identifier read from every spread
     * element must be cast to numeric. Without it a range's `<`/`>` compares the element as TEXT (`'-8' < '-9'` is
     * lexically true, numerically false), and a conjunction can hide the range one level down.
     */
    private elementNeedsNumericCast(predicate: Predicate): boolean {
        if (predicate.kind === 'and') return predicate.children.some(child => this.elementNeedsNumericCast(child));
        if (predicate.kind === 'range') return typeof predicate.bounds[0]?.operand === 'number';
        if (predicate.kind === 'scalar') return typeof predicate.value === 'number';
        return false;
    }


    // ── A scalar or object leaf beneath an array — read from every spread element ──

    /**
     * Emit a condition on a path that crosses arrays but ends at a scalar or object (`messages.rfc822msgid`).
     *
     * Every array on the path is spread, and the leaf is read from the resulting element. The condition matches
     * when SOME element's leaf satisfies it.
     */
    private emitSpreadLeafPredicate(dotpropPath: string, resolved: ResolvedPath, predicate: Predicate, statementArguments: PreparedStatementArgument[], errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>): string {
        const leafNode = resolved.node;
        if (!leafNode) throw new Error(`dotpropPath (${dotpropPath}) resolved without a leaf node`);
        if (predicate.kind === 'exactArray') throw new Error("Cannot compare an array to a non-array");

        const path: TreeNode[] = [];
        let target: TreeNode | undefined = leafNode;
        while (target) {
            path.unshift(target);
            target = target.parent;
        }

        let spread = spreadJsonbArrays(this.sqlColumnName, path);
        if (!spread) throw new Error("Could not locate array in path: " + dotpropPath);

        // The raw spread element (before any remaining-leaf extraction) and the leaf keys within it, for operators
        // ($exists / $type) that must probe the element by jsonb_typeof rather than compare its extracted scalar value.
        const spreadElement = spread.output_column;
        const remainingSegments: string[] = [];
        for (let i = path.length - 1; i >= 0; i--) {
            if (path[i]!.kind === 'array') break;
            if (path[i]!.name) remainingSegments.unshift(path[i]!.name);
        }
        if (remainingSegments.length > 0) {
            const leafColumn = pgJsonbAccessor(spreadElement, remainingSegments, { asText: false });
            spread = { ...spread, output_column: leafColumn, output_identifier: `${leafColumn} #>> '{}'` };
        }
        const resolvedSpread = spread;
        const multiScalarElement = this.multiScalarPaths.has(resolved.lookupPath);

        switch (predicate.kind) {
            case 'in': {
                if (predicate.operand.length === 0) return '1 = 0';
                // A boolean operand compares against the leaf's own jsonb, never its text projection, which has no
                // `= boolean` operator (see {@link hasBooleanOperand}) — as does a mixed-scalar leaf.
                if (multiScalarElement || hasBooleanOperand(predicate)) {
                    const vals = predicate.operand.map(v => toJsonbParam(v as string | number | boolean, this.binder(statementArguments)));
                    return `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${resolvedSpread.output_column} IN (${vals.join(', ')}))`;
                }
                const placeholders = predicate.operand.map(v => this.generatePlaceholder(v as PreparedStatementArgumentOrObject, statementArguments));
                return `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${resolvedSpread.output_identifier} IN (${placeholders.join(', ')}))`;
            }
            case 'nin': {
                if (predicate.operand.length === 0) return '1 = 1';
                if (multiScalarElement || hasBooleanOperand(predicate)) {
                    const vals = predicate.operand.map(v => toJsonbParam(v as string | number | boolean, this.binder(statementArguments)));
                    return `NOT EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${resolvedSpread.output_column} IN (${vals.join(', ')}))`;
                }
                const placeholders = predicate.operand.map(v => this.generatePlaceholder(v as PreparedStatementArgumentOrObject, statementArguments));
                return `NOT EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${resolvedSpread.output_identifier} IN (${placeholders.join(', ')}))`;
            }
            case 'all': {
                const conditions = predicate.elements.map(operand => {
                    if (operand === null) {
                        return `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${resolvedSpread.output_column} = 'null'::jsonb)`;
                    }
                    if (isPlainObject(operand) || Array.isArray(operand)) {
                        const placeholder = this.generatePlaceholder(operand as PreparedStatementArgumentOrObject, statementArguments);
                        return `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${resolvedSpread.output_column} = ${placeholder}::jsonb)`;
                    }
                    if (multiScalarElement || typeof operand === 'boolean') {
                        return `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${resolvedSpread.output_column} = ${toJsonbParam(operand as string | number | boolean, this.binder(statementArguments))})`;
                    }
                    const placeholder = this.generatePlaceholder(operand as PreparedStatementArgumentOrObject, statementArguments);
                    return `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${resolvedSpread.output_identifier} = ${placeholder})`;
                });
                return conditions.length === 0 ? '1 = 1' : conditions.join(' AND ');
            }
            case 'size':
                return arraySizeEquals(this.pathAccessor(resolved, false), this.generatePlaceholder(predicate.n, statementArguments));
            case 'not': {
                if (predicate.inner.kind === 'size') {
                    const acc = this.pathAccessor(resolved, false);
                    const sizeSql = arraySizeEquals(acc, this.generatePlaceholder(predicate.inner.n, statementArguments));
                    return `(${acc} IS NULL OR NOT (${sizeSql}))`;
                }
                // A negation denies the whole path, so it wraps the condition's own verdict over every element.
                return `NOT (${this.emitSpreadLeafPredicate(dotpropPath, resolved, predicate.inner, statementArguments, errors, rootFilter)})`;
            }

            // A comparison operator binds to ONE element's leaf, and the path matches when SOME element's leaf
            // satisfies it — the same leaf scope a compound condition gets.
            case 'eq':
            case 'regex':
            case 'range': {
                const rawJsonbId = resolvedSpread.output_column;
                const subClause = this.emitPredicate(dotpropPath, resolved, predicate, statementArguments, errors, rootFilter, { customSqlIdentifier: resolvedSpread.output_identifier, customRawJsonb: rawJsonbId });
                return `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${subClause})`;
            }
            case 'ne': {
                // The complement of `$eq` over the whole path: NO element's leaf may equal the operand.
                const equality: Predicate = { kind: 'eq', operand: predicate.operand };
                const rawJsonbId = resolvedSpread.output_column;
                const subClause = this.emitPredicate(dotpropPath, resolved, equality, statementArguments, errors, rootFilter, { customSqlIdentifier: resolvedSpread.output_identifier, customRawJsonb: rawJsonbId });
                return `NOT EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${subClause})`;
            }
            case 'exists': {
                if (remainingSegments.length > 0) {
                    // The field exists iff some array element carries the leaf. A whole-path jsonb_typeof cannot
                    // descend through the array, so probe each spread element.
                    const cond = `jsonb_typeof(${resolvedSpread.output_column}) IS NOT NULL`;
                    return predicate.expected
                        ? `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${cond})`
                        : `NOT EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${cond})`;
                }
                const acc = this.pathAccessor(resolved, false);
                return predicate.expected ? `jsonb_typeof(${acc}) IS NOT NULL` : `jsonb_typeof(${acc}) IS NULL`;
            }
            case 'type': {
                const placeholder = this.generatePlaceholder(mapTypeToPostgres(predicate.typeName), statementArguments);
                if (remainingSegments.length > 0) {
                    return `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE jsonb_typeof(${resolvedSpread.output_column}) = ${placeholder})`;
                }
                return `jsonb_typeof(${this.pathAccessor(resolved, false)}) = ${placeholder}`;
            }
            case 'elemMatch': {
                let subClause: string;
                if (isSubDocumentBody(predicate.body)) {
                    const subTranslator = new PropertyTranslatorPgJsonbSchema(leafNode.schema!, resolvedSpread.output_column, true);
                    subClause = compileWhereFilterRecursive(predicate.body.objectFilter, statementArguments, subTranslator, errors, rootFilter);
                } else if (predicate.body.scalarPredicate.kind === 'compoundObject') {
                    subClause = '1 = 0';
                } else {
                    const rawJsonbId = resolvedSpread.output_column;
                    subClause = this.emitPredicate(dotpropPath, resolved, predicate.body.scalarPredicate, statementArguments, errors, rootFilter, { customSqlIdentifier: resolvedSpread.output_identifier, customRawJsonb: rawJsonbId });
                }
                return `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${subClause})`;
            }
            case 'scalar':
            case 'undefinedField': {
                const rawJsonbId = resolvedSpread.output_column;
                const subClause = this.emitPredicate(dotpropPath, resolved, predicate, statementArguments, errors, rootFilter, { customSqlIdentifier: resolvedSpread.output_identifier, customRawJsonb: rawJsonbId });
                return `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${subClause})`;
            }
            default:
                break;
        }

        // Every remaining operator reads as a sub-document match over the spread elements.
        const condition = reconstructFieldCondition(predicate);
        if (isLogicFilter(condition)) {
            throw new Error("Logic operators ($and/$or/$nor) on array values must use $elemMatch explicitly");
        }
        const subTranslator = new PropertyTranslatorPgJsonbSchema(leafNode.schema!, resolvedSpread.output_column, true);
        const result = compileWhereFilterRecursive(condition, statementArguments, subTranslator, errors, rootFilter);
        return `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${result})`;
    }

    // ── Leaf comparisons — the field itself, or one already-spread element ──

    /**
     * Emit a leaf-level SQL comparison of one value.
     * $eq → =, range → >/</>=/<= , $regex → ~ , scalar → =, object/array → =::jsonb, undefined → IS NULL.
     * Optional/nullable paths are wrapped with a guard that keeps the verdict definite.
     */
    private emitLeafComparison(dotpropPath: string, resolved: ResolvedPath, predicate: Predicate, statementArguments: PreparedStatementArgument[], errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>, context: EmitContext): string {
        const { customSqlIdentifier } = context;

        // A scalar-equality filter whose operand's runtime type differs from the field's declared scalar kind can
        // never match — matchJavascriptObject compares with === (`'7' === 7` is false) — yet Postgres's typed cast
        // would coerce text↔numeric and spuriously match. Return a definite non-match. (Enums keep their own cast
        // path; multi-scalar and literal unions already returned via emitMultiScalarLeaf.)
        if (customSqlIdentifier === undefined && (resolved.leafKind === 'string' || resolved.leafKind === 'number' || resolved.leafKind === 'boolean')) {
            const eqOperand = predicate.kind === 'eq' ? predicate.operand
                : predicate.kind === 'scalar' ? predicate.value : undefined;
            if (eqOperand !== undefined && eqOperand !== null && typeof eqOperand !== resolved.leafKind) {
                return '1 = 0';
            }
        }

        switch (predicate.kind) {
            case 'ne': {
                // MongoDB: NaN equals nothing, so $ne: NaN matches every value (and Mongo's "ne matches missing" rule also applies). See MONGO-DIVERGENCES.md §7.
                if (typeof predicate.operand === 'number' && Number.isNaN(predicate.operand)) return '1=1';
                const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
                const placeholder = this.generatePlaceholder(predicate.operand as PreparedStatementArgumentOrObject, statementArguments);
                return this.optionalWrapperNullMatches(resolved, sqlIdentifier, `${sqlIdentifier} != ${placeholder}`);
            }
            case 'in': {
                if (predicate.operand.length === 0) return '1 = 0';
                const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
                const placeholders = predicate.operand.map(v => this.generatePlaceholder(v as PreparedStatementArgumentOrObject, statementArguments));
                return this.optionalWrapper(resolved, sqlIdentifier, `${sqlIdentifier} IN (${placeholders.join(', ')})`);
            }
            case 'nin': {
                if (predicate.operand.length === 0) return '1 = 1';
                const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
                const placeholders = predicate.operand.map(v => this.generatePlaceholder(v as PreparedStatementArgumentOrObject, statementArguments));
                return this.optionalWrapperNullMatches(resolved, sqlIdentifier, `${sqlIdentifier} NOT IN (${placeholders.join(', ')})`);
            }
            case 'not':
                return this.emitNot(dotpropPath, resolved, predicate.inner, statementArguments, errors, rootFilter, context);

            // $exists / $type / $size probe the stored jsonb (-> not ->>): jsonb_typeof keeps a present JSON null (a
            // value) distinct from a missing path, which the extracted identifier cannot.
            case 'exists':
                return predicate.expected
                    ? `jsonb_typeof(${this.pathAccessor(resolved, false)}) IS NOT NULL`
                    : `jsonb_typeof(${this.pathAccessor(resolved, false)}) IS NULL`;
            case 'type':
                return `jsonb_typeof(${this.pathAccessor(resolved, false)}) = ${this.generatePlaceholder(mapTypeToPostgres(predicate.typeName), statementArguments)}`;
            case 'size':
                return arraySizeEquals(this.pathAccessor(resolved, false), this.generatePlaceholder(predicate.n, statementArguments));

            case 'regex':
                return this.emitRegex(dotpropPath, resolved, predicate, statementArguments, rootFilter, customSqlIdentifier);

            case 'eq': {
                // MongoDB: nothing equals NaN. See MONGO-DIVERGENCES.md §7.
                if (typeof predicate.operand === 'number' && Number.isNaN(predicate.operand)) return '1=0';
                const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
                if (predicate.operand === null) return `${sqlIdentifier} IS NULL`;
                const placeholder = this.generatePlaceholder(predicate.operand, statementArguments);
                return this.optionalWrapper(resolved, sqlIdentifier, `${sqlIdentifier} = ${placeholder}`);
            }
            case 'range': {
                const firstOperandIsString = typeof predicate.bounds[0]?.operand === 'string';
                const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, [firstOperandIsString ? 'string' : 'number']);
                const operators = predicate.bounds.map(bound => {
                    // MongoDB: every comparison with NaN returns false. See MONGO-DIVERGENCES.md §7.
                    if (typeof bound.operand === 'number' && Number.isNaN(bound.operand)) return '1=0';
                    const placeholder = this.generatePlaceholder(bound.operand as PreparedStatementArgumentOrObject, statementArguments);
                    return ValueComparisonRangeOperatorsSqlFunctions[bound.operator as ValueComparisonRangeOperatorsTyped](sqlIdentifier, placeholder);
                });
                return this.optionalWrapper(resolved, sqlIdentifier, operators.length > 1 ? `(${operators.join(' AND ')})` : operators[0]!);
            }

            case 'scalar': {
                if (predicate.value === null) {
                    // An explicit null filter matches SQL NULL. No guard: an IS NOT NULL wrapper would contradict it.
                    const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
                    return `${sqlIdentifier} IS NULL`;
                }
                const placeholder = this.generatePlaceholder(predicate.value, statementArguments);
                const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
                return this.optionalWrapper(resolved, sqlIdentifier, `${sqlIdentifier} = ${placeholder}`);
            }
            case 'undefinedField': {
                const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
                return this.optionalWrapper(resolved, sqlIdentifier, `${sqlIdentifier} IS NULL`);
            }

            case 'exactArray': {
                const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['array']);
                const placeholder = this.generatePlaceholder(predicate.value as PreparedStatementArgumentOrObject[], statementArguments);
                return this.optionalWrapper(resolved, sqlIdentifier, `${sqlIdentifier} = ${placeholder}::jsonb`);
            }
            // An operator payload the field's own shape cannot answer (an array operator on a scalar field) compares
            // as data, exactly as the value-driven matcher does — and nothing equals an operator payload.
            case 'compoundObject':
            case 'elemMatch':
            case 'all': {
                const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['object']);
                const value = predicate.kind === 'compoundObject' ? predicate.filter : reconstructFieldCondition(predicate);
                const placeholder = this.generatePlaceholder(value as PreparedStatementArgumentOrObject, statementArguments);
                return this.optionalWrapper(resolved, sqlIdentifier, `${sqlIdentifier} = ${placeholder}::jsonb`);
            }

            case 'and':
                // Conjunctions are decomposed before a leaf is reached.
                throw new Error("A conjunction cannot be emitted as a leaf comparison");
        }
    }

    /**
     * Negation complements its operand, on a present field and on a missing one alike: `{$not: {$ne: 5}}` does not
     * match a missing field, because `{$ne: 5}` does.
     *
     * The guard is a PRESENCE probe rather than the extracted value. The raw `->` accessor is SQL NULL only for an
     * absent path; a stored JSON null reads back as `'null'::jsonb`. Text extraction (`->>`) returns SQL NULL for
     * both, and under negation that conflation flips the verdict — so the probe stays on the raw jsonb value. Which
     * way it reads — short-circuit on absence, or require presence — is decided by what the whole negation says
     * about a missing field.
     */
    private emitNot(dotpropPath: string, resolved: ResolvedPath, inner: Predicate, statementArguments: PreparedStatementArgument[], errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>, context: EmitContext): string {
        const innerSql = this.emitPredicate(dotpropPath, resolved, inner, statementArguments, errors, rootFilter, context);
        if (context.customSqlIdentifier !== undefined) {
            // An array element is always present, so presence is not a question its negation can ask.
            return this.optionalWrapperNullMatches(resolved, context.customSqlIdentifier, `NOT (${innerSql})`);
        }
        if (!resolved.known) return `NOT (${innerSql})`;

        const presence = this.pathAccessor(resolved, false);
        return matchesMissingField({ kind: 'not', inner })
            ? `(${presence} IS NULL OR NOT (${innerSql}))`
            : `(${presence} IS NOT NULL AND NOT (${innerSql}))`;
    }

    /**
     * $regex — Postgres POSIX regex (`~`); JS flags become an embedded `(?…)` option prefix.
     *
     * A broken pattern is a REJECTION (the value-driven matcher throws on it too), surfaced as 'not well-defined'
     * so the seam rethrows; a valid pattern Postgres cannot faithfully express is a capability gap, surfaced as a skip.
     */
    private emitRegex(dotpropPath: string, resolved: ResolvedPath, predicate: Predicate & { kind: 'regex' }, statementArguments: PreparedStatementArgument[], rootFilter: WhereFilterDefinition<T>, customSqlIdentifier: string | undefined): string {
        const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['string']);
        // Mirror the JS oracle (`new RegExp($regex, $options)`): an invalid pattern or an invalid flag is a
        // REJECTION (the reference throws), surfaced as 'not well-defined' so the seam rethrows (vs a skip).
        try {
            new RegExp(predicate.pattern, predicate.options);
        } catch {
            this.pushRegexError(dotpropPath, reconstructFieldCondition(predicate), rootFilter, 'regex_invalid', `$regex is not well-defined: /${predicate.pattern}/${predicate.options ?? ''}`);
            return 'FALSE';
        }
        const prefix = pgRegexOptionPrefix(predicate.options);
        if (prefix === undefined) {
            // A valid JS flag Postgres cannot faithfully express (e.g. sticky/unicode) → capability gap (skip).
            this.pushRegexError(dotpropPath, reconstructFieldCondition(predicate), rootFilter, 'regex_options', '$regex $options is unsupported for Postgres translation');
            return 'FALSE';
        }
        const placeholder = this.generatePlaceholder(prefix + predicate.pattern, statementArguments);
        return this.optionalWrapper(resolved, sqlIdentifier, `${sqlIdentifier} ~ ${placeholder}`);
    }
}



/**
 * PropertyTranslator for Postgres JSONB that derives its TreeNodeMap from a Zod schema automatically.
 *
 * @example
 * const pm = new PropertyTranslatorPgJsonbSchema(ContactSchema, 'recordColumn');
 */
export class PropertyTranslatorPgJsonbSchema<T extends Record<string, any> = Record<string, any>> extends BasePropertyTranslatorJsonb<T> implements IPropertyTranslator<T> {
    constructor(schema: z.ZodSchema<T>, sqlColumnName: string, doNotSpreadArray?: boolean) {
        const result = convertSchemaToDotPropPathTree(schema);
        super(result.map, sqlColumnName, doNotSpreadArray);
        this.schemaErrors = [
            ...findShapeAmbiguousPaths(schema).map((a): WhereClauseError => ({
                kind: 'schema_ambiguous',
                dotprop_path: a.dotprop_path,
                message: `Field '${a.dotprop_path}' has a shape-ambiguous schema (an array coexists with a non-array variant: ${a.arm_kinds.join(' | ')}); a schema-driven SQL engine cannot represent it.`,
            })),
            ...findNormalizingPaths(schema).map((n): WhereClauseError => ({
                kind: 'schema_normalizes',
                dotprop_path: n.dotprop_path,
                message: `Field '${n.dotprop_path}' has a value-normalizing schema (${n.reason}); a schema-driven SQL engine compares the raw stored value and cannot replicate the coercion/transform.`,
            })),
        ];
        // Union into (not overwrite) the literal-kind paths the base constructor already added from the node map.
        for (const m of findMultiScalarUnionPaths(schema)) this.multiScalarPaths.add(m.dotprop_path);
    }
}
/**
 * PropertyTranslator for Postgres JSONB that accepts a pre-built TreeNodeMap directly (when schema introspection is already done).
 */
export class PropertyTranslatorPgJsonb<T extends Record<string, any> = Record<string, any>> extends BasePropertyTranslatorJsonb<T> implements IPropertyTranslator<T> {

    constructor(nodeMap: TreeNodeMap, sqlColumnName: string, doNotSpreadArray?: boolean) {
        super(nodeMap, sqlColumnName, doNotSpreadArray);
    }
}
