import type { Draft } from "immer";
import type { IUser } from "../../auth/types.js";
import { type DDL, DDLPermissionsSchema } from "../types.js";

import { getPropertySpreadingArrays } from "../../../dot-prop-paths/getPropertySimpleDot.js";
import type { WriteCommonError } from "../../types.ts";


export function checkPermission<T extends Record<string, any>>(item:Readonly<T> | Draft<T>, ddl: DDL<T>, user?: IUser, verifiedPermissionsSchema?: boolean):WriteCommonError | undefined {
    if( !ddl.permissions || ddl.permissions.type==='none' ) return undefined;
    if( !verifiedPermissionsSchema ) {
        if( !DDLPermissionsSchema.safeParse(ddl.permissions).success ) {
            return {type: 'permission_denied', reason: 'invalid-permissions'};
        }
    }

    if( user ) {
        if( ddl.permissions.type==='basic_ownership_property' ) {
            if( ddl.permissions.property_type==='id' || ddl.permissions.property_type==='id_in_scalar_array' ) {
                let id: string | undefined;
                if( ddl.permissions.format==='uuid' ) {
                    id = user.getUuid();
                } else if( ddl.permissions.format==='email' ) {
                    id = user.getEmail();
                }
                if( id ) {
                    if( ddl.permissions.format==='email' && !/.+\@.+\..+/.test(id) ) {
                        return {type: 'permission_denied', reason: 'expected-owner-email'};
                    } else {
                    
                        const arrayValues = getPropertySpreadingArrays(item, ddl.permissions.path);
                        
                        const passed = arrayValues.some(arrayValue => {
                            if( ddl.permissions.type==='basic_ownership_property' ) {
                                if( ddl.permissions!.property_type==='id_in_scalar_array' && Array.isArray(arrayValue.value) ) {
                                    return arrayValue.value.includes(id);
                                } else if( ddl.permissions!.property_type==='id' ) {
                                    return arrayValue.value===id
                                }
                            } else {
                                throw new Error("typeguard noop");
                            }
                        })

                        let secondaryPassed = false;
                        if( ddl.permissions!.property_type==='id' && ddl.permissions!.transferring_to_path ) {
                            const secondaryArrayValues = getPropertySpreadingArrays(item, ddl.permissions.transferring_to_path);
                            secondaryPassed = secondaryArrayValues.some(arrayValue => {
                                return arrayValue.value===id
                            })
    
                        }
                        
                        if( !passed && !secondaryPassed ) {
                            return {'type': 'permission_denied', reason: 'not-owner'};
                        }
                        
                    }
                } else {
                    return {type: 'permission_denied', reason: 'no-owner-id'};
                }
            } else {
                return {type: 'permission_denied', reason: 'unknown-permission'};
            }
        }
    } else {
        return {type: 'permission_denied', reason: 'no-owner-id'};
    }

}