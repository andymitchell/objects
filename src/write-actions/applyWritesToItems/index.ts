import applyWritesToItems from "./applyWritesToItems.js";
import { checkPermission } from "./helpers/checkPermission.js";
import type { ApplyWritesToItemsOptions, DDL, ListOrdering } from "./types.js";

export default applyWritesToItems;
export {applyWritesToItems, checkPermission};
export type {DDL, ListOrdering, ApplyWritesToItemsOptions};