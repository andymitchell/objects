import { Draft } from "immer";
import { IUser } from "../../auth/types";
import { DDL, DDLPermissions, DDLPermissionsSchema } from "../types";
import { WriteActionFailuresErrorDetails } from "../../types";
import { getPropertySpreadingArrays } from "../../../dot-prop-paths/getPropertySimpleDot";


export function checkPermission<T extends Record<string, any>>(item:Readonly<T> | Draft<T>, ddl: DDL<T>, user?: IUser, verifiedPermissionsSchema?: boolean):WriteActionFailuresErrorDetails | undefined {
    if( !ddl.permissions ) return undefined;
    if( !verifiedPermissionsSchema ) {
        if( !DDLPermissionsSchema.safeParse(ddl.permissions).success ) {
            return {type: 'permission_denied', reason: 'invalid-permissions'};
        }
    }

    if( user ) {
        if( ddl.permissions.type==='owner_id_property' || ddl.permissions.type==='owner_id_in_scalar_array' ) {
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
                        if( ddl.permissions!.type==='owner_id_in_scalar_array' && Array.isArray(arrayValue.value) ) {
                            return arrayValue.value.includes(id);
                        } else if( ddl.permissions!.type==='owner_id_property' ) {
                            return arrayValue.value===id
                        }
                    })
                    
                    if( !passed ) {
                        return {'type': 'permission_denied', reason: 'not-owner'};
                    }
                    
                }
            } else {
                return {type: 'permission_denied', reason: 'no-owner-id'};
            }
        } else {
            return {type: 'permission_denied', reason: 'unknown-permission'};
        }
    } else {
        return {type: 'permission_denied', reason: 'no-owner-id'};
    }

}