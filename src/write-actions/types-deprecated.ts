/**
 * Deprecated type aliases mapping old names to new types.
 * All re-exported from index.ts for backward compatibility.
 */
import type { WriteActionError, WriteActionOutcomeOk, WriteActionOutcomeFailed, WriteActionAffectedItem, WriteResult } from './types.ts';
import type { ApplyWritesToItemsResult } from './applyWritesToItems/types.ts';

/** @deprecated Use `WriteActionError` instead. */
export type WriteCommonError = WriteActionError;

/** @deprecated Use `WriteActionOutcomeOk<T>` instead. */
export type SuccessfulWriteAction<T extends Record<string, any> = Record<string, any>> = WriteActionOutcomeOk<T>;

/** @deprecated Use `WriteActionOutcomeFailed<T>` instead. */
export type FailedWriteAction<T extends Record<string, any> = Record<string, any>> = WriteActionOutcomeFailed<T>;

/** @deprecated Use `WriteActionAffectedItem<T>` instead. */
export type FailedWriteActionAffectedItem<T extends Record<string, any> = Record<string, any>> = WriteActionAffectedItem<T>;

/** @deprecated Use `WriteResult<T>` instead. */
export type WriteActionsResponse<T extends Record<string, any> = Record<string, any>> = WriteResult<T>;

/** @deprecated Eliminated. Check `result.ok === true` on `WriteResult<T>`. */
export type WriteActionsResponseOk = { status: 'ok' };

/** @deprecated Eliminated. Check `result.ok === false` on `WriteResult<T>`. */
export type WriteActionsResponseError<T extends Record<string, any> = Record<string, any>> = WriteResult<T> & { ok: false };

/** @deprecated Use `ApplyWritesToItemsResult<T>` instead. */
export type ApplyWritesToItemsResponse<T extends Record<string, any> = Record<string, any>> = ApplyWritesToItemsResult<T>;
