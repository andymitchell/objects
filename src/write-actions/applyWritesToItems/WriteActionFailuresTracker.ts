import { z } from "zod";
import { WriteAction, WriteActionFailures, WriteActionFailuresErrorDetails } from "../types";
import { ListRules } from "./types";
import { isEqual } from "lodash-es";
import safeKeyValue from "../../getKeyValue";

type FailedAction<T extends Record<string, any>> = WriteActionFailures<T>[number];
type FailedItem<T extends Record<string, any>> = WriteActionFailures<T>[number]['affected_items'][number];
export default class WriteActionFailuresTracker<T extends Record<string, any>> {
    private schema: z.ZodType<T, any, any>;
    private rules: ListRules<T>;
    private failures: WriteActionFailures<T>;

    constructor(schema: z.ZodType<T, any, any>, rules: ListRules<T>) {
        this.schema = schema;
        this.rules = rules;
        this.failures = [];

        
    }

    private findAction<IMA extends boolean = false>(action:WriteAction<T>, ifMissingAdd?: IMA): IMA extends true? FailedAction<T> : FailedAction<T>  | undefined {
        let failedAction = this.failures.find(x => isEqual(x.action, action));
        if( ifMissingAdd && !failedAction ) {
            failedAction = {action, affected_items: []};
            this.failures.push(failedAction);
        }
        return failedAction as IMA extends true? FailedAction<T> : FailedAction<T>  | undefined;
    }

    private findActionAndItem<IMA extends boolean = false>(action:WriteAction<T>, item:T, ifMissingAdd?: IMA):IMA extends true? {failedAction:FailedAction<T>, failedItem: FailedItem<T>} : {failedAction?:FailedAction<T>, failedItem?: FailedItem<T>} {
        const failedAction = this.findAction(action, ifMissingAdd);
        let failedItem:WriteActionFailures<T>[number]['affected_items'][number] | undefined;
        if( failedAction ) {

            const itemPk = safeKeyValue(item[this.rules.primary_key], true);
            failedItem = itemPk ? failedAction.affected_items.find(x => itemPk===safeKeyValue(x.item[this.rules.primary_key])) : undefined;
            if( ifMissingAdd && !failedItem ) {
                failedItem = {item, error_details: []};
                failedAction.affected_items.push(failedItem);
            }
        }

        return {failedAction, failedItem} as IMA extends true? {failedAction:FailedAction<T>, failedItem: FailedItem<T>} : {failedAction?:FailedAction<T>, failedItem?: FailedItem<T>}
    }

    private addErrorDetails(action:FailedAction<T>, item:FailedItem<T>, errorDetails:WriteActionFailuresErrorDetails) {
        if( item.error_details.some(x => isEqual(x, errorDetails)) ) {
            return;
        }
        switch(errorDetails.type) {
            case 'schema': {
                // TODO Should it merge issues instead? Otherwise the list of issues might involve lots of duplication. 
                action.unrecoverable = true;
                item.error_details.push(errorDetails);
                break;
            }
            case 'missing_key': {
                action.unrecoverable = true;
                item.error_details.push(errorDetails);
                break;
            }
            case 'custom': {
                item.error_details.push(errorDetails);
            }
        }
    }

    testSchema(action:WriteAction<T>, item: T):boolean {
        const result = this.schema.safeParse(item);
        if( !result.success ) {
            const {failedAction, failedItem} = this.findActionAndItem(action, item, true);
            this.addErrorDetails(failedAction, failedItem, {
                type: 'schema',
                issues: result.error.issues
            });
        }
        return result.success;
        
    }

    report(action:WriteAction<T>, item: T, errorDetails: WriteActionFailuresErrorDetails):void {
        const {failedAction, failedItem} = this.findActionAndItem(action, item, true);
        this.addErrorDetails(failedAction, failedItem, errorDetails);
    }

    mergeUnderAction(action:WriteAction<T>, failedActions:WriteActionFailures<T>):void {

        for( const subAction of failedActions ) {
            for( const subItem of subAction.affected_items ) {
                const {failedAction, failedItem} = this.findActionAndItem(action, subItem.item, true);
                for( const errorDetails of subItem.error_details ) {
                    this.addErrorDetails(failedAction, failedItem, errorDetails);
                }
            }
        }
    }

    length():number {
        return this.failures.length;
    }

    get():WriteActionFailures<T> {
        return JSON.parse(JSON.stringify(this.failures));
    }
}