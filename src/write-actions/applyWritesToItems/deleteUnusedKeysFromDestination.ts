/*
Key Deletion (#VALUE_TO_DELETE_KEY)

We need a way to stipulate that a key should be deleted. The problems are: 
- Lodash's merge will ignore 'undefined' values in the source (aka the updater), even if they're explicit
- TypeScript won't allow values to become 'null' 

The solution is deleteUnusedKeysFromDestination... It recurses the keys of the source, and if it has an explicit undefined/null value, it removes it from the final object (aka destination). 

The choice to use undefined or null is set in types: VALUE_TO_DELETE_KEY 
- If you choose null, you'll have to update the WriteActionPayloadUpdate type to allow a Nullable T 

A totally different approach: 
- Create a new WriteAction just to delete keys explicitly. 

Remember a client doesn't want to get into the internals here. They reasonably expect:
- Setting something to undefined will delete it
- Setting something to null would stay as null (but this is the convention Firebase uses for delete, so they might expect it)

*/

export default function deleteUnusedKeysFromDestination<T extends {}>(src: Readonly<Partial<T>>, dest: Partial<T>, valueToDeleteKey: undefined | null): void {
    const keys = Object.keys(src) as Array<keyof T>;
    keys.forEach(key => {
        const srcValue = src[key];
        const destValue = dest[key];
        if (srcValue && typeof srcValue === 'object' && destValue) {
            if (!(key in dest)) {
                throw new Error("Destination should include all source keys - i.e. they should have already merged.");
            }
            deleteUnusedKeysFromDestination(srcValue as Readonly<T>, destValue, valueToDeleteKey);
        } else if (src[key] === valueToDeleteKey) {
            // Delete the key 
            delete dest[key];
        }
    });
}