import {writeToItemsArray, writeToItemsArrayPreserveInputType} from "./writeToItemsArray.ts";
import { checkWritePermission } from "./helpers/checkPermission.ts";
import type { WriteToItemsArrayOptions, DDL } from "./types.ts";


export {
    writeToItemsArray,
    checkWritePermission,
    writeToItemsArrayPreserveInputType
};
export type {
    DDL,
    WriteToItemsArrayOptions
};