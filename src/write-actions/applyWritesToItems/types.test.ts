import type { DotPropPathToObjectArraySpreadingArrays } from "../../dot-prop-paths/types.js";
import type { DDL } from "./types.js";


describe('write-actions type check', () => {
    // This is just a type file for convenience to see if typeCheck's code flags type errors
    test('empty', () => {
        expect(true).toBe(true);
    })
})

function typeCheck() {
    type Obj = {
        id: string,
        text?: string,
        children?: {cid: string, children: {ccid: string, children: {cccid: string}[]}[], wrong: string[]}[],
        other: string[]
    }

    const ddl:DDL<Obj> = {
        version: 1, 
        lists: {
            '.': {
                primary_key: 'id',
                order_by: {key: 'id'}
            },
            'children': {
                primary_key: 'cid',
                order_by: {key: 'cid'}
            },
            'children.children': {
                primary_key: 'ccid',
                order_by: {key: 'ccid'}
            },
            'children.children.children': {
                primary_key: 'cccid',
                order_by: {key: 'cccid'}
            }
        },
        permissions: {
            type: 'none'
        }
    }

    const a:DotPropPathToObjectArraySpreadingArrays<Obj> = 'children';
    const b:DotPropPathToObjectArraySpreadingArrays<Obj> = 'children.children';

    //const c:DotPropPathToObjectArraySpreadingArrays<Obj> = 'children.children';


    const typeCheck1:DDL<any> = {
        version: 1,
        lists: {
            '.': {
                primary_key: 'whatever',
                order_by: {key: 'whatever'}
            }
        },
        permissions: {
            type: 'none'
        }
    }

    const typeCheck2:DDL<{id: string/*, friends: {fid: string}[]*/}> = {
        version: 1,
        lists: {
            '.': {
                
                primary_key: 'id',
                order_by: {key: 'id'}
            }
        },
        permissions: {
            type: 'none'
        }
    }   
}