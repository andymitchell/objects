import { DotPropPathsIncArrayUnion } from "../dot-prop-paths/types";

/**
 * Return a clone, optionally safely handling circular references or removing specific key patterns. 
 * @param obj 
 * @returns 
 */
export default function cloneDeepSafe<T extends Record<string, any> | any[]>(obj: T, options?: {strip_circular?: boolean, strip_keys_exact?: DotPropPathsIncArrayUnion<T>[], strip_keys_regexp?: RegExp[]}):T {
    // Based on https://github.com/sindresorhus/decircular/blob/main/index.js (MIT)
    // Cloned to add stripping specific keys 

    const seenObjects = new WeakMap();

	function internalDecircular(value:any, path:string[] = []) {
        
        if( options?.strip_keys_exact || options?.strip_keys_regexp ) {
            const currentPath = path.join('.');
            console.log(currentPath)
            if( options?.strip_keys_exact?.some(x => x===currentPath) || options?.strip_keys_regexp?.some(x => x.test(currentPath)) ) {
                return undefined
            }
        }
        
		if (!(value !== null && typeof value === 'object')) {
			return value;
		}

        if( options?.strip_circular ) {
            const existingPath = seenObjects.get(value);
            if (existingPath) {
                return `[Circular *${existingPath.join('.')}]`;
            }
        }

		seenObjects.set(value, path);

		const newValue:any = Array.isArray(value) ? [] : {};

		for (const [key2, value2] of Object.entries(value)) {
			newValue[key2] = internalDecircular(value2, [...path, key2]);
		}

		seenObjects.delete(value);

		return newValue;
	}

	return internalDecircular(obj);
}