import { getPropertySpreadingArrays } from "../../dot-prop-paths/getPropertySimpleDot";
import { DotPropPathValidArrayValue } from "../../dot-prop-paths/types";
import { WriteAction, WriteActionPayloadArrayScope } from "../types";
import { DDL } from "./types";

export default function getScopedArrays<T extends Record<string, any>>(item:T, payload:Readonly<WriteActionPayloadArrayScope<T>>, rules:DDL<T>) {
    type ScopedType = DotPropPathValidArrayValue<T, typeof payload.scope>; // Note that because of generics, this type is meaningless to the type checker. Helpful to read though. 

    type ScopedRules = Partial<DDL<ScopedType>>;
    const scopedRules:ScopedRules = {};
    for( let ruleKey in rules ) {
        if( ruleKey.indexOf(payload.scope)===0 ) {
            // @ts-ignore
            const scopedRuleKey = ruleKey===payload.scope? '.' : ruleKey.replace(payload.scope, '') as keyof ScopedRules;
            // @ts-ignore It's a classic TS problem of trying to clone an object. It's solvable, I'm just tight for time. 
            scopedRules[scopedRuleKey] = rules[ruleKey];
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