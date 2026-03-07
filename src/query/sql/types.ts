import type { PreparedStatementArgument } from '../../utils/sql/types.ts';

/** SQL dialect for query generation. */
export type SqlDialect = 'pg' | 'sqlite';

/** Internal SQL fragment shape — used within query/sql internals for composition. */
export type SqlFragment = { sql: string; parameters: PreparedStatementArgument[] };
