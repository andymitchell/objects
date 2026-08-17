import { cloneDeep, mergeWith } from "lodash-es";
import type { WritePayloadCreate, WritePayloadUpdate } from "../../types.ts";


const writeLww: {
    create_handler: (writeActionPayload: WritePayloadCreate<Record<string, any>>) => Record<string, any>;
    update_handler: (writeActionPayload: WritePayloadUpdate<Record<string, any>>, target: Record<string, any>) => void;
} = {
    create_handler: (writeActionPayload) => {
        // A copy, for the reason the update handler sets out below: a stored item and the action that wrote it
        // lead separate lives.
        return cloneDeep(writeActionPayload.data);
    },
    update_handler(writeActionPayload, target) {


        if( Array.isArray(target) ) {
            throw new Error("Cannot update an array. Use 'array_scope' instead to create/update/delete items in it.");
        }

        // Items are edited in place as later writes land on them, so a value installed from the action would
        // let a future write rewrite the action itself — a document its author may still retry, log or replay.
        // The copy reads the data rather than transferring it, so an action composed behind a proxy — an Immer
        // draft, a framework's reactive object — is copied as the plain data it stands for instead of refused.
        const data = cloneDeep(writeActionPayload.data);

        if (!writeActionPayload.method || writeActionPayload.method === 'merge') {
            // Don't merge arrays, because weird things happen. E.g. an update of ['z'] to a property that's currently ['1', '2'] would end up as ['z', '2'], which *no one would reasonably expect* (i.e. terrible DX).
            // Go with what a developer might expect: if you set an array, the whole array is set.
            mergeWith(target, data, (objValue, srcValue) => { // MUTATION
                if( Array.isArray(srcValue) ) {
                    return srcValue;
                }
            })
        } else {
            Object.assign(target, data); // MUTATION
        }
    }
}

export default writeLww;