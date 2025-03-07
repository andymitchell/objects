import type { WhereFilterDefinition } from "./types.ts"



it('it correctly identifies the available keys, and their type, and there is no type-error because the object property matches the type', () => {

    type NormalType = {name: '2'};

    const a:WhereFilterDefinition<NormalType> = {
        name: '2'
    }

})

it('it correctly identifies the available keys, and their type, but there is a type-error because the object property has the wrong the type', () => {

    type NormalType = {name: '2'};

    const a:WhereFilterDefinition<NormalType> = {
        //name: 1 // OK type error because it's not '2'
    }

})


it('it correctly identifies the available dot prop sub keys, and their type, and there is no type-error because the object property matches the type', () => {

    type NormalType = {name: '2', 'child': {age: number}};

    const a:WhereFilterDefinition<NormalType> = {
        "child.age": 1
    }

})


it('it correctly identifies the available dot prop sub keys, and their type, but there is a type-error because the object property matches the type', () => {

    type NormalType = {name: '2', 'child': {age: number}};

    const a:WhereFilterDefinition<NormalType> = {
        //"child.age": 'abc'  // OK type error because it's not a number
    }

})


it('with a discriminated union, even though a propery is not always present, it should be allowed as a PartialObjectFilter and have the correct type', () => {
    // THIS IS FAILING 

    type DiscrimatedUnion = {name: '1', message: string} | {name: '2'};

    const a:WhereFilterDefinition<DiscrimatedUnion> = {
        message: 'a' // REAL ERROR: It should work because it's a string, but it has error "Type 'string' is not assignable to type 'undefined'.". Because 'message' is only available on some parts of the union, which is causing it to resolve to undefined
    }

})