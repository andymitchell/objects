import { IUser } from "../../auth/types";
import { DDL } from "../types";
import { checkPermission } from "./checkPermission";

type TestItem = {
    id: string, 
    owner: string
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
   owner: 'user1' 
};

const testItemsWithOwnerArray:TestItemOwnerArray = {
    id: '1',
    owners: ['user1']
 };

 const testItemsWithObjectOwnersArray:TestItemOwnerObjectArray = {
    id: '1',
    owners: [{email: 'user1@gmail.com'}]
 };

 const ddl:DDL<TestItem> = {
    version: 1,
    lists: {'.': {primary_key: 'id'}},
    permissions: {
        type: 'owner_id_property',
        path: 'owner',
        format: 'uuid'
    }
 }

 const ddlWithOwnerArray:DDL<TestItemOwnerArray> = {
    version: 1,
    lists: {'.': {primary_key: 'id'}},
    permissions: {
        type: 'owner_id_in_scalar_array',
        path: 'owners',
        format: 'uuid'
    }

 }


 const ddlWithObjectOwnersArray:DDL<TestItemOwnerObjectArray> = {
    version: 1,
    lists: {'.': {primary_key: 'id'}, 'owners': {primary_key: 'email'}},
    permissions: {
        type: 'owner_id_property',
        path: 'owners.email',
        format: 'email'
    },
 }
 

describe('checkPermissions TestItem', () => {

    test('checkPermissions TestItem success', () => {
        const failures = checkPermission(testItems, ddl, user1);
        expect(failures).toBe(undefined);
    })

    test('checkPermissions TestItem fail', () => {
        const failures = checkPermission(testItems, ddl, user2);
        expect(!!failures).toBe(true);
    })

    test('TestItem path is undefined', () => {
        // @ts-ignore breaking for test
        const failures = checkPermission({}, ddl, user1);
        expect(!!failures).toBe(true);
    });

    test('TestItem path is array', () => {
        // @ts-ignore breaking for test
        const failures = checkPermission({owner: ['user1']}, ddl, user1);
        expect(!!failures).toBe(true);
    });

    test('TestItem path empty user', () => {
        const failures = checkPermission(testItems, ddl, userEmpty);
        expect(!!failures).toBe(true);
    });

    test('TestItem invalid ddl', () => {
        const ddl2 = structuredClone(ddl);
        // @ts-ignore breaking for test
        ddl2.permissions = {};
        
        const failures = checkPermission(testItems, ddl2, user1);
        expect(!!failures).toBe(true);
    });
});

describe('checkPermissions TestItemOwnerArray', () => {

    test('checkPermissions TestItemOwnerArray success', () => {
        const failures = checkPermission(testItemsWithOwnerArray, ddlWithOwnerArray, user1)
        expect(failures).toBe(undefined);
    })

    test('checkPermissions TestItemOwnerArray fail', () => {
        const failures = checkPermission(testItemsWithOwnerArray, ddlWithOwnerArray, user2);
        expect(!!failures).toBe(true);
    })

    test('TestItemOwnerArray path is undefined', () => {
        // @ts-ignore breaking for test
        const failures = checkPermission({}, ddlWithOwnerArray, user1)
        expect(!!failures).toBe(true);
    });

    test('TestItemOwnerArray path is not array', () => {
        // @ts-ignore breaking for test
        const failures = checkPermission({owner: 'user1'}, ddlWithOwnerArray, user1)
        expect(!!failures).toBe(true);
    });


    test('TestItem path empty user', () => {
        
        const failures = checkPermission(testItemsWithOwnerArray, ddlWithOwnerArray, userEmpty);
        expect(!!failures).toBe(true);
    });

});

describe('checkPermissions TestItemOwnerObjectArray', () => {
    test('checkPermissions TestItemOwnerObjectArray success', () => {
        const failures = checkPermission(testItemsWithObjectOwnersArray, ddlWithObjectOwnersArray, user1);
        expect(failures).toBe(undefined);
    })

    test('checkPermissions TestItemOwnerObjectArray fail', () => {
        const failures = checkPermission(testItemsWithObjectOwnersArray, ddlWithObjectOwnersArray, user2);
        expect(!!failures).toBe(true);
    })

    test('TestItemOwnerObjectArray path is undefined', () => {
        // @ts-ignore breaking for test
        const failures = checkPermission({}, ddlWithObjectOwnersArray, user1);
        expect(!!failures).toBe(true);
    });

    test('TestItemObjectOwnersArray path is not array', () => {
        // @ts-ignore breaking for test
        const failures = checkPermission({owner: 'user1'}, ddlWithObjectOwnersArray, user1);
        expect(!!failures).toBe(true);
    });


    test('TestItem path empty user', () => {
        const failures = checkPermission(testItemsWithObjectOwnersArray, ddlWithObjectOwnersArray, userEmpty);
        expect(!!failures).toBe(true);
    });


});

    

    

    
    

    

    

    

    

    

    