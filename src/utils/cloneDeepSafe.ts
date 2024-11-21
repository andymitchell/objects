
type CloneDeepSafeOptions = {
    /**
     * Strip non-serializable (e.g. function, wasm) keys directly under the given keys
     * 
     * Note normal JSON.parse(JSON.stringify) works fine for stripping non-serializable more generally. This is for being highly targetted to problem areas.
     */
    strip_non_serializable_under_keys?: string[],

    /**
     * Pre-emptively remove circular references
     */
    strip_circular?: boolean, 

    /**
     * Strip keys at the dot prop path given
     */
    strip_keys_exact?: string[], 

    /**
     * Strip keys if their dot prop path matches the reg exp
     */
    strip_keys_regexp?: RegExp[]
}

/**
 * Return a clone, optionally safely handling circular references or removing specific key patterns. 
 * @param obj 
 * @returns 
 */
export default function cloneDeepSafe<T extends Record<string, any> | any[]>(obj: T, options?: CloneDeepSafeOptions):T {
    // Based on https://github.com/sindresorhus/decircular/blob/main/index.js (MIT)
    // Cloned to add stripping specific keys 

    const seenObjects = new WeakMap();

	function internalDecircular(value:any, path:string[] = []) {
        
        
        let strippingNonSerializableUnderThis = false;
        if( options?.strip_keys_exact || options?.strip_keys_regexp || options?.strip_non_serializable_under_keys ) {
            const currentPath = path.join('.');
            if( options?.strip_keys_exact?.some(x => x===currentPath) || options?.strip_keys_regexp?.some(x => x.test(currentPath)) ) {
                return undefined
            }
            if( options?.strip_non_serializable_under_keys?.some(x => x===currentPath) ) {
                strippingNonSerializableUnderThis = true;
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

            let error = false;
            if( strippingNonSerializableUnderThis ) {
                
                try {
                    if( typeof value2==='function' ) {
                        error = true;
                    } else {
                        const result = JSON.stringify(value2);
                        error = result===undefined;
                    }
                } catch(e) {
                    error = true;
                }
            }
            
            newValue[key2] = error? undefined : internalDecircular(value2, [...path, key2]);
            
		}

		seenObjects.delete(value);

		return newValue;
	}

	return internalDecircular(obj);
}