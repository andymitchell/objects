import type { IUser } from "../../auth/types.ts";
import type { DDL } from "../types.ts";
import { checkWritePermission } from "./checkPermission.ts";

type TestItem = {
    id: string, 
    owner: string
    new_owner?: string
}
type TestItemOwnerArray = {
    id: string, 
    owners: string[]
}

type TestItemOwnerObjectArray = {
    id: string, 
    owners: {email: string}[]
}

const userEmpty:IUser = {
    getUuid: () => '',
    getEmail: () => '',
    getID: () => ''
}

const user1:IUser = {
    getUuid: () => 'user1',
    getEmail: () => 'user1@gmail.com',
    getID: () => 'user1'
}


const user2:IUser = {
    getUuid: () => 'user2',
    getEmail: () => 'user2@gmail.com',
    getID: () => 'user2'
}


const testItems:TestItem = {
   id: '1',
   owner: user1.getUuid()!
};

const testItemsWithOwnerArray:TestItemOwnerArray = {
    id: '1',
    owners: [user1.getUuid()!]
 };

 const testItemsWithObjectOwnersArray:TestItemOwnerObjectArray = {
    id: '1',
    owners: [{email: user1.getEmail()!}]
 };

 const ddl:DDL<TestItem> = {
    version: 1,
    lists: {'.': {primary_key: 'id'}},
    ownership: {
        type: 'basic',
        property_type: 'id',
        path: 'owner',
        format: 'uuid',
        transferring_to_path: 'new_owner'
    }
 }

 const ddlWithOwnerArray:DDL<TestItemOwnerArray> = {
    version: 1,
    lists: {'.': {primary_key: 'id'}},
    ownership: {
        type: 'basic',
        property_type: 'id_in_scalar_array',
        path: 'owners',
        format: 'uuid'

    }

 }


 const ddlWithObjectOwnersArray:DDL<TestItemOwnerObjectArray> = {
    version: 1,
    lists: {'.': {primary_key: 'id'}, 'owners': {primary_key: 'email'}},
    ownership: {
        type: 'basic',
        property_type: 'id',
        path: 'owners.email',
        format: 'email'
    
    },
 }
 
describe('Can write', () => {
    describe('checkPermissions TestItem', () => {

        test('checkPermissions TestItem success', () => {
            const failures = checkWritePermission(testItems, ddl, user1);
            expect(failures).toBe(undefined);
        })
    
        test('checkPermissions TestItem fail', () => {
            const failures = checkWritePermission(testItems, ddl, user2);
            expect(!!failures).toBe(true);
        })
    
        test('TestItem path is undefined', () => {
            // @ts-ignore breaking for test
            const failures = checkWritePermission({}, ddl, user1);
            expect(!!failures).toBe(true);
        });
    
        test('TestItem path is array', () => {
            // @ts-ignore breaking for test
            const failures = checkWritePermission({owner: ['user1']}, ddl, user1);
            expect(!!failures).toBe(true);
        });
    
        test('TestItem path empty user', () => {
            const failures = checkWritePermission(testItems, ddl, userEmpty);
            expect(!!failures).toBe(true);
        });
    
        test('TestItem invalid ddl', () => {
            const ddl2 = structuredClone(ddl);
            // @ts-ignore breaking for test
            ddl2.ownership = {};
            
            const failures = checkWritePermission(testItems, ddl2, user1);
            expect(!!failures).toBe(true);
        });
    });
    
    describe('checkPermissions TestItemOwnerArray', () => {
    
        test('checkPermissions TestItemOwnerArray success', () => {
            const failures = checkWritePermission(testItemsWithOwnerArray, ddlWithOwnerArray, user1)
            expect(failures).toBe(undefined);
        })
    
        test('checkPermissions TestItemOwnerArray fail', () => {
            const failures = checkWritePermission(testItemsWithOwnerArray, ddlWithOwnerArray, user2);
            expect(!!failures).toBe(true);
        })
    
        test('TestItemOwnerArray path is undefined', () => {
            // @ts-ignore breaking for test
            const failures = checkWritePermission({}, ddlWithOwnerArray, user1)
            expect(!!failures).toBe(true);
        });
    
        test('TestItemOwnerArray path is not array', () => {
            // @ts-ignore breaking for test
            const failures = checkWritePermission({owner: 'user1'}, ddlWithOwnerArray, user1)
            expect(!!failures).toBe(true);
        });
    
    
        test('TestItem path empty user', () => {
            
            const failures = checkWritePermission(testItemsWithOwnerArray, ddlWithOwnerArray, userEmpty);
            expect(!!failures).toBe(true);
        });
    
    });
    
    describe('checkPermissions TestItemOwnerObjectArray', () => {
        test('checkPermissions TestItemOwnerObjectArray success', () => {
            const failures = checkWritePermission(testItemsWithObjectOwnersArray, ddlWithObjectOwnersArray, user1);
            expect(failures).toBe(undefined);
        })
    
        test('checkPermissions TestItemOwnerObjectArray fail', () => {
            const failures = checkWritePermission(testItemsWithObjectOwnersArray, ddlWithObjectOwnersArray, user2);
            expect(!!failures).toBe(true);
        })
    
        test('TestItemOwnerObjectArray path is undefined', () => {
            // @ts-ignore breaking for test
            const failures = checkWritePermission({}, ddlWithObjectOwnersArray, user1);
            expect(!!failures).toBe(true);
        });
    
        test('TestItemObjectOwnersArray path is not array', () => {
            // @ts-ignore breaking for test
            const failures = checkWritePermission({owner: 'user1'}, ddlWithObjectOwnersArray, user1);
            expect(!!failures).toBe(true);
        });
    
    
        test('TestItem path empty user', () => {
            const failures = checkWritePermission(testItemsWithObjectOwnersArray, ddlWithObjectOwnersArray, userEmpty);
            expect(!!failures).toBe(true);
        });
    
    
    });
})


    
describe('Transfer Ownership', () => {

    describe('TestItem', () => {

        test('Succeeds', () => {

            // Give it to another: 
            const testItemsTransferring:TestItem = {
                id: '1',
                owner: user1.getUuid()!,
                new_owner: user2.getUuid()!
            };

            // Verify user1 can make the change:
            const failures1 = checkWritePermission(testItemsTransferring, ddl, user1);
            expect(failures1).toBe(undefined);

            // Verify user2 can remove user 1 to complete it
            const failures2 = checkWritePermission(testItemsTransferring, ddl, user2);
            expect(failures2).toBe(undefined);

            const testItemsTransferred:TestItem = {
                id: '1',
                owner: user2.getUuid()!
            };

            const failures3 = checkWritePermission(testItemsTransferred, ddl, user2)
            expect(failures3).toBe(undefined);

            // Verify user1 can no longer use it

            const failures4 = checkWritePermission(testItemsTransferred, ddl, user1)
            expect(failures4).toEqual({
                "reason": "not-owner",
                "type": "permission_denied",
              });
        })

        test('Cannot transfer with using transferring_to_path', () => {

            // Give it to another: 
            const testItemsTransferring:TestItem = {
                id: '1',
                owner: user2.getUuid()!
            };

            // Verify user1 can make the change:
            const failures1 = checkWritePermission(testItemsTransferring, ddl, user1);
            expect(failures1).toEqual({
                "reason": "not-owner",
                "type": "permission_denied",
              });

        })
    });
    
    describe('TestItemOwnerArray', () => {
    
        test('Succeeds', () => {

            // Add another to it
            const testItemsWithOwnerArrayTransferring:TestItemOwnerArray = {
                id: '1',
                owners: [user1.getUuid()!, user2.getUuid()!]
            }

            // Verify user1 can make the change:
            const failures1 = checkWritePermission(testItemsWithOwnerArrayTransferring, ddlWithOwnerArray, user1);
            expect(failures1).toBe(undefined);

            // Verify user2 can remove user 1 to complete it
            const testItemsWithOwnerArrayTransferred:TestItemOwnerArray = {
                id: '1',
                owners: [user2.getUuid()!]
            }

            const failures2 = checkWritePermission(testItemsWithOwnerArrayTransferred, ddlWithOwnerArray, user2)
            expect(failures2).toBe(undefined);

            // Verify user1 can no longer use it

            const failures3 = checkWritePermission(testItemsWithOwnerArrayTransferred, ddlWithOwnerArray, user1)
            expect(failures3).toEqual({
                "reason": "not-owner",
                "type": "permission_denied",
              });
        })
    
    
    });
    
})
    

    

    

    

    