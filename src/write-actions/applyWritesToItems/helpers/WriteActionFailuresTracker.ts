import { z } from "zod";
import type { WriteAction, WriteError, WriteErrorContext, WriteAffectedItem, WriteOutcomeFailed } from "../../types.ts";
import type { ListRules } from "../types.js";
import deepEql from "deep-eql";
import { type PrimaryKeyGetter, makePrimaryKeyGetter } from "../../../utils/getKeyValue.js";
import { convertSchemaToDotPropPathTree, type TreeNode } from "../../../dot-prop-paths/zod.ts";
import cloneDeepSafe from "../../../utils/cloneDeepSafe.ts";


export default class FailedWriteActionuresTracker<T extends Record<string, any>> {
    private schema: z.ZodType<T, any, any>;
    private failures: WriteOutcomeFailed<T>[];
    private pk:PrimaryKeyGetter<T>;

    constructor(schema: z.ZodType<T, any, any>, rules: ListRules<T>) {
        this.schema = schema;
        this.failures = [];
        this.pk = makePrimaryKeyGetter(rules.primary_key);
    }

    shouldHalt():boolean {
        return this.length()>0;
    }

    private findAction<IMA extends boolean = false>(action:WriteAction<T>, ifMissingAdd?: IMA): IMA extends true? WriteOutcomeFailed<T> : WriteOutcomeFailed<T> | undefined {
        let failedAction = this.failures.find(x => deepEql(x.action, action));
        if( ifMissingAdd && !failedAction ) {
            failedAction = {ok: false, action, errors: [], affected_items: []};
            this.failures.push(failedAction);
        }
        return failedAction as IMA extends true? WriteOutcomeFailed<T> : WriteOutcomeFailed<T> | undefined;
    }

    private findActionAndItem<IMA extends boolean = false>(action:WriteAction<T>, item:T, ifMissingAdd?: IMA):IMA extends true? {failedAction:WriteOutcomeFailed<T>, failedItem: WriteAffectedItem<T>} : {failedAction?:WriteOutcomeFailed<T>, failedItem?: WriteAffectedItem<T>} {
        const failedAction = this.findAction(action, ifMissingAdd);
        let failedItem:WriteAffectedItem<T> | undefined;
        if( failedAction ) {
            const itemPk = this.pk(item, true);
            failedItem = itemPk ? failedAction.affected_items?.find(x => itemPk===x.item_pk): undefined;
            if( ifMissingAdd && !failedItem ) {
                failedItem = {item_pk: itemPk, item};
                if( !failedAction.affected_items ) failedAction.affected_items = [];
                failedAction.affected_items.push(failedItem);
            }
        }

        return {failedAction, failedItem} as IMA extends true? {failedAction:WriteOutcomeFailed<T>, failedItem: WriteAffectedItem<T>} : {failedAction?:WriteOutcomeFailed<T>, failedItem?: WriteAffectedItem<T>}
    }

    private addErrorDetails(action:WriteOutcomeFailed<T>, item:WriteAffectedItem<T>, errorDetails:WriteError) {
        const errorContext: WriteErrorContext<T> = {
            ...errorDetails,
            item_pk: item.item_pk,
            item: item.item,
        };

        // Deduplicate: skip if an equivalent error already exists for this item
        if( action.errors.some(x => deepEql(x, errorContext)) ) {
            return;
        }

        action.errors.push(errorContext);

        switch(errorDetails.type) {
            case 'schema':
            case 'missing_key':
            case 'create_duplicated_key':
            case 'update_altered_key':
            case 'permission_denied':
                action.unrecoverable = true;
                break;
            case 'custom':
                break;
        }
    }

    testSchema(action:WriteAction<T>, item: T):boolean {
        const result = this.schema.safeParse(item);
        if( !result.success ) {

            let serialisedSchema:TreeNode | undefined;
            try {
                const serialisedSchemaResult = cloneDeepSafe(convertSchemaToDotPropPathTree(this.schema));

                serialisedSchema = serialisedSchemaResult.root
            } catch(e) {}

            const {failedAction, failedItem} = this.findActionAndItem(action, item, true);
            this.addErrorDetails(failedAction, failedItem, {
                type: 'schema',
                issues: result.error.issues,
                tested_item: item,
                serialised_schema: serialisedSchema
            });
        }
        return result.success;

    }

    report(action:WriteAction<T>, item: T, errorDetails: WriteError):void {
        const {failedAction, failedItem} = this.findActionAndItem(action, item, true);
        this.addErrorDetails(failedAction, failedItem, errorDetails);
    }

    blocked(action:WriteAction<T>, blocked_by_action_uuid:string):void {
        const failedAction = this.findAction(action, true);
        failedAction.blocked_by_action_uuid = blocked_by_action_uuid;
    }

    mergeUnderAction(action:WriteAction<T>, failedActions:WriteOutcomeFailed<any>[]):void {
        for( const subAction of failedActions ) {
            if( subAction.affected_items ) {
                for( const subItem of subAction.affected_items ) {
                    if( subItem.item ) {
                        const {failedAction, failedItem} = this.findActionAndItem(action, subItem.item, true);
                        // Merge errors from sub-action that relate to this item
                        for( const error of subAction.errors ) {
                            if( error.item_pk === subItem.item_pk ) {
                                const { item_pk: _ipk, item: _item, ...errorBase } = error;
                                this.addErrorDetails(failedAction, failedItem, errorBase);
                            }
                        }
                        // Also merge errors without item context
                        for( const error of subAction.errors ) {
                            if( error.item_pk === undefined ) {
                                const { item_pk: _ipk, item: _item, ...errorBase } = error;
                                this.addErrorDetails(failedAction, failedItem, errorBase);
                            }
                        }
                    }
                }
            }
        }
    }

    length():number {
        return this.failures.length;
    }

    get():WriteOutcomeFailed<T>[] {
        return JSON.parse(JSON.stringify(this.failures));
    }
}
