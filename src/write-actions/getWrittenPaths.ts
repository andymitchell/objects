import type { WriteAction, WritePayload } from './types.ts';

/**
 * Lists every dot-prop path a `WriteAction` will mutate.
 *
 * Why: surfaces an action's field-level footprint without executing it, so
 * callers can reason about its effects up-front.
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

    switch (payload.type) {
        case 'create':
        case 'update':
            return Object.keys(payload.data).map(join);
        case 'push':
        case 'pull':
        case 'add_to_set':
        case 'inc':
            // path is `ArrayProperty<W>` / `NumberProperty<W>` — keyof-derived,
            // so the type widens to `string | number | symbol` under generic T.
            // At runtime these are always object keys, i.e. strings.
            return [join(payload.path as string)];
        case 'array_scope':
            // scope: same keyof-derived widening as path above.
            return extractFromPayload(payload.action, join(payload.scope as string));
        case 'delete':
            return [];
    }
}
