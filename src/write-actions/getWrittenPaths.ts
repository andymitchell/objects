import { escapeDotPropPathSegment } from '../dot-prop-paths/dotPropPathSegments.ts';
import type { WriteAction, WritePayload } from './types.ts';

/**
 * Lists every dot-prop path a `WriteAction` will mutate.
 *
 * Why: surfaces an action's field-level footprint without executing it, so
 * callers can reason about its effects up-front.
 *
 * Paths are spelled in the escaped dot-prop grammar: a key holding a literal dot renders as
 * `rank\.value`, so splitting a returned path with `parseDotPropPathSegments` recovers the keys
 * that were actually written.
 *
 * `delete` returns `[]` — delete operates on whole items, not on fields.
 *
 * @example
 * getWrittenPaths({ type: 'write', ts: 0, uuid: 'u',
 *   payload: { type: 'update', data: { title: 'x' }, where: {} } })
 * // => ['title']
 *
 * @example
 * getWrittenPaths({ type: 'write', ts: 0, uuid: 'u',
 *   payload: { type: 'array_scope', scope: 'subtasks', where: {},
 *     action: { type: 'update', data: { done: true }, where: {} } } })
 * // => ['subtasks.done']
 */
export function getWrittenPaths<T extends Record<string, any>>(
    action: WriteAction<T>
): string[] {
    return extractFromPayload(action.payload);
}

function extractFromPayload<T extends Record<string, any>>(
    payload: WritePayload<T>,
    prefix?: string
): string[] {
    const join = (s: string) => (prefix ? `${prefix}.${s}` : s);
    // `data` keys and `path` are raw object KEYS; a returned dot-prop PATH must escape any literal
    // dot they hold (`\.`), or a canonical split reads one key as two.
    const joinKey = (key: string) => join(escapeDotPropPathSegment(key));

    switch (payload.type) {
        case 'create':
        case 'update':
            return Object.keys(payload.data).map(joinKey);
        case 'push':
        case 'pull':
        case 'add_to_set':
        case 'inc':
            // path is `ArrayProperty<W>` / `NumberProperty<W>` — keyof-derived, so a numeric-keyed W
            // delivers a NUMBER at runtime. String() covers that; a fractional key like 3.5
            // stringifies with a dot, which the escape then renders as the single key `3\.5`.
            return [joinKey(String(payload.path))];
        case 'array_scope':
            // scope: same keyof-derived widening as path above.
            return extractFromPayload(payload.action, join(payload.scope as string));
        case 'delete':
            return [];
        default: {
            // Every WritePayload variant is handled above; the never-assertion makes a future
            // unhandled variant a compile error here rather than a silent `undefined` return.
            const _exhaustive: never = payload;
            throw new Error(`getWrittenPaths: unhandled WritePayload variant ${JSON.stringify(_exhaustive)}`);
        }
    }
}
