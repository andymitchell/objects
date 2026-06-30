import { createDraft } from "immer";
import { z } from "zod";
import matchJavascriptObjectReal, { compileMatchJavascriptObject, type ObjOrDraft } from "./matchJavascriptObject.js";
import { type WhereFilterDefinition } from "./types.js";
import { standardTests } from "./standardTests.js";


async function matchJavascriptObject<T extends Record<string, any>>(object: ObjOrDraft<T>, filter: WhereFilterDefinition<T>):Promise<ReturnType<typeof matchJavascriptObjectReal>> {
    const result = matchJavascriptObjectReal(object, filter);
    return result;
}



describe('testMatchJavascriptObject', () => {
    
    standardTests({
        test,
        expect,
        matchJavascriptObject,
        implementationName: 'javascript'
    })


    test('compiling', () => {
        const customMatchJavascriptObject = compileMatchJavascriptObject({age: {$gte: 18}} as const);

        expect(customMatchJavascriptObject({age: 18})).toBe(true);
        expect(customMatchJavascriptObject({age: 17})).toBe(false);

        expect(customMatchJavascriptObject({veryDifferentStructure: true})).toBe(false);
    })

    test('Immer - Match name', async () => {

        const obj = {
            contact: {
                name: 'Andy',
                emailAddress: 'andy@andy.com'
            }
        };

        const draft = createDraft(obj);
        const result = await matchJavascriptObject(
            draft,
            {
                'contact.name': 'Andy'
            }
        )

        expect(result).toBe(true);
    });

    describe('universalSchemaConformance — holds the value-driven matcher to the schema-driven SQL contract', () => {
        const ScalarOwner = z.object({ id: z.string(), owner: z.string() });
        const AmbiguousOwner = z.object({ id: z.string(), owner: z.union([z.string(), z.array(z.string())]) });

        test('without the option, the matcher duck-types an array under a scalar filter (the divergence it guards)', () => {
            expect(matchJavascriptObjectReal({ id: '1', owner: ['alice', 'bob'] }, { owner: 'alice' })).toBe(true);
        });

        test('rejects a shape-ambiguous (scalar | array) schema, even when the object itself is fine', () => {
            expect(() =>
                matchJavascriptObjectReal({ id: '1', owner: 'alice' }, { owner: 'alice' }, { universalSchemaConformance: { schema: AmbiguousOwner } }),
            ).toThrow(/shape-ambiguous/i);
        });

        test('rejects an object that does not conform to the schema (array under a scalar-declared field)', () => {
            expect(() =>
                // @ts-expect-error — array data deliberately violates the scalar schema; the type system rejects it at compile time, the runtime must reject it too
                matchJavascriptObjectReal({ id: '1', owner: ['alice', 'bob'] }, { owner: 'alice' }, { universalSchemaConformance: { schema: ScalarOwner } }),
            ).toThrow(/does not conform/i);
        });

        test('matches a conforming object exactly as the default matcher would', () => {
            expect(matchJavascriptObjectReal({ id: '1', owner: 'alice' }, { owner: 'alice' }, { universalSchemaConformance: { schema: ScalarOwner } })).toBe(true);
            expect(matchJavascriptObjectReal({ id: '1', owner: 'bob' }, { owner: 'alice' }, { universalSchemaConformance: { schema: ScalarOwner } })).toBe(false);
        });

        test('objectValidatedAgainstSchema:true bypasses per-object validation (duck-types again) but still rejects an ambiguous schema', () => {
            // Bypass: the non-conforming array object is no longer rejected — it duck-types like the default.
            expect(
                // @ts-expect-error — array data deliberately violates the scalar schema; the bypass skips validation so it duck-types rather than being rejected
                matchJavascriptObjectReal({ id: '1', owner: ['alice', 'bob'] }, { owner: 'alice' }, { universalSchemaConformance: { schema: ScalarOwner, objectValidatedAgainstSchema: true } }),
            ).toBe(true);
            // But the schema-ambiguity check always runs, bypass or not.
            expect(() =>
                matchJavascriptObjectReal({ id: '1', owner: 'alice' }, { owner: 'alice' }, { universalSchemaConformance: { schema: AmbiguousOwner, objectValidatedAgainstSchema: true } }),
            ).toThrow(/shape-ambiguous/i);
        });

        const CoerceNumber = z.object({ id: z.string(), n: z.coerce.number() });
        const TransformField = z.object({ id: z.string(), s: z.string().transform((v) => v.length) });

        test('rejects a value-normalizing (z.coerce.*) schema, even when the object itself is fine', () => {
            // The matcher compares the ORIGINAL value; coerce would let the stored string '1' pass against 1, which
            // a ::numeric cast also matches but the matcher's strict === does not — so the schema is unrepresentable.
            expect(() =>
                matchJavascriptObjectReal({ id: '1', n: 1 }, { n: 1 }, { universalSchemaConformance: { schema: CoerceNumber } }),
            ).toThrow(/value-normalizing/i);
        });

        test('rejects a value-normalizing (.transform()) schema', () => {
            expect(() =>
                // @ts-expect-error — the transformed output type differs from the input; the filter shape is irrelevant because the schema is rejected first
                matchJavascriptObjectReal({ id: '1', s: 'abc' }, { s: 3 }, { universalSchemaConformance: { schema: TransformField } }),
            ).toThrow(/value-normalizing/i);
        });

        test('the value-normalization check always runs, even under the objectValidatedAgainstSchema bypass', () => {
            expect(() =>
                matchJavascriptObjectReal({ id: '1', n: 1 }, { n: 1 }, { universalSchemaConformance: { schema: CoerceNumber, objectValidatedAgainstSchema: true } }),
            ).toThrow(/value-normalizing/i);
        });
    });

})




    /*
    TODO
    test('Match nested array', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    addresses: [
                        {
                            city: 'York'
                        }
                        , 
                        {
                            city: 'London'
                        }]
                }
            },
            {
                'contact.addresses': {
                    array_contains: ''
                }
            }
        )).toBe(true);
    });
    */

    /*
    test('Do not match as array does not contain Houston', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    addresses: ['York', 'London']
                }
            },
            {
                'contact.addresses': {
                    array_contains: 'Houston'
                }
            }
        )).toBe(false);
    });
    */