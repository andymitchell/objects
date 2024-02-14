import { getPropertySpreadingArrays } from "../../dot-prop-paths/getPropertySimpleDot";
import { DotPropPathValidArrayValue } from "../../dot-prop-paths/types";
import { WriteAction, WriteActionPayloadArrayScope } from "../types";
import { DDL } from "./types";

export default function getScopedArrays<T>(item:T, payload:Readonly<WriteActionPayloadArrayScope<T>>, rules:DDL<T>) {
    type ScopedType = DotPropPathValidArrayValue<T, typeof payload.scope>; // Note that because of generics, this type is meaningless to the type checker. Helpful to read though. 

    const scopedRules:Partial<DDL<ScopedType>> = {};
    for( let ruleKey in rules ) {
        if( ruleKey.indexOf(payload.scope)===0 ) {
            scopedRules[ruleKey===payload.scope? '.' : ruleKey.replace(payload.scope, '')] = rules[ruleKey];
        }
    }

    const propertyResults = getPropertySpreadingArrays(item, payload.scope);

    return propertyResults.map(scopedItems => {
        if( !Array.isArray(scopedItems.value) ) throw new Error('array_scope paths must be to an array');
        return {
            writeActions: payload.actions as WriteAction<ScopedType>[],
            items: scopedItems.value as ScopedType[],
            path: scopedItems.path,
            ddl: scopedRules as DDL<ScopedType>
        }
    });
}