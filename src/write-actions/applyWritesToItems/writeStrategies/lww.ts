import { merge } from "lodash-es";
import { WriteStrategy } from "../types";
import deleteUnwantedKeysFromDestination from "../deleteUnwantedKeysFromDestination";
import { VALUE_TO_DELETE_KEY } from "../../types";

const writeLww: WriteStrategy<Record<string, any>> = {
    create_handler: (writeActionPayload) => {
        return { created: true, item: writeActionPayload.data };
    },
    update_handler(writeActionPayload, target, alreadyCloned) {
        target = alreadyCloned ? target : structuredClone(target);

    
        if( Array.isArray(target) ) {
            throw new Error("Cannot update an array. Use 'array_scope' instead to create/update/delete items in it.");
        }
        if (writeActionPayload.method === 'merge') {
            merge(target, writeActionPayload.data) // MUTATION
        } else {
            Object.assign(target, writeActionPayload.data); // MUTATION
        }
        deleteUnwantedKeysFromDestination(writeActionPayload.data, target, VALUE_TO_DELETE_KEY);


        return { updated: true, item: target };
    }
}

export default writeLww;