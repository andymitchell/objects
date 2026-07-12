/**
 * An own-property-only port of `dot-prop`'s `getProperty` (vendored from dot-prop v9.0.0, MIT © Sindre Sorhus).
 *
 * Resolves a dot-prop path (`a.b`, `a[0].b`, `a\.b` escapes) against a runtime value, treating any path
 * segment that is not an OWN property of its container as absent. An inherited member such as `toString`,
 * `valueOf` or `hasOwnProperty` therefore resolves `undefined` — an untrusted path cannot read
 * `Object.prototype` members — while a data object genuinely holding such a key still resolves it.
 *
 * Vendored because the modification cannot be made from outside the package: dot-prop's walk reads
 * `object[key]` unconditionally, its `hasProperty` uses `in` (which includes inherited members), and its
 * path parser is not exported — and this module must stay grammar-compatible with dot-prop, since paths
 * written in its grammar (bracket indices, escaped dots) are resolved back through this reader.
 */

const disallowedKeys = new Set(['__proto__', 'prototype', 'constructor']);
const digits = new Set('0123456789');

type PathSegment = string | number;

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
    const type = typeof value;
    return value !== null && (type === 'object' || type === 'function');
}

function getPathSegments(path: string): PathSegment[] {
    const parts: PathSegment[] = [];
    let currentSegment = '';
    let currentPart: 'start' | 'property' | 'index' | 'indexEnd' = 'start';
    let isIgnoring = false;

    // dot-prop's parser handles ordinary characters in its switch's default case, with `]` falling
    // through to it; extracted here so the port has no fallthrough.
    const consumeOrdinaryCharacter = (character: string): void => {
        if (currentPart === 'index' && !digits.has(character)) {
            throw new Error('Invalid character in an index');
        }
        if (currentPart === 'indexEnd') {
            throw new Error('Invalid character after an index');
        }
        if (currentPart === 'start') {
            currentPart = 'property';
        }
        if (isIgnoring) {
            isIgnoring = false;
            currentSegment += '\\';
        }
        currentSegment += character;
    };

    for (const character of path) {
        switch (character) {
            case '\\': {
                if (currentPart === 'index') {
                    throw new Error('Invalid character in an index');
                }
                if (currentPart === 'indexEnd') {
                    throw new Error('Invalid character after an index');
                }
                if (isIgnoring) {
                    currentSegment += character;
                }
                currentPart = 'property';
                isIgnoring = !isIgnoring;
                break;
            }
            case '.': {
                if (currentPart === 'index') {
                    throw new Error('Invalid character in an index');
                }
                if (currentPart === 'indexEnd') {
                    currentPart = 'property';
                    break;
                }
                if (isIgnoring) {
                    isIgnoring = false;
                    currentSegment += character;
                    break;
                }
                if (disallowedKeys.has(currentSegment)) {
                    return [];
                }
                parts.push(currentSegment);
                currentSegment = '';
                currentPart = 'property';
                break;
            }
            case '[': {
                if (currentPart === 'index') {
                    throw new Error('Invalid character in an index');
                }
                if (currentPart === 'indexEnd') {
                    currentPart = 'index';
                    break;
                }
                if (isIgnoring) {
                    isIgnoring = false;
                    currentSegment += character;
                    break;
                }
                if (currentPart === 'property') {
                    if (disallowedKeys.has(currentSegment)) {
                        return [];
                    }
                    parts.push(currentSegment);
                    currentSegment = '';
                }
                currentPart = 'index';
                break;
            }
            case ']': {
                if (currentPart === 'index') {
                    parts.push(Number.parseInt(currentSegment, 10));
                    currentSegment = '';
                    currentPart = 'indexEnd';
                    break;
                }
                if (currentPart === 'indexEnd') {
                    throw new Error('Invalid character after an index');
                }
                consumeOrdinaryCharacter(character);
                break;
            }
            default: {
                consumeOrdinaryCharacter(character);
            }
        }
    }

    if (isIgnoring) {
        currentSegment += '\\';
    }

    switch (currentPart) {
        case 'property': {
            if (disallowedKeys.has(currentSegment)) {
                return [];
            }
            parts.push(currentSegment);
            break;
        }
        case 'index': {
            throw new Error('Index was not closed');
        }
        case 'start': {
            parts.push('');
            break;
        }
        // No default
    }

    return parts;
}

/** A string key that aliases an array index (`arr['0']`) — dot-prop rejects these to keep index access numeric. */
function isStringIndex(object: unknown, key: PathSegment): boolean {
    if (typeof key !== 'number' && Array.isArray(object)) {
        const index = Number.parseInt(key, 10);
        return Number.isInteger(index) && object[index] === object[key as keyof typeof object];
    }
    return false;
}

/**
 * Resolve `path` against `object`, reading only own properties at each step.
 *
 * @param object the value to resolve against. A non-object root is returned as-is (dot-prop's contract).
 * @param path the dot-prop path. A denylisted segment (`__proto__`, `prototype`, `constructor`) resolves `undefined`.
 * @returns the resolved own value, or `undefined` when any segment is not an own property of its container.
 */
export function getPropertyOwn(object: unknown, path: string): unknown {
    if (!isObject(object) || typeof path !== 'string') {
        return object;
    }

    const pathArray = getPathSegments(path);
    if (pathArray.length === 0) {
        return undefined;
    }

    let current: unknown = object;
    for (let index = 0; index < pathArray.length; index++) {
        const key = pathArray[index]!;

        if (isStringIndex(current, key)) {
            current = index === pathArray.length - 1 ? undefined : null;
        } else {
            // The one modification vs dot-prop, which reads `current[key]` unconditionally: only an OWN
            // property resolves. `current` is never null/undefined here (the loop exits on those below),
            // but it may be a primitive mid-path; the cast is safe because Object.hasOwn and the bracket
            // read both coerce primitives exactly as dot-prop's unconditional read did.
            const container = current as Record<PropertyKey, unknown>;
            current = Object.hasOwn(container, key) ? container[key] : undefined;
        }

        if (current === undefined || current === null) {
            if (index !== pathArray.length - 1) {
                return undefined;
            }
            break;
        }
    }

    return current;
}
