import isPlainObject from "./isPlainObject";
import { isPlainObject as isPlainObjectLodash } from "lodash-es";

describe('isPlainObject', () => {
    
    test('object succeeds', () => {
        expect(isPlainObject({id: 1})).toBe(true);     
    });

    test('string fails', () => {
        expect(isPlainObject('not an object')).toBe(false);
    });


    test('array fails', () => {
        expect(isPlainObject([])).toBe(false);
    });


    test('bool fails', () => {
        expect(isPlainObject(true)).toBe(false);
    });


    test('function fails', () => {
        expect(isPlainObject(() => true)).toBe(false);
    });


    test('date fails', () => {
        expect(isPlainObject(new Date())).toBe(false);
    });


    test('custom class fails', () => {
        class MyClass {};
        expect(isPlainObject(new MyClass())).toBe(false);
    });

    test('null fails', () => {
        expect(isPlainObject(null)).toBe(false);
    });

    test('undefined fails', () => {
        expect(isPlainObject(null)).toBe(false);
    });

    test('messed up prototype chain fails', () => {
        expect(isPlainObject(Object.create(Array.prototype))).toBe(false);
    });

    test('object with function succeeds', () => {
        expect(isPlainObject({f: ():null => null})).toBe(true);
    });

    test('lodash parity: object with function succeeds', () => {
        expect(isPlainObjectLodash({f: ():null => null})).toBe(true);
    });

    test('structuredClone succeeds', () => {
        expect(isPlainObject(structuredClone({id: 1}))).toBe(true);
    });

    test('proxy succeeds', () => {
        expect(isPlainObject(new Proxy({}, {}))).toBe(true);
    });

    test('lodash parity: structuredClone succeeds', () => {
        expect(isPlainObjectLodash(structuredClone({id: 1}))).toBe(true);
    });


    test('lodash parity: messed up prototype chain fails', () => {
        expect(isPlainObjectLodash(Object.create(Array.prototype))).toBe(false);
    });

    test('lodash parity: proxy succeeds', () => {
        expect(isPlainObjectLodash(new Proxy({}, {}))).toBe(true);
    });
});