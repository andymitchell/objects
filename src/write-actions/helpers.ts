import type { WritePayloadArrayScope, WritePayloadUpdate, WritePayloadDelete, WriteOutcomeFailed, WriteOutcomeOk, WriteResult, WriteErrorContext } from './types.ts';
import type { DotPropPathToObjectArraySpreadingArrays } from '../dot-prop-paths/types.ts';

export const VALUE_TO_DELETE_KEY:undefined = undefined; // #VALUE_TO_DELETE_KEY If this is changed to null, change WritePayloadUpdate to.... data: Nullable<Partial<T>>

export function assertWriteArrayScope<T extends Record<string, any>, P extends DotPropPathToObjectArraySpreadingArrays<T>>(action: WritePayloadArrayScope<T, P>):WritePayloadArrayScope<T,P> {
    return action;
}

export function isWriteActionArrayScopePayload<T extends Record<string, any> = Record<string, any>>(x: unknown):x is WritePayloadArrayScope<T> {
    return typeof x==='object' && !!x && "type" in x && x.type==='array_scope';
}

export function isUpdateOrDeleteWritePayload<T extends Record<string, any>>(x: unknown): x is WritePayloadUpdate<T> | WritePayloadDelete<T> | WritePayloadArrayScope<T>{
    return typeof x==='object' && !!x && 'type' in x && (x.type==='update' || x.type==='array_scope' || x.type==='delete');
}

/**
 * Filter for failed action outcomes from a `WriteResult`.
 *
 * @example
 * const failures = getWriteFailures(result);
 * if (failures.length) failures[0].errors[0].type;
 */
export function getWriteFailures<T extends Record<string, any>>(result: WriteResult<T>): WriteOutcomeFailed<T>[] {
    return result.actions.filter((a): a is WriteOutcomeFailed<T> => !a.ok);
}

/**
 * Filter for successful action outcomes from a `WriteResult`.
 *
 * @example
 * const successes = getWriteSuccesses(result);
 * successes.forEach(s => console.log(s.action.uuid));
 */
export function getWriteSuccesses<T extends Record<string, any>>(result: WriteResult<T>): WriteOutcomeOk<T>[] {
    return result.actions.filter((a): a is WriteOutcomeOk<T> => a.ok);
}

/**
 * Flatten all errors across all failed actions.
 *
 * @example
 * const allErrors = getWriteErrors(result);
 * allErrors.forEach(e => console.log(e.type, e.item_pk));
 */
export function getWriteErrors<T extends Record<string, any>>(result: WriteResult<T>): WriteErrorContext<T>[] {
    return getWriteFailures(result).flatMap(a => a.errors);
}
