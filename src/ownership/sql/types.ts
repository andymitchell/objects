import type { z } from "zod";
import type { PreparedStatementArgument } from "../../utils/sql/types.ts";

export type SqlDialect = 'pg' | 'sqlite';

export type OwnershipTableInfo<T extends Record<string, any> = Record<string, any>> =
    | { mode: 'object_column', columnName: string, schema: z.ZodSchema<T> }
    | { mode: 'column_table', allowedColumns: string[] }

export type OwnershipWhereClauseResult = {
    /** SQL WHERE condition, or null when type:'none'. */
    where_clause: string | null,
    /** Additional FROM clause (CROSS JOIN for spread paths), or null. */
    from_clause: string | null,
    /** Parameterised argument values. */
    parameters: PreparedStatementArgument[],
}
