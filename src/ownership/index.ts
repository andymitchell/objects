// ─── Functions ───
export { checkOwnership } from "./checkOwnership.ts";
export { isIUser } from "./auth.ts";

// ─── SQL ───
export { prepareOwnershipWhereClause } from "./sql/index.ts";

// ─── Types ───
export type { IUser } from "./auth.ts";
export type { OwnershipRule, OwnershipProperty, OwnerIdFormat, CoreOwnershipDeniedReason, OwnershipCheckResult } from "./types.ts";
export type { SqlDialect, OwnershipTableInfo, OwnershipWhereClauseResult } from "./sql/types.ts";

// ─── Schemas ───
export { OwnershipRuleSchema, OwnershipPropertySchema, OwnerIdFormatSchema } from "./schemas.ts";

// ─── Testing ───
export { standardOwnershipTests } from "./standardTests.ts";
export type { OwnershipTestAdapter } from "./standardTests.ts";
export { mockUser } from "./testing-helpers/mockUser.ts";
