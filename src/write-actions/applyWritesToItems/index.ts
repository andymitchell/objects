import applyWritesToItems from "./applyWritesToItems";
import { checkPermission } from "./helpers/checkPermission";
import { ApplyWritesToItemsOptions, DDL, ListOrdering } from "./types";

export default applyWritesToItems;
export {applyWritesToItems, checkPermission};
export type {DDL, ListOrdering, ApplyWritesToItemsOptions};