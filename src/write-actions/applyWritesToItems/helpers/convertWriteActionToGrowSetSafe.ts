import type { WriteAction } from "../../types.js";
import type { ListRules } from "../types.js";

export default function convertWriteActionToGrowSetSafe<T extends Record<string, any>>(
    action:WriteAction<T>,
    item: Readonly<T>,
    rules: ListRules<T>
    ):WriteAction<T>[] {

        if( rules.growset ) {
            // TODO
            return [action];
        } else {
            return [action];
        }

}