import type { z } from "zod";
import type { OwnershipRule } from "../types.ts";
import type { IUser } from "../auth.ts";
import { OwnershipRuleSchema } from "../schemas.ts";
import type { SqlDialect, OwnershipTableInfo, OwnershipWhereClauseResult } from "./types.ts";
import type { PreparedStatementArgument } from "../../utils/sql/types.ts";
import { convertDotPropPathToPostgresJsonPath } from "../../utils/sql/postgres/convertDotPropPathToPostgresJsonPath.ts";
import { convertDotPropPathToSqliteJsonPath } from "../../utils/sql/sqlite/convertDotPropPathToSqliteJsonPath.ts";
import { convertSchemaToDotPropPathTree } from "../../dot-prop-paths/zod.ts";
import type { TreeNode, TreeNodeMap } from "../../dot-prop-paths/zod.ts";
import { spreadJsonbArrays } from "../../where-filter/sql/postgres/spreadJsonbArrays.ts";
import { spreadJsonArraysSqlite } from "../../where-filter/sql/sqlite/spreadJsonArraysSqlite.ts";
import { quoteIdentifier } from "../../query/sql/internals/quoteIdentifier.ts";

type PrepareResult =
    | { ok: true, result: OwnershipWhereClauseResult }
    | { ok: false, error: string }

const NO_FILTER: OwnershipWhereClauseResult = { where_clause: null, from_clause: null, parameters: [] };

/**
 * Generates a parameterised SQL WHERE clause that filters rows to those owned by `user`.
 *
 * Why: Allows Postgres and SQLite stores to enforce ownership at the query layer,
 * reusing the same OwnershipRule shape that checkOwnership uses at the JS layer.
 *
 * @example
 * const r = prepareOwnershipWhereClause(rule, user, { mode: 'object_column', columnName: 'data', schema }, 'sqlite');
 * if (r.ok && r.result.where_clause) db.prepare(`SELECT * FROM items WHERE ${r.result.where_clause}`).all(...r.result.parameters);
 */
export function prepareOwnershipWhereClause<T extends Record<string, any>>(
    ownershipRule: OwnershipRule<T>,
    user: IUser,
    tableInfo: OwnershipTableInfo<T>,
    dialect: SqlDialect,
    startingArgIndex?: number,
): PrepareResult {
    // Runtime validation
    if (!ownershipRule || !OwnershipRuleSchema.safeParse(ownershipRule).success) {
        return { ok: false, error: 'Invalid ownership rule' };
    }

    if (ownershipRule.type === 'none') {
        return { ok: true, result: NO_FILTER };
    }

    if (ownershipRule.type !== 'basic') {
        return { ok: false, error: `Unknown ownership type: ${(ownershipRule as any).type}` };
    }

    // Resolve user claim
    const id = ownershipRule.format === 'uuid' ? user.getUuid() : user.getEmail();
    if (!id) {
        // No claim → filter returns nothing
        return { ok: true, result: { where_clause: '1 = 0', from_clause: null, parameters: [] } };
    }

    // Validate email format when required (mirrors checkOwnership behaviour)
    if (ownershipRule.format === 'email' && !/.+\@.+\..+/.test(id)) {
        return { ok: true, result: { where_clause: '1 = 0', from_clause: null, parameters: [] } };
    }

    const argIdx = startingArgIndex ?? 1;
    const parameters: PreparedStatementArgument[] = [];
    const clauses: string[] = [];
    let fromClause: string | null = null;

    // Build primary path clause
    const primary = buildPathClause(
        ownershipRule.path as string,
        ownershipRule.property_type,
        id,
        tableInfo,
        dialect,
        argIdx,
        parameters,
    );
    if (!primary.ok) return { ok: false, error: primary.error };
    clauses.push(primary.sql);
    if (primary.from_clause) fromClause = primary.from_clause;

    // Build transfer path clause (only for property_type: 'id')
    if (ownershipRule.property_type === 'id' && ownershipRule.transferring_to_path) {
        const transfer = buildPathClause(
            ownershipRule.transferring_to_path as string,
            'id',
            id,
            tableInfo,
            dialect,
            argIdx + parameters.length,
            parameters,
        );
        if (!transfer.ok) return { ok: false, error: transfer.error };
        clauses.push(transfer.sql);
        if (transfer.from_clause) {
            fromClause = fromClause
                ? `${fromClause} CROSS JOIN ${transfer.from_clause}`
                : transfer.from_clause;
        }
    }

    const where_clause = clauses.length === 1 ? clauses[0]! : `(${clauses.join(' OR ')})`;

    return { ok: true, result: { where_clause, from_clause: fromClause, parameters } };
}

// ─── Internal ────────────────────────────────────────────────────

type PathClauseResult =
    | { ok: true, sql: string, from_clause: string | null }
    | { ok: false, error: string }

/** Why: builds a single equality/containment clause for one ownership path. */
function buildPathClause<T extends Record<string, any>>(
    path: string,
    propertyType: 'id' | 'id_in_scalar_array',
    id: string,
    tableInfo: OwnershipTableInfo<T>,
    dialect: SqlDialect,
    argIdx: number,
    parameters: PreparedStatementArgument[],
): PathClauseResult {
    if (tableInfo.mode === 'column_table') {
        return buildColumnTableClause(path, propertyType, id, tableInfo.allowedColumns, dialect, argIdx, parameters);
    }
    return buildObjectColumnClause(path, propertyType, id, tableInfo.columnName, tableInfo.schema, dialect, argIdx, parameters);
}

/** Why: column_table mode — path is a direct column name. */
function buildColumnTableClause(
    path: string,
    propertyType: 'id' | 'id_in_scalar_array',
    id: string,
    allowedColumns: string[],
    dialect: SqlDialect,
    argIdx: number,
    parameters: PreparedStatementArgument[],
): PathClauseResult {
    // Dot paths not supported in column_table mode
    if (path.includes('.')) {
        return { ok: false, error: `Nested paths not supported in column_table mode: ${path}` };
    }
    if (!allowedColumns.includes(path)) {
        return { ok: false, error: `Column ${path} not in allowedColumns whitelist` };
    }

    const col = quoteIdentifier(path);
    const placeholder = makeParam(dialect, argIdx);
    parameters.push(id);

    if (propertyType === 'id') {
        return { ok: true, sql: `${col} = ${placeholder}`, from_clause: null };
    }

    // id_in_scalar_array for column_table — column holds a JSON array
    if (dialect === 'pg') {
        return { ok: true, sql: `EXISTS(SELECT 1 FROM jsonb_array_elements_text(${col}::jsonb) AS elem WHERE elem = ${placeholder})`, from_clause: null };
    }
    // Guard with json_type to avoid errors on malformed (non-array) data
    return { ok: true, sql: `(json_type(${col}) = 'array' AND EXISTS(SELECT 1 FROM json_each(${col}) WHERE value = ${placeholder}))`, from_clause: null };
}

/** Why: object_column mode — path resolved inside a JSON/JSONB column. */
function buildObjectColumnClause<T extends Record<string, any>>(
    path: string,
    propertyType: 'id' | 'id_in_scalar_array',
    id: string,
    columnName: string,
    schema: z.ZodSchema<T>,
    dialect: SqlDialect,
    argIdx: number,
    parameters: PreparedStatementArgument[],
): PathClauseResult {
    const { map } = convertSchemaToDotPropPathTree(schema);
    const node = map[path];

    if (!node) {
        return { ok: false, error: `Unknown path in schema: ${path}` };
    }

    const placeholder = makeParam(dialect, argIdx);
    parameters.push(id);

    // Check if path traverses arrays (needs spreading)
    if (node.descended_from_array) {
        return buildSpreadClause(path, propertyType, map, columnName, dialect, placeholder);
    }

    // Non-array path — use path converter directly
    if (propertyType === 'id') {
        const expr = resolveJsonExpression(columnName, path, dialect, map);
        if (!expr.ok) return { ok: false, error: expr.error };
        return { ok: true, sql: `${expr.expression} = ${placeholder}`, from_clause: null };
    }

    // id_in_scalar_array — the target is a JSON array column
    if (propertyType === 'id_in_scalar_array') {
        if (dialect === 'pg') {
            const expr = resolveJsonExpression(columnName, path, dialect, map, true);
            if (!expr.ok) return { ok: false, error: expr.error };
            return { ok: true, sql: `EXISTS(SELECT 1 FROM jsonb_array_elements_text(${expr.expression}) AS elem WHERE elem = ${placeholder})`, from_clause: null };
        }
        // SQLite — guard with json_type to avoid errors on malformed (non-array) data
        // Use json_type(column, path) form which handles non-JSON values safely
        const jsonPath = '$.' + path;
        return { ok: true, sql: `(json_type(${columnName}, '${jsonPath}') = 'array' AND EXISTS(SELECT 1 FROM json_each(${columnName}, '${jsonPath}') WHERE value = ${placeholder}))`, from_clause: null };
    }

    return { ok: false, error: `Unknown property_type: ${propertyType}` };
}

/** Why: handles paths that traverse through object arrays (e.g. owners.email). */
function buildSpreadClause(
    path: string,
    propertyType: 'id' | 'id_in_scalar_array',
    nodeMap: TreeNodeMap,
    columnName: string,
    dialect: SqlDialect,
    placeholder: string,
): PathClauseResult {
    // Build ancestry from target to root
    const ancestry: TreeNode[] = [];
    let current: TreeNode | undefined = nodeMap[path];
    while (current) {
        ancestry.unshift(current);
        current = current.parent;
    }

    if (dialect === 'pg') {
        const spread = spreadJsonbArrays(columnName, ancestry);
        if (!spread) return { ok: false, error: `Could not spread array path: ${path}` };

        // After spreading, get the remaining path from the last spread output
        const leafExpr = buildLeafExpression(path, nodeMap, spread.output_column, dialect, propertyType);

        if (propertyType === 'id_in_scalar_array') {
            return { ok: true, sql: `EXISTS(SELECT 1 FROM ${spread.sql} CROSS JOIN jsonb_array_elements_text(${leafExpr}) AS elem WHERE elem = ${placeholder})`, from_clause: null };
        }

        return { ok: true, sql: `EXISTS(SELECT 1 FROM ${spread.sql} WHERE ${leafExpr} = ${placeholder})`, from_clause: null };
    }

    // SQLite
    const spread = spreadJsonArraysSqlite(columnName, ancestry);
    if (!spread) return { ok: false, error: `Could not spread array path: ${path}` };

    const leafExpr = buildLeafExpression(path, nodeMap, spread.output_column, dialect, propertyType);

    if (propertyType === 'id_in_scalar_array') {
        return { ok: true, sql: `EXISTS(SELECT 1 FROM ${spread.sql} CROSS JOIN json_each(${leafExpr}) WHERE value = ${placeholder})`, from_clause: null };
    }

    return { ok: true, sql: `EXISTS(SELECT 1 FROM ${spread.sql} WHERE ${leafExpr} = ${placeholder})`, from_clause: null };
}

/**
 * Why: after spreading through arrays, we need to access the leaf property
 * from the spread output column. Builds the remaining path expression.
 */
function buildLeafExpression(
    fullPath: string,
    nodeMap: TreeNodeMap,
    spreadOutputColumn: string,
    dialect: SqlDialect,
    propertyType: 'id' | 'id_in_scalar_array',
): string {
    // Find the last array ancestor to determine what path remains after spreading
    const node = nodeMap[fullPath];
    if (!node) return spreadOutputColumn;

    // Walk up to find the last array ancestor
    const pathParts = fullPath.split('.');
    let lastArrayIdx = -1;
    let checkPath = '';
    for (let i = 0; i < pathParts.length; i++) {
        checkPath = checkPath ? `${checkPath}.${pathParts[i]}` : pathParts[i]!;
        const checkNode = nodeMap[checkPath];
        if (checkNode?.kind === 'ZodArray') {
            lastArrayIdx = i;
        }
    }

    if (lastArrayIdx === -1) {
        // No array found — shouldn't happen if descended_from_array is true
        return spreadOutputColumn;
    }

    // Remaining path after the last array
    const remainingParts = pathParts.slice(lastArrayIdx + 1);
    if (remainingParts.length === 0) {
        // The leaf IS the array element itself
        if (dialect === 'pg') {
            return `${spreadOutputColumn} #>> '{}'`;
        }
        return spreadOutputColumn;
    }

    // Build expression for remaining path from spread output
    if (dialect === 'pg') {
        const noCast = propertyType === 'id_in_scalar_array';
        if (remainingParts.length === 1) {
            if (noCast) {
                return `${spreadOutputColumn}->'${remainingParts[0]}'`;
            }
            return `(${spreadOutputColumn}->>'${remainingParts[0]}')::text`;
        }
        const intermediate = remainingParts.slice(0, -1).map(p => `'${p}'`).join('->');
        const last = remainingParts[remainingParts.length - 1];
        if (noCast) {
            return `${spreadOutputColumn}->${intermediate}->'${last}'`;
        }
        return `(${spreadOutputColumn}->${intermediate}->>'${last}')::text`;
    }

    // SQLite: json_extract from the spread value
    const jsonPath = '$.' + remainingParts.join('.');
    return `json_extract(${spreadOutputColumn}, '${jsonPath}')`;
}

/** Why: converts a dot-prop path to a SQL expression using dialect-specific converters. */
function resolveJsonExpression(
    columnName: string,
    path: string,
    dialect: SqlDialect,
    nodeMap: TreeNodeMap,
    noCasting?: boolean,
): { ok: true, expression: string } | { ok: false, error: string } {
    if (dialect === 'pg') {
        const result = convertDotPropPathToPostgresJsonPath(columnName, path, nodeMap, undefined, noCasting);
        if (!result.success) return { ok: false, error: result.error.message };
        return { ok: true, expression: result.expression };
    }
    const result = convertDotPropPathToSqliteJsonPath(columnName, path, nodeMap);
    if (!result.success) return { ok: false, error: result.error.message };
    return { ok: true, expression: result.expression };
}

/** Why: Postgres uses $N placeholders, SQLite uses ?. */
function makeParam(dialect: SqlDialect, index: number): string {
    return dialect === 'pg' ? `$${index}` : '?';
}
