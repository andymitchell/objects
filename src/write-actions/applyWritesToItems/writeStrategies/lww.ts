import { merge } from "lodash-es";
import type { WriteStrategy } from "../types.js";
import deleteUnusedKeysFromDestination from "../helpers/deleteUnusedKeysFromDestination.js";
import { VALUE_TO_DELETE_KEY } from "../../types.js";

const writeLww: WriteStrategy<Record<string, any>> = {
    create_handler: (writeActionPayload) => {
        return writeActionPayload.data;
    },
    update_handler(writeActionPayload, target) {

    
        if( Array.isArray(target) ) {
            throw new Error("Cannot update an array. Use 'array_scope' instead to create/update/delete items in it.");
        }
        if (!writeActionPayload.method || writeActionPayload.method === 'merge') {
            merge(target, writeActionPayload.data) // MUTATION
        } else {
            Object.assign(target, writeActionPayload.data); // MUTATION
        }
        deleteUnusedKeysFromDestination(writeActionPayload.data, target, VALUE_TO_DELETE_KEY);


        return target;
    }
}

export default writeLww;