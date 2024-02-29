import { DotPropPathToObjectArraySpreadingArrays } from "../../dot-prop-paths/types";
import { DDL } from "./types";


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
        '.': {
            version: 1,
            primary_key: 'id'
        },
        'children': {
            version: 1,
            primary_key: 'cid',
        },
        'children.children': {
            version: 1,
            primary_key: 'ccid'
        },
        'children.children.children': {
            version: 1,
            primary_key: 'cccid'
        }
    }

    const a:DotPropPathToObjectArraySpreadingArrays<Obj> = 'children';
    const b:DotPropPathToObjectArraySpreadingArrays<Obj> = 'children.children';

    //const c:DotPropPathToObjectArraySpreadingArrays<Obj> = 'children.children';


    const typeCheck1:DDL<any> = {
        '.': {
            version: 1,
            primary_key: 'whatever'
        }
    }

    const typeCheck2:DDL<{id: string/*, friends: {fid: string}[]*/}> = {
        '.': {
            version: 1,
            primary_key: 'id'
        }
    }   
}