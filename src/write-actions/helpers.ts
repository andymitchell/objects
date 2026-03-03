import type { WriteActionPayloadArrayScope, WriteActionPayloadUpdate, WriteActionPayloadDelete, WriteActionOutcomeFailed, WriteActionOutcomeOk, WriteResult, WriteActionErrorContext } from './types.ts';
import type { DotPropPathToObjectArraySpreadingArrays } from '../dot-prop-paths/types.ts';

export const VALUE_TO_DELETE_KEY:undefined = undefined; // #VALUE_TO_DELETE_KEY If this is changed to null, change WriteActionPayloadUpdate to.... data: Nullable<Partial<T>>

export function assertArrayScope<T extends Record<string, any>, P extends DotPropPathToObjectArraySpreadingArrays<T>>(action: WriteActionPayloadArrayScope<T, P>):WriteActionPayloadArrayScope<T,P> {
    return action;
}

export function isWriteActionArrayScopePayload<T extends Record<string, any> = Record<string, any>>(x: unknown):x is WriteActionPayloadArrayScope<T> {
    return typeof x==='object' && !!x && "type" in x && x.type==='array_scope';
}

export function isUpdateOrDeleteWriteActionPayload<T extends Record<string, any>>(x: unknown): x is WriteActionPayloadUpdate<T> | WriteActionPayloadDelete<T> | WriteActionPayloadArrayScope<T>{
    return typeof x==='object' && !!x && 'type' in x && (x.type==='update' || x.type==='array_scope' || x.type==='delete');
}

/**
 * Filter for failed action outcomes from a `WriteResult`.
 *
 * @example
 * const failures = getFailedActions(result);
 * if (failures.length) failures[0].errors[0].type;
 */
export function getFailedActions<T extends Record<string, any>>(result: WriteResult<T>): WriteActionOutcomeFailed<T>[] {
    return result.actions.filter((a): a is WriteActionOutcomeFailed<T> => !a.ok);
}

/**
 * Filter for successful action outcomes from a `WriteResult`.
 *
 * @example
 * const successes = getSuccessfulActions(result);
 * successes.forEach(s => console.log(s.action.uuid));
 */
export function getSuccessfulActions<T extends Record<string, any>>(result: WriteResult<T>): WriteActionOutcomeOk<T>[] {
    return result.actions.filter((a): a is WriteActionOutcomeOk<T> => a.ok);
}

/**
 * Flatten all errors across all failed actions.
 *
 * @example
 * const allErrors = getAllErrors(result);
 * allErrors.forEach(e => console.log(e.type, e.item_pk));
 */
export function getAllErrors<T extends Record<string, any>>(result: WriteResult<T>): WriteActionErrorContext<T>[] {
    return getFailedActions(result).flatMap(a => a.errors);
}
