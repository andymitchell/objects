import type { WriteAction, WriteActionError, WriteResult } from './types.ts';
import { getFailedActions, getSuccessfulActions } from './types.ts';
import type { PrimaryKeyValue } from '../utils/getKeyValue.ts';

/**
 * Legacy response shape for backward compatibility with `@andyrmitchell/store` and other consumers.
 */
type LegacyWriteActionsResponse<T extends Record<string, any>> =
    | { status: 'ok' }
    | {
        status: 'error';
        message: string;
        successful_actions: { action: WriteAction<T>; affected_items?: { item_pk: PrimaryKeyValue }[] }[];
        failed_actions: {
            action: WriteAction<T>;
            error_details: WriteActionError[];
            unrecoverable?: boolean;
            back_off_until_ts?: number;
            blocked_by_action_uuid?: string;
            affected_items?: { item_pk: PrimaryKeyValue; item: T; error_details: WriteActionError[] }[];
        }[];
    };

/**
 * Converts a new `WriteResult<T>` to the old `WriteActionsResponse<T>` shape.
 * Use during migration to maintain backward compatibility with external consumers.
 *
 * @example
 * const legacyResult = convertWriteResultToLegacy(result);
 * if (legacyResult.status === 'error') legacyResult.failed_actions[0].error_details;
 */
export function convertWriteResultToLegacy<T extends Record<string, any>>(
    result: WriteResult<T>
): LegacyWriteActionsResponse<T> {
    if (result.ok) {
        return { status: 'ok' };
    }
    return {
        status: 'error',
        message: result.error?.message ?? 'Some write actions failed.',
        successful_actions: getSuccessfulActions(result).map(a => ({
            action: a.action,
            affected_items: a.affected_items?.map(ai => ({ item_pk: ai.item_pk })),
        })),
        failed_actions: getFailedActions(result).map(a => ({
            action: a.action,
            error_details: a.errors.map(e => {
                const { item_pk: _ipk, item: _item, ...error } = e;
                return error as WriteActionError;
            }),
            unrecoverable: a.unrecoverable,
            back_off_until_ts: a.back_off_until_ts,
            blocked_by_action_uuid: a.blocked_by_action_uuid,
            affected_items: a.affected_items
                ?.filter(ai => a.errors.some(e => e.item_pk === ai.item_pk))
                .map(ai => ({
                    item_pk: ai.item_pk,
                    item: ai.item as T,
                    error_details: a.errors
                        .filter(e => e.item_pk === ai.item_pk)
                        .map(e => {
                            const { item_pk: _ipk, item: _item, ...error } = e;
                            return error as WriteActionError;
                        }),
                })),
        })),
    };
}
