
import { z } from "zod";
import type { WhereFilterDefinition } from "../../types.ts";
import { convertSchemaToDotPropPathTree } from "../../../dot-prop-paths/schema-tree.ts";
import type { TreeNode, TreeNodeMap, ZodKind } from "../../../dot-prop-paths/schema-tree.ts";
import { isUnspreadableRecordPath, resolvePath } from "../../../dot-prop-paths/resolvePath.ts";
import type { ResolvedPath } from "../../../dot-prop-paths/resolvePath-types.ts";
import { findShapeAmbiguousPaths, findMultiScalarUnionPaths } from "../../../dot-prop-paths/shape-ambiguity.ts";
import { findNormalizingPaths } from "../../../dot-prop-paths/schema-normalization.ts";
import isPlainObject from "../../../utils/isPlainObject.ts";
import { sqliteJsonPathSegments, sqliteSqlStringLiteral } from "../../../utils/sql/sqlite/sqliteJsonPath.ts";
import { convertDotPropPathToSqliteJsonPath, SQLITE_UNSAFE_WARNING } from "./convertDotPropPathToSqliteJsonPath.ts";
import { isLogicFilter } from "../../typeguards.ts";
import { isOperatorKey, matchesMissingField, parseFieldPredicate } from "../../ast/index.ts";
import type { ElemMatchBody, Predicate } from "../../ast/index.ts";
import { planSqlArrayTraversal } from "../planSqlArrayTraversal.ts";
import type { SqlPredicate, TraverseArrayPredicate } from "../planSqlArrayTraversal.ts";
import { reconstructFieldCondition } from "../reconstructFieldCondition.ts";
import { compileWhereFilterRecursive } from "../compileWhereFilter.ts";
import { isPreparedStatementArgument } from "../types.ts";
import type { IPropertyTranslator, PreparedStatementArgument, SqlDialect, WhereClauseError, WhereClauseFilterReasonCode } from "../types.ts";
import { ValueComparisonRangeOperatorsSqlFunctions } from "../sharedSqlOperators.ts";
import { emitMultiScalarComparison } from "./multiScalarSqlite.ts";
import { arraySizeEquals, asScalarOperand, jsonDeepEquals, jsonTypeTest, strictJsonValueEquals } from "./sqliteJsonFragments.ts";
import type { BindValue } from "./sqliteJsonFragments.ts";
import { translateRegexToLike } from "./regexToLike.ts";
import { spreadJsonArraysSqlite } from "./spreadJsonArraysSqlite.ts";

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
    /** A spread element's raw `value`/`type` columns, so a mixed-scalar element compares type-faithfully. */
    readonly customSpread?: { valueExpr: string, typeExpr: string } | undefined;
    /** The path crosses an array but ends at a scalar or object, which is read from every spread element. */
    readonly spreadLeafBelowArray?: boolean;
};

/** Yields a fresh `json_each` alias each call, so sibling and nested spreads never shadow one another. */
type AliasFactory = () => string;

/** The operators whose verdict on a field the schema does not describe is decided before any SQL is emitted. */
const MISSING_FIELD_KINDS: ReadonlySet<Predicate['kind']> = new Set<Predicate['kind']>(['ne', 'nin', 'not', 'exists', 'type', 'size']);

/** Whether an `$elemMatch` body describes an object element's fields, rather than an element's own value. */
function isSubDocumentBody(body: ElemMatchBody): body is ElemMatchBody & { objectFilter: WhereFilterDefinition } {
    return body.objectFilter !== undefined && !Object.keys(body.objectFilter).some(isOperatorKey);
}

/**
 * SQLite JSON implementation of IPropertyTranslator.
 * Generates SQL fragments for a single JSON TEXT column using TreeNodeMap for path validation,
 * json_each for array spreading, and ? positional placeholders.
 */
class BasePropertyTranslatorSqliteJson<T extends Record<string, any> = Record<string, any>> implements IPropertyTranslator<T> {
    readonly dialect: SqlDialect = 'sqlite';
    /** Schema-level errors found at construction from a Zod schema (shape-ambiguous fields); see {@link IPropertyTranslator}. */
    schemaErrors: WhereClauseError[] = [];
    /** Dot-prop paths whose union mixes ≥2 scalar kinds — compared via json_type + json_extract, not a single cast. */
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
    }

    /** The SQL literal addressing a resolved path's leaf. Every key is quoted, so a key can only ever be data. */
    private pathLiteral(resolved: ResolvedPath): string {
        return sqliteSqlStringLiteral(sqliteJsonPathSegments(resolved.segments));
    }

    /** The SQL literal addressing a run of keys from a spread element. */
    private segmentsLiteral(segments: readonly string[]): string {
        return sqliteSqlStringLiteral(sqliteJsonPathSegments(segments));
    }

    /** Wraps convertDotPropPathToSqliteJsonPath using this instance's column name and nodeMap. On failure, records error and returns 'FALSE'. */
    private getSqlIdentifier(dotPropPath: string, errorIfNotAsExpected?: ZodKind[], customColumnName?: string): string {
        const result = convertDotPropPathToSqliteJsonPath(customColumnName ?? this.sqlColumnName, dotPropPath, this.nodeMap, errorIfNotAsExpected);
        if (!result.success) {
            this.conversionErrors.push({ kind: 'path_conversion', error: result.error, message: result.error.message });
            return 'FALSE';
        }
        return result.expression;
    }

    /**
     * Fresh `json_each` aliases for one field condition, continuing the numbering of any spread already emitted.
     * The prefix is derived from the column so a translator scoped to an array element cannot collide with the
     * spread that produced that element.
     */
    private aliasFactory(alreadyUsed: number): AliasFactory {
        const match = this.sqlColumnName.match(/^(je\S*)\./);
        const base = match ? match[1] + '_' : 'je';
        let next = alreadyUsed;
        return () => `${base}${++next}`;
    }

    /**
     * Record a $regex translation failure. A 'not well-defined' message routes the seam to a REJECTION (an invalid
     * pattern/flag — the JS oracle throws on those too); any other message routes it to a SKIP (a capability gap
     * LIKE cannot express). Pushed to conversionErrors so it surfaces whether or not the caller threaded an errors
     * array (e.g. from inside $elemMatch).
     */
    private pushRegexError(dotpropPath: string, filter: unknown, rootFilter: WhereFilterDefinition<T>, reasonCode: WhereClauseFilterReasonCode, message: string): void {
        const sub = { [dotpropPath]: filter } as WhereFilterDefinition;
        this.conversionErrors.push({ kind: 'filter', reasonCode, sub_filter: sub, root_filter: rootFilter, message });
    }

    /** A path-conversion error in the shape the shared converter produces, so callers classify it uniformly. */
    private pathError(type: 'invalid_path' | 'unsupported_kind', dotPropPath: string, message: string): WhereClauseError {
        return { kind: 'path_conversion', error: { type, dotPropPath, message }, message };
    }

    /** Pushes a value into the statementArguments array and returns `?`. Objects/arrays are JSON.stringify'd first. */
    protected generatePlaceholder(value: unknown, statementArguments: PreparedStatementArgument[]): string {
        let bound: unknown = value;
        if (isPlainObject(bound) || Array.isArray(bound)) bound = JSON.stringify(bound);
        // better-sqlite3 cannot bind a JS boolean. A stored JSON boolean reads back through json_extract / json_each
        // as the integer 1/0, so bind that shape to keep a plain `= ?` comparison faithful (a boolean field can only
        // hold booleans; multi-scalar unions never reach here — they compare via the type-faithful json_type path).
        if (typeof bound === 'boolean') bound = bound ? 1 : 0;
        if (!isPreparedStatementArgument(bound)) {
            throw new Error("Placeholders for SQL can only be string/number/boolean");
        }
        statementArguments.push(bound);
        return '?';
    }

    /** A binder over one statement's argument list, for the fragment builders that take literals. */
    private binder(statementArguments: PreparedStatementArgument[]): BindValue {
        return (value: unknown) => this.generatePlaceholder(value, statementArguments);
    }

    /** Strict JSON value-equality of one element or field value. Shared by $in / $nin / $all and the leaf comparison. */
    private strictMultiScalarMatch(typeExpr: string, valueExpr: string, value: unknown, statementArguments: PreparedStatementArgument[]): string {
        return strictJsonValueEquals(typeExpr, valueExpr, asScalarOperand(value), this.binder(statementArguments));
    }

    /** Key-order-insensitive deep equality of a stored JSON value against a literal object or array. */
    private deepEquals(accessorExpr: string, value: unknown, statementArguments: PreparedStatementArgument[]): string {
        return jsonDeepEquals(accessorExpr, value, this.binder(statementArguments));
    }

    /** A `$type` check, as a comparison of the value's json_type tag. */
    private typeTest(columnExpr: string, pathLiteral: string, typeName: string, statementArguments: PreparedStatementArgument[]): string {
        return jsonTypeTest(columnExpr, pathLiteral, typeName, this.binder(statementArguments));
    }

    /**
     * Forces leaf comparisons to a definite TRUE/FALSE so any enclosing NOT (from $nor or a parent $not) doesn't
     * propagate NULL under SQL 3VL. Unconditional for a resolvable path, so semantics agree with
     * matchJavascriptObject regardless of schema annotation.
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
     * The path is resolved ONCE and the resolution travels with the condition, so every accessor, JSON-path literal
     * and node lookup below reads it rather than re-splitting the raw path. The condition is parsed into a predicate
     * tree, and a path ending at an array is planned as a traversal that binds the whole condition to one leaf array.
     */
    generateSql(dotpropPath: string, filter: WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[], errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>): string {
        this.conversionErrors = [];

        const result = resolvePath(dotpropPath, this.nodeMap);
        let sql: string;
        if (!result.success) {
            this.conversionErrors.push(this.pathError('invalid_path', dotpropPath, `Invalid dotPropPath. ${SQLITE_UNSAFE_WARNING}`));
            sql = 'FALSE';
        } else if (isUnspreadableRecordPath(result.resolved)) {
            // Array spreading is planned from the schema's path map, which has no node for a record's dynamic key.
            // Refuse the path for EVERY operator — including those that build their own accessor — so a caller sees
            // an acknowledged capability gap rather than a confident `false` for a row that plainly matches.
            this.conversionErrors.push(this.pathError('unsupported_kind', dotpropPath, `A dotPropPath that crosses an array beneath a record key cannot be addressed. ${SQLITE_UNSAFE_WARNING}`));
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
            predicate = planSqlArrayTraversal(resolved, parsed, this.nodeMap);
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
     * A mixed-scalar union field compares by strict JSON value-equality rather than in a single SQL type. The
     * comparison reads the field directly, or — when the value is an already-spread array element — that element's
     * own `value`/`type` columns.
     *
     * @returns The strict comparison, or `undefined` when the field or the predicate is not one it answers.
     */
    private emitMultiScalarLeaf(resolved: ResolvedPath, predicate: Predicate, statementArguments: PreparedStatementArgument[], context: EmitContext): string | undefined {
        const applies = this.multiScalarPaths.has(resolved.lookupPath)
            && (context.customSqlIdentifier === undefined || context.customSpread !== undefined);
        if (!applies) return undefined;

        const pathLit = this.pathLiteral(resolved);
        const typeExpr = context.customSpread?.typeExpr ?? `json_type(${this.sqlColumnName}, ${pathLit})`;
        const valueExpr = context.customSpread?.valueExpr ?? `json_extract(${this.sqlColumnName}, ${pathLit})`;
        return emitMultiScalarComparison(predicate, typeExpr, valueExpr, this.binder(statementArguments));
    }

    // ═══════════════════════════════════════════════════════════════════
    // Array traversal — a condition on an array path binds to ONE leaf array
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Bind the condition to one leaf array, spreading whatever arrays lie above it.
     *
     * The leaf array is named as a (source, path) pair rather than extracted, so `json_each` is handed a live
     * value and never a NULL. When arrays are spread, a row exists per intermediate element and the condition is
     * satisfied if ANY of them holds the leaf array that satisfies it.
     */
    private emitTraverseArray(dotpropPath: string, resolved: ResolvedPath, node: TraverseArrayPredicate, statementArguments: PreparedStatementArgument[], errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>): string {
        const leafPathLiteral = this.segmentsLiteral(node.leafSegments);

        if (node.intermediates.length === 0) {
            const nextAlias = this.aliasFactory(0);
            return this.emitLeafArrayPredicate(dotpropPath, resolved, node, this.sqlColumnName, leafPathLiteral, node.child, statementArguments, errors, rootFilter, nextAlias);
        }

        const spread = spreadJsonArraysSqlite(this.sqlColumnName, [...node.intermediates]);
        if (!spread) throw new Error("Could not locate array in path: " + dotpropPath);
        const spreadArrayCount = node.intermediates.filter(intermediate => intermediate.kind === 'array').length;
        const nextAlias = this.aliasFactory(spreadArrayCount);
        const childSql = this.emitLeafArrayPredicate(dotpropPath, resolved, node, spread.output_column, leafPathLiteral, node.child, statementArguments, errors, rootFilter, nextAlias);

        const someLeafSatisfies = `EXISTS (SELECT 1 FROM ${spread.sql} WHERE ${childSql})`;
        // With no intermediate elements there is no leaf array at all, which is what a missing field means. The
        // condition's own verdict on a missing field then decides, exactly as it does for an unspread path.
        return matchesMissingField(node.child)
            ? `(${someLeafSatisfies} OR NOT EXISTS (SELECT 1 FROM ${spread.sql}))`
            : someLeafSatisfies;
    }

    /**
     * Emit a condition against ONE leaf array, addressed as `json_each(leafSource, leafPathLiteral)`.
     *
     * A conjunction here is the whole point: every operator is judged against the same leaf array, so a `$size`
     * and an `$all` cannot be satisfied by two different arrays reached by the same path.
     */
    private emitLeafArrayPredicate(dotpropPath: string, resolved: ResolvedPath, node: TraverseArrayPredicate, leafSource: string, leafPathLiteral: string, predicate: Predicate, statementArguments: PreparedStatementArgument[], errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>, nextAlias: AliasFactory): string {
        const emitChild = (child: Predicate): string => this.emitLeafArrayPredicate(dotpropPath, resolved, node, leafSource, leafPathLiteral, child, statementArguments, errors, rootFilter, nextAlias);
        const multiScalarElement = this.multiScalarPaths.has(resolved.lookupPath);
        const elements = (alias: string) => `json_each(${leafSource}, ${leafPathLiteral}) AS ${alias}`;
        const elementContext = (alias: string): EmitContext => ({
            customSqlIdentifier: `${alias}.value`,
            customSpread: multiScalarElement ? { valueExpr: `${alias}.value`, typeExpr: `${alias}.type` } : undefined,
        });

        switch (predicate.kind) {
            case 'and':
                return `(${predicate.children.map(emitChild).join(' AND ')})`;

            // $in / $nin read the array as a set: they intersect it rather than compare it whole.
            case 'in': {
                const alias = nextAlias();
                if (multiScalarElement) {
                    if (predicate.operand.length === 0) return '1 = 0';
                    const conds = predicate.operand.map(v => this.strictMultiScalarMatch(`${alias}.type`, `${alias}.value`, asScalarOperand(v), statementArguments));
                    return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE (${conds.join(' OR ')}))`;
                }
                const placeholders = predicate.operand.map(v => this.generatePlaceholder(v, statementArguments));
                return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${alias}.value IN (${placeholders.join(', ')}))`;
            }
            case 'nin': {
                const alias = nextAlias();
                if (multiScalarElement) {
                    if (predicate.operand.length === 0) return '1 = 1';
                    const conds = predicate.operand.map(v => this.strictMultiScalarMatch(`${alias}.type`, `${alias}.value`, asScalarOperand(v), statementArguments));
                    return `NOT EXISTS (SELECT 1 FROM ${elements(alias)} WHERE (${conds.join(' OR ')}))`;
                }
                const placeholders = predicate.operand.map(v => this.generatePlaceholder(v, statementArguments));
                return `NOT EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${alias}.value IN (${placeholders.join(', ')}))`;
            }

            case 'all': {
                // An empty $all is vacuously satisfied by any array.
                if (predicate.elements.length === 0) return '1 = 1';
                const conditions = predicate.elements.map(operand => {
                    const alias = nextAlias();
                    if (operand === null) {
                        // A JSON null element: match by the json_each type tag. A `value = ?` bind cannot represent
                        // null, and under SQL 3VL `value = NULL` is never true even for a null element.
                        return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${alias}.type = 'null')`;
                    }
                    if (isPlainObject(operand) || Array.isArray(operand)) {
                        // A structural element: EXACT deep equality, never a serialized-text compare. The JS reference
                        // is `value.some(el => deepEql(el, operand))`, so an element carrying extra keys must NOT
                        // match, while one whose keys are in another order must.
                        return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${this.deepEquals(`${alias}.value`, operand, statementArguments)})`;
                    }
                    if (multiScalarElement) {
                        return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${this.strictMultiScalarMatch(`${alias}.type`, `${alias}.value`, asScalarOperand(operand), statementArguments)})`;
                    }
                    const placeholder = this.generatePlaceholder(operand, statementArguments);
                    return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${alias}.value = ${placeholder})`;
                });
                return conditions.join(' AND ');
            }

            case 'size':
                return arraySizeEquals(leafSource, leafPathLiteral, this.generatePlaceholder(predicate.n, statementArguments));

            case 'exists':
                // json_type keeps a present JSON null (a value) distinct from a missing key, which the extracted
                // value cannot.
                return predicate.expected
                    ? `json_type(${leafSource}, ${leafPathLiteral}) IS NOT NULL`
                    : `json_type(${leafSource}, ${leafPathLiteral}) IS NULL`;

            case 'type':
                return this.typeTest(leafSource, leafPathLiteral, predicate.typeName, statementArguments);

            case 'not':
                if (predicate.inner.kind === 'size') {
                    const sizeSql = arraySizeEquals(leafSource, leafPathLiteral, this.generatePlaceholder(predicate.inner.n, statementArguments));
                    return `(json_type(${leafSource}, ${leafPathLiteral}) IS NULL OR NOT (${sizeSql}))`;
                }
                return this.emitSubFilterOverElements(node, leafSource, leafPathLiteral, predicate, statementArguments, errors, rootFilter, nextAlias);

            case 'elemMatch': {
                const alias = nextAlias();
                if (isSubDocumentBody(predicate.body)) {
                    const subTranslator = new PropertyTranslatorSqliteJsonSchema(node.leafArrayNode.schema!, `${alias}.value`, true);
                    const result = compileWhereFilterRecursive(predicate.body.objectFilter, statementArguments, subTranslator, errors, rootFilter);
                    return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${result})`;
                }
                if (predicate.body.scalarPredicate.kind === 'compoundObject') {
                    // $exists / $type are field-level notions with no per-element meaning. The JS reference compares
                    // the body as data against each element, and a scalar element never equals that object literal.
                    return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE 1 = 0)`;
                }
                const body = this.emitPredicate(dotpropPath, resolved, predicate.body.scalarPredicate, statementArguments, errors, rootFilter, elementContext(alias));
                return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${body})`;
            }

            case 'compoundObject': {
                const alias = nextAlias();
                if (isLogicFilter(predicate.filter)) {
                    throw new Error("Logic operators ($and/$or/$nor) on array values must use $elemMatch explicitly");
                }
                const subTranslator = new PropertyTranslatorSqliteJsonSchema(node.leafArrayNode.schema!, `${alias}.value`, true);
                const result = compileWhereFilterRecursive(predicate.filter, statementArguments, subTranslator, errors, rootFilter);
                return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${result})`;
            }

            case 'scalar':
            case 'undefinedField': {
                const alias = nextAlias();
                const body = this.emitPredicate(dotpropPath, resolved, predicate, statementArguments, errors, rootFilter, elementContext(alias));
                return `EXISTS (SELECT 1 FROM ${elements(alias)} WHERE ${body})`;
            }

            case 'exactArray': {
                const accessor = `json_extract(${leafSource}, ${leafPathLiteral})`;
                return this.optionalWrapper(resolved, accessor, this.deepEquals(accessor, predicate.value, statementArguments));
            }

            // A scalar operator does not describe the array itself, so it reads as a sub-document match over the
            // array's elements — the same reading a bare sub-document gets.
            case 'eq':
            case 'ne':
            case 'range':
            case 'regex':
                return this.emitSubFilterOverElements(node, leafSource, leafPathLiteral, predicate, statementArguments, errors, rootFilter, nextAlias);
        }
    }

    /** Apply a condition to each element of a leaf array as a sub-filter over that element's fields. */
    private emitSubFilterOverElements(node: TraverseArrayPredicate, leafSource: string, leafPathLiteral: string, predicate: Predicate, statementArguments: PreparedStatementArgument[], errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>, nextAlias: AliasFactory): string {
        const alias = nextAlias();
        const subTranslator = new PropertyTranslatorSqliteJsonSchema(node.leafArrayNode.schema!, `${alias}.value`, true);
        const result = compileWhereFilterRecursive(reconstructFieldCondition(predicate), statementArguments, subTranslator, errors, rootFilter);
        return `EXISTS (SELECT 1 FROM json_each(${leafSource}, ${leafPathLiteral}) AS ${alias} WHERE ${result})`;
    }

    // ═══════════════════════════════════════════════════════════════════
    // A scalar or object leaf beneath an array — read from every spread element
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Emit a condition on a path that crosses arrays but ends at a scalar or object (`messages.rfc822msgid`).
     *
     * Every array on the path is spread, and the leaf is read from the resulting element. The condition matches
     * when SOME element's leaf satisfies it.
     */
    private emitSpreadLeafPredicate(dotpropPath: string, resolved: ResolvedPath, predicate: Predicate, statementArguments: PreparedStatementArgument[], errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>): string {
        const leafNode = this.nodeMap[resolved.lookupPath];
        if (!leafNode) throw new Error(`dotpropPath (${dotpropPath}) is not known in this.nodeMap`);
        if (predicate.kind === 'exactArray') throw new Error("Cannot compare an array to a non-array");

        const path: TreeNode[] = [];
        let target: TreeNode | undefined = leafNode;
        while (target) {
            path.unshift(target);
            target = target.parent;
        }

        let spread = spreadJsonArraysSqlite(this.sqlColumnName, path);
        if (!spread) throw new Error("Could not locate array in path: " + dotpropPath);

        // The raw spread element (before any remaining-leaf extraction) and the leaf path within it, for operators
        // ($exists / $type) that must probe the element by json_type rather than compare its extracted scalar value.
        const spreadElement = spread.output_column;
        const remainingSegments: string[] = [];
        for (let i = path.length - 1; i >= 0; i--) {
            if (path[i]!.kind === 'array') break;
            if (path[i]!.name) remainingSegments.unshift(path[i]!.name);
        }
        const spreadLeafPathLiteral = remainingSegments.length > 0 ? this.segmentsLiteral(remainingSegments) : undefined;
        if (spreadLeafPathLiteral !== undefined) {
            const extracted = `json_extract(${spread.output_column}, ${spreadLeafPathLiteral})`;
            spread = { ...spread, output_column: extracted, output_identifier: extracted };
        }
        const resolvedSpread = spread;
        const multiScalarElement = this.multiScalarPaths.has(resolved.lookupPath);

        switch (predicate.kind) {
            case 'in': {
                if (multiScalarElement) {
                    if (predicate.operand.length === 0) return '1 = 0';
                    const conds = predicate.operand.map(v => this.strictMultiScalarMatch(resolvedSpread.output_type, resolvedSpread.output_column, asScalarOperand(v), statementArguments));
                    return `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE (${conds.join(' OR ')}))`;
                }
                const placeholders = predicate.operand.map(v => this.generatePlaceholder(v, statementArguments));
                return `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${resolvedSpread.output_identifier} IN (${placeholders.join(', ')}))`;
            }
            case 'nin': {
                if (multiScalarElement) {
                    if (predicate.operand.length === 0) return '1 = 1';
                    const conds = predicate.operand.map(v => this.strictMultiScalarMatch(resolvedSpread.output_type, resolvedSpread.output_column, asScalarOperand(v), statementArguments));
                    return `NOT EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE (${conds.join(' OR ')}))`;
                }
                const placeholders = predicate.operand.map(v => this.generatePlaceholder(v, statementArguments));
                return `NOT EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${resolvedSpread.output_identifier} IN (${placeholders.join(', ')}))`;
            }
            case 'all': {
                const conditions = predicate.elements.map(operand => {
                    if (operand === null) {
                        return `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${resolvedSpread.output_type} = 'null')`;
                    }
                    if (isPlainObject(operand) || Array.isArray(operand)) {
                        return `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${this.deepEquals(resolvedSpread.output_column, operand, statementArguments)})`;
                    }
                    if (multiScalarElement) {
                        return `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${this.strictMultiScalarMatch(resolvedSpread.output_type, resolvedSpread.output_column, asScalarOperand(operand), statementArguments)})`;
                    }
                    const placeholder = this.generatePlaceholder(operand, statementArguments);
                    return `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${resolvedSpread.output_identifier} = ${placeholder})`;
                });
                return conditions.join(' AND ');
            }
            case 'size':
                return arraySizeEquals(this.sqlColumnName, this.pathLiteral(resolved), this.generatePlaceholder(predicate.n, statementArguments));
            case 'not':
                if (predicate.inner.kind === 'size') {
                    const pathLit = this.pathLiteral(resolved);
                    const sizeSql = arraySizeEquals(this.sqlColumnName, pathLit, this.generatePlaceholder(predicate.inner.n, statementArguments));
                    return `(json_type(${this.sqlColumnName}, ${pathLit}) IS NULL OR NOT (${sizeSql}))`;
                }
                break;
            case 'exists': {
                if (spreadLeafPathLiteral !== undefined) {
                    // The field exists iff some array element carries the leaf. A whole-path json_type cannot descend
                    // through the array, so probe each spread element.
                    const cond = `json_type(${spreadElement}, ${spreadLeafPathLiteral}) IS NOT NULL`;
                    return predicate.expected
                        ? `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${cond})`
                        : `NOT EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${cond})`;
                }
                return predicate.expected
                    ? `json_type(${this.sqlColumnName}, ${this.pathLiteral(resolved)}) IS NOT NULL`
                    : `json_type(${this.sqlColumnName}, ${this.pathLiteral(resolved)}) IS NULL`;
            }
            case 'type': {
                if (spreadLeafPathLiteral !== undefined) {
                    return `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${this.typeTest(spreadElement, spreadLeafPathLiteral, predicate.typeName, statementArguments)})`;
                }
                const placeholder = this.generatePlaceholder(predicate.typeName, statementArguments);
                return `json_type(${this.sqlColumnName}, ${this.pathLiteral(resolved)}) = ${placeholder}`;
            }
            case 'elemMatch': {
                let subClause: string;
                if (isSubDocumentBody(predicate.body)) {
                    const subTranslator = new PropertyTranslatorSqliteJsonSchema(leafNode.schema!, resolvedSpread.output_column, true);
                    subClause = compileWhereFilterRecursive(predicate.body.objectFilter, statementArguments, subTranslator, errors, rootFilter);
                } else if (predicate.body.scalarPredicate.kind === 'compoundObject') {
                    subClause = '1 = 0';
                } else {
                    const customSpread = multiScalarElement ? { valueExpr: resolvedSpread.output_column, typeExpr: resolvedSpread.output_type } : undefined;
                    subClause = this.emitPredicate(dotpropPath, resolved, predicate.body.scalarPredicate, statementArguments, errors, rootFilter, { customSqlIdentifier: resolvedSpread.output_column, customSpread });
                }
                return `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${subClause})`;
            }
            case 'scalar':
            case 'undefinedField': {
                const customSpread = multiScalarElement ? { valueExpr: resolvedSpread.output_column, typeExpr: resolvedSpread.output_type } : undefined;
                const subClause = this.emitPredicate(dotpropPath, resolved, predicate, statementArguments, errors, rootFilter, { customSqlIdentifier: resolvedSpread.output_identifier, customSpread });
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
        const subTranslator = new PropertyTranslatorSqliteJsonSchema(leafNode.schema!, resolvedSpread.output_column, true);
        const result = compileWhereFilterRecursive(condition, statementArguments, subTranslator, errors, rootFilter);
        return `EXISTS (SELECT 1 FROM ${resolvedSpread.sql} WHERE ${result})`;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Leaf comparisons — the field itself, or one already-spread element
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Emit a leaf-level SQL comparison of one value.
     * $eq → =, range → >/</>=/<= , $regex → LIKE (best-effort), scalar → =, object/array → deep equality,
     * undefined → IS NULL. Optional/nullable paths are wrapped with a guard that keeps the verdict definite.
     */
    private emitLeafComparison(dotpropPath: string, resolved: ResolvedPath, predicate: Predicate, statementArguments: PreparedStatementArgument[], errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>, context: EmitContext): string {
        const { customSqlIdentifier } = context;

        switch (predicate.kind) {
            case 'ne': {
                // MongoDB: NaN equals nothing, so $ne: NaN matches every value (and Mongo's "ne matches missing" rule also applies). See MONGO-DIVERGENCES.md §7.
                if (typeof predicate.operand === 'number' && Number.isNaN(predicate.operand)) return '1=1';
                const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
                const placeholder = this.generatePlaceholder(predicate.operand, statementArguments);
                return this.optionalWrapperNullMatches(resolved, sqlIdentifier, `${sqlIdentifier} != ${placeholder}`);
            }
            case 'in': {
                const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
                const placeholders = predicate.operand.map(v => this.generatePlaceholder(v, statementArguments));
                return this.optionalWrapper(resolved, sqlIdentifier, `${sqlIdentifier} IN (${placeholders.join(', ')})`);
            }
            case 'nin': {
                const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
                const placeholders = predicate.operand.map(v => this.generatePlaceholder(v, statementArguments));
                return this.optionalWrapperNullMatches(resolved, sqlIdentifier, `${sqlIdentifier} NOT IN (${placeholders.join(', ')})`);
            }
            case 'not':
                return this.emitNot(dotpropPath, resolved, predicate.inner, statementArguments, errors, rootFilter, context);

            // $exists / $type / $size probe the stored JSON by path: json_type keeps a present JSON null (a value)
            // distinct from a missing path, which the extracted identifier cannot.
            case 'exists':
                return predicate.expected
                    ? `json_type(${this.sqlColumnName}, ${this.pathLiteral(resolved)}) IS NOT NULL`
                    : `json_type(${this.sqlColumnName}, ${this.pathLiteral(resolved)}) IS NULL`;
            case 'type':
                return this.typeTest(this.sqlColumnName, this.pathLiteral(resolved), predicate.typeName, statementArguments);
            case 'size':
                return arraySizeEquals(this.sqlColumnName, this.pathLiteral(resolved), this.generatePlaceholder(predicate.n, statementArguments));

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
                    const placeholder = this.generatePlaceholder(bound.operand, statementArguments);
                    return ValueComparisonRangeOperatorsSqlFunctions[bound.operator](sqlIdentifier, placeholder);
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
                return this.optionalWrapper(resolved, sqlIdentifier, this.deepEquals(sqlIdentifier, predicate.value, statementArguments));
            }
            // An operator payload the field's own shape cannot answer (an array operator on a scalar field) compares
            // as data, exactly as the value-driven matcher does — and nothing equals an operator payload.
            case 'compoundObject':
            case 'elemMatch':
            case 'all': {
                const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['object']);
                const value = predicate.kind === 'compoundObject' ? predicate.filter : reconstructFieldCondition(predicate);
                return this.optionalWrapper(resolved, sqlIdentifier, this.deepEquals(sqlIdentifier, value, statementArguments));
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
     * The guard is a PRESENCE probe rather than the extracted value. `json_extract` returns SQL NULL for both an
     * absent path and a stored JSON null, and under negation that conflation flips the verdict; `json_type` is NULL
     * only when the path is truly absent. Which way the guard reads — short-circuit on absence, or require presence
     * — is decided by what the whole negation says about a missing field.
     */
    private emitNot(dotpropPath: string, resolved: ResolvedPath, inner: Predicate, statementArguments: PreparedStatementArgument[], errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>, context: EmitContext): string {
        const innerSql = this.emitPredicate(dotpropPath, resolved, inner, statementArguments, errors, rootFilter, context);
        if (context.customSqlIdentifier !== undefined) {
            // An array element is always present, so presence is not a question its negation can ask.
            return this.optionalWrapperNullMatches(resolved, context.customSqlIdentifier, `NOT (${innerSql})`);
        }
        if (!resolved.known) return `NOT (${innerSql})`;

        const presence = `json_type(${this.sqlColumnName}, ${this.pathLiteral(resolved)})`;
        return matchesMissingField({ kind: 'not', inner })
            ? `(${presence} IS NULL OR NOT (${innerSql}))`
            : `(${presence} IS NOT NULL AND NOT (${innerSql}))`;
    }

    /**
     * $regex — SQLite has no native regex, so a pattern is answered only where `LIKE` can express it.
     *
     * A broken pattern is a REJECTION (the value-driven matcher throws on it too), surfaced as 'not well-defined'
     * so the seam rethrows; a valid pattern LIKE cannot express is a capability gap, surfaced as a skip.
     */
    private emitRegex(dotpropPath: string, resolved: ResolvedPath, predicate: Predicate & { kind: 'regex' }, statementArguments: PreparedStatementArgument[], rootFilter: WhereFilterDefinition<T>, customSqlIdentifier: string | undefined): string {
        const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['string']);

        const translation = translateRegexToLike(predicate.pattern, predicate.options);
        if (!translation.success) {
            const reasonCode = translation.reason === 'not_well_defined' ? 'regex_invalid'
                : translation.reason === 'options_unsupported' ? 'regex_options' : 'regex_too_complex';
            this.pushRegexError(dotpropPath, reconstructFieldCondition(predicate), rootFilter, reasonCode, translation.message);
            return 'FALSE';
        }

        const placeholder = this.generatePlaceholder(translation.operand, statementArguments);
        const comparison = translation.comparison === 'equals'
            ? `${sqlIdentifier} = ${placeholder}`
            : `${sqlIdentifier} LIKE ${placeholder} ESCAPE '\\'`;
        return this.optionalWrapper(resolved, sqlIdentifier, comparison);
    }
}


/**
 * SQLite PropertyTranslator that derives its TreeNodeMap from a Zod schema automatically.
 *
 * @example
 * const pm = new PropertyTranslatorSqliteJsonSchema(ContactSchema, 'recordColumn');
 */
export class PropertyTranslatorSqliteJsonSchema<T extends Record<string, any> = Record<string, any>> extends BasePropertyTranslatorSqliteJson<T> implements IPropertyTranslator<T> {
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
        this.multiScalarPaths = new Set(findMultiScalarUnionPaths(schema).map((m) => m.dotprop_path));
    }
}

/**
 * SQLite PropertyTranslator that accepts a pre-built TreeNodeMap directly.
 */
export class PropertyTranslatorSqliteJson<T extends Record<string, any> = Record<string, any>> extends BasePropertyTranslatorSqliteJson<T> implements IPropertyTranslator<T> {
    constructor(nodeMap: TreeNodeMap, sqlColumnName: string, doNotSpreadArray?: boolean) {
        super(nodeMap, sqlColumnName, doNotSpreadArray);
    }
}
