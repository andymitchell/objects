import type { WritePayloadArrayScope, WritePayloadArrayScopeParts, WritePayloadUpdate, WritePayloadDelete, WritePayloadAddToSet, WritePayloadPush, WritePayloadPull, WritePayloadInc, WritePayloadSetPropertyUndefined, WritePayloadDeleteProperty, WriteOutcomeFailed, WriteOutcomeOk, WriteResult, WriteErrorContext } from './types.ts';
import type { DotPropPathToObjectArraySpreadingArrays } from '../dot-prop-paths/types.ts';

export function assertWriteArrayScope<T extends Record<string, any>, P extends DotPropPathToObjectArraySpreadingArrays<T> = DotPropPathToObjectArraySpreadingArrays<T>, W extends Record<string, any> = T, WF extends Record<string, any> = T>(action: WritePayloadArrayScope<T, P, W, WF>):WritePayloadArrayScope<T, P, W, WF> {
    return action;
}

/**
 * Exposes usable `scope` and `action` types when reading a generically typed array-scope payload.
 *
 * A `WritePayloadArrayScope<T>` struggles when `T` is a generic type parameter: `.scope` reads as a
 * junk string instead of a path, and `.action` is just as unusable.
 *
 * (Technically: the payload is a distributive conditional type, which the checker cannot resolve
 * member-by-member until `T` is known.)
 *
 * Passing the payload through this function fixes the type, so both members read as they would on a
 * concrete row.
 *
 * It returns the exact same object — only the type changes.
 *
 * @example
 * function summarise<T extends Record<string, any>>(p: WritePayloadArrayScope<T>) {
 *     const scope: DotPropPathToObjectArraySpreadingArrays<T> = readGenericArrayScope(p).scope;  // a real path
 *
 *     return scope;  // p.scope alone would be the junk string here
 * }
 *
 * @param payload The array-scope payload to read.
 *
 * @returns The same payload, typed as {@link WritePayloadArrayScopeParts} so each member reads properly.
 *
 * @remarks
 * Use the returned `action` directly — pass it to a generic function and let TypeScript infer its row
 * type. Writing its type out by hand runs back into the same generic-typing struggle this function
 * exists to avoid.
 */
export function readGenericArrayScope<
    T extends Record<string, any>,
    P extends DotPropPathToObjectArraySpreadingArrays<T> = DotPropPathToObjectArraySpreadingArrays<T>,
    W extends Record<string, any> = T,
    WF extends Record<string, any> = T
>(payload: WritePayloadArrayScope<T, P, W, WF>): WritePayloadArrayScopeParts<T, P, WF> {
    // Sound: WritePayloadArrayScope<T, P> is exactly this shape once P settles; the lazy declaration
    // only hides that from the checker while P is generic. The concrete round-trip type tests pin that
    // the retype adds nothing a resolved P wouldn't have.
    return payload as WritePayloadArrayScopeParts<T, P, WF>;
}

export function isWriteActionArrayScopePayload<T extends Record<string, any> = Record<string, any>>(x: unknown):x is WritePayloadArrayScope<T> {
    return typeof x==='object' && !!x && "type" in x && x.type==='array_scope';
}

/**
 * Narrows a payload to the variants that act on EXISTING items — everything except `create`.
 *
 * Those variants all carry a `where`, so they are the ones a writer matches against the items it already holds;
 * `create` is the odd one out, defining a new item with nothing to match. Narrowing here is what lets a caller
 * read `payload.where` without re-testing each discriminant.
 *
 * @param x - Any value; typically a `WritePayload` whose variant is not yet known.
 * @returns `true` when `x` carries one of the existing-item discriminants, narrowing it to that union.
 *
 * @example
 * if (isUpdateOrDeleteWritePayload<Row>(payload) && matchJavascriptObject(item, payload.where)) apply(item);
 */
export function isUpdateOrDeleteWritePayload<T extends Record<string, any>>(x: unknown): x is WritePayloadUpdate<T> | WritePayloadDelete<T> | WritePayloadArrayScope<T> | WritePayloadAddToSet<T> | WritePayloadPush<T> | WritePayloadPull<T> | WritePayloadInc<T> | WritePayloadSetPropertyUndefined<T> | WritePayloadDeleteProperty<T> {
    return typeof x==='object' && !!x && 'type' in x && (x.type==='update' || x.type==='array_scope' || x.type==='delete' || x.type==='add_to_set' || x.type==='push' || x.type==='pull' || x.type==='inc' || x.type==='set_property_undefined' || x.type==='delete_property');
}

/**
 * Filter for failed action outcomes from a `WriteResult`.
 *
 * @example
 * const failures = getWriteFailures(result);
 * if (failures.length) failures[0].errors[0].type;
 */
export function getWriteFailures<T extends Record<string, any>, W extends Record<string, any> = T, WF extends Record<string, any> = T>(result: WriteResult<T, W, WF>): WriteOutcomeFailed<T, W, WF>[] {
    return result.actions.filter((a): a is WriteOutcomeFailed<T, W, WF> => !a.ok);
}

/**
 * Filter for successful action outcomes from a `WriteResult`.
 *
 * @example
 * const successes = getWriteSuccesses(result);
 * successes.forEach(s => console.log(s.action_uuid));
 */
export function getWriteSuccesses<T extends Record<string, any>, W extends Record<string, any> = T, WF extends Record<string, any> = T>(result: WriteResult<T, W, WF>): WriteOutcomeOk<T, W, WF>[] {
    return result.actions.filter((a): a is WriteOutcomeOk<T, W, WF> => a.ok);
}

/**
 * Flatten all errors across all failed actions.
 *
 * @example
 * const allErrors = getWriteErrors(result);
 * allErrors.forEach(e => console.log(e.type, e.item_pk));
 */
export function getWriteErrors<T extends Record<string, any>, W extends Record<string, any> = T, WF extends Record<string, any> = T>(result: WriteResult<T, W, WF>): WriteErrorContext[] {
    return getWriteFailures(result).flatMap(a => a.errors);
}
