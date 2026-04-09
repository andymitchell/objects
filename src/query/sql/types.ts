import type { PreparedStatementArgument } from '../../utils/sql/types.ts';

export type { SqlDialect } from '../../utils/sql/types.ts';

/** Internal SQL fragment shape — used within query/sql internals for composition. */
export type SqlFragment = { sql: string; parameters: PreparedStatementArgument[] };
