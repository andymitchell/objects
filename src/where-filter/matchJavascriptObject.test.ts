import { createDraft } from "immer";
import { z } from "zod";
import matchJavascriptObjectReal, { compileMatchJavascriptObject, filterJavascriptObjects, type ObjOrDraft } from "./matchJavascriptObject.js";
import { type WhereFilterDefinition } from "./types.js";
import { standardTests, AcknowledgementCollector, assertNoCapabilityDrift } from "./standardTests.js";
import { JS_MANIFEST } from "./standard-tests/manifests/js.manifest.ts";
import { registerSecondaryOracleProperty } from "./standard-tests/mingo/index.ts";


async function matchJavascriptObject<T extends Record<string, any>>(object: ObjOrDraft<T>, filter: WhereFilterDefinition<T>):Promise<ReturnType<typeof matchJavascriptObjectReal>> {
    const result = matchJavascriptObjectReal(object, filter);
    return result;
}



describe('testMatchJavascriptObject', () => {

    const acknowledgements = new AcknowledgementCollector();

    standardTests({
        test,
        expect,
        matchJavascriptObject,
        implementationName: 'javascript',
        fuzz: { iterations: 300, secondaryOracle: registerSecondaryOracleProperty },
        acknowledgements,
    })

    test('capability manifest — the reference acknowledges no seam', () => {
        assertNoCapabilityDrift(acknowledgements, JS_MANIFEST, expect);
    });


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

/**
 * The same reference matcher, reached through `compileMatchJavascriptObject`.
 *
 * Compiling understands the filter once and hands back a predicate, so running the whole battery through it is a
 * differential: every verdict the direct matcher gives, the compiled one must give too — across all 27 sections
 * and the seeded fuzz, not just the handful of filters anyone would think to write by hand here.
 */
async function matchJavascriptObjectCompiled<T extends Record<string, any>>(object: ObjOrDraft<T>, filter: WhereFilterDefinition<T>): Promise<boolean> {
    return compileMatchJavascriptObject<T>(filter)(object);
}

describe('testMatchJavascriptObject — reached through the compiled matcher', () => {

    const acknowledgements = new AcknowledgementCollector();

    standardTests({
        test,
        expect,
        matchJavascriptObject: matchJavascriptObjectCompiled,
        implementationName: 'javascript-compiled',
        // The secondary oracle is deliberately absent. It checks the reference against an independent
        // implementation of the query language, which the direct run above already does; repeating it here would
        // say nothing about compiling. The seeded fuzz itself stays, because it reaches filters no hand-written
        // case would.
        fuzz: { iterations: 300 },
        acknowledgements,
    })

    test('capability manifest — compiling introduces no seam of its own', () => {
        assertNoCapabilityDrift(acknowledgements, JS_MANIFEST, expect);
    });
});

describe('compileMatchJavascriptObject — understands the filter once, then answers about many objects', () => {

    test('refuses a malformed filter as it compiles, before any object has been supplied', () => {
        expect(() =>
            // @ts-expect-error — undefined is not a filter; the type system rejects it, and so must the runtime
            compileMatchJavascriptObject(undefined),
        ).toThrow('filter was not well-defined');
    });

    test('the compiled predicate still refuses a non-plain object, which no filter can rule on in advance', () => {
        const isAdult = compileMatchJavascriptObject<{ age: number }>({ age: { $gte: 18 } });
        // @ts-expect-error — a string is not a plain object; the type system rejects it, and so must the runtime
        expect(() => isAdult('nineteen')).toThrow('requires plain object');
    });

    describe('universalSchemaConformance — the schema is settled at compile, the object at each call', () => {
        const ScalarOwner = z.object({ id: z.string(), owner: z.string() });
        const AmbiguousOwner = z.object({ id: z.string(), owner: z.union([z.string(), z.array(z.string())]) });
        const CoerceNumber = z.object({ id: z.string(), n: z.coerce.number() });

        test('a conforming object matches exactly as the direct matcher would', () => {
            const ownedByAlice = compileMatchJavascriptObject<z.infer<typeof ScalarOwner>>({ owner: 'alice' }, { universalSchemaConformance: { schema: ScalarOwner } });
            expect(ownedByAlice({ id: '1', owner: 'alice' })).toBe(true);
            expect(ownedByAlice({ id: '2', owner: 'bob' })).toBe(false);
        });

        test('rejects a shape-ambiguous (scalar | array) schema as it compiles — no object could redeem it', () => {
            expect(() =>
                compileMatchJavascriptObject<z.infer<typeof AmbiguousOwner>>({ owner: 'alice' }, { universalSchemaConformance: { schema: AmbiguousOwner } }),
            ).toThrow(/shape-ambiguous/i);
        });

        test('rejects a value-normalizing (z.coerce.*) schema as it compiles', () => {
            expect(() =>
                compileMatchJavascriptObject<z.infer<typeof CoerceNumber>>({ n: 1 }, { universalSchemaConformance: { schema: CoerceNumber } }),
            ).toThrow(/value-normalizing/i);
        });

        test('refuses a non-conforming object per call — conformance is a property of the object, not the filter', () => {
            const ownedByAlice = compileMatchJavascriptObject<z.infer<typeof ScalarOwner>>({ owner: 'alice' }, { universalSchemaConformance: { schema: ScalarOwner } });
            // @ts-expect-error — array data deliberately violates the scalar schema; the runtime must reject it too
            expect(() => ownedByAlice({ id: '1', owner: ['alice', 'bob'] })).toThrow(/does not conform/i);
        });

        test('objectValidatedAgainstSchema:true skips the per-object check, so the compiled predicate duck-types again', () => {
            const ownedByAlice = compileMatchJavascriptObject<z.infer<typeof ScalarOwner>>({ owner: 'alice' }, { universalSchemaConformance: { schema: ScalarOwner, objectValidatedAgainstSchema: true } });
            // @ts-expect-error — array data deliberately violates the scalar schema; the bypass skips validation, so it duck-types rather than being rejected
            expect(ownedByAlice({ id: '1', owner: ['alice', 'bob'] })).toBe(true);
        });
    });
});

describe('filterJavascriptObjects — keeps the objects a filter matches', () => {

    test('keeps only the matching objects, in the order they were given', () => {
        const users = [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 16 }, { name: 'Cara', age: 44 }];

        expect(filterJavascriptObjects(users, { age: { $gte: 18 } })).toEqual([{ name: 'Alice', age: 30 }, { name: 'Cara', age: 44 }]);
    });

    test('refuses a malformed filter even when there is nothing to filter', () => {
        expect(() =>
            // @ts-expect-error — undefined is not a filter; the type system rejects it, and so must the runtime
            filterJavascriptObjects([], undefined),
        ).toThrow('filter was not well-defined');
    });
});

describe('inherited-name paths never match, at both the primary read and the array-spreading fallback', () => {
    // Both readers must agree an inherited member is absent: if only the primary read treated it as
    // missing, the array-spreading fallback would resolve the Object.prototype member and rebuild the
    // same filter as an $or, recursing without end.
    const match = (row: Record<string, any>, filter: unknown) =>
        matchJavascriptObjectReal(row, filter as WhereFilterDefinition<Record<string, any>>);

    test('$exists:true is false for an inherited member, top-level and nested', () => {
        const row = { data: { foo: { value: 'v' } } };
        for (const name of ['toString', 'valueOf', 'hasOwnProperty']) {
            expect(match(row, { [name]: { $exists: true } })).toBe(false);
            expect(match(row, { [`data.foo.${name}`]: { $exists: true } })).toBe(false);
        }
    });

    test('$exists:true is true for an own key spelling an inherited name', () => {
        expect(match({ data: { foo: { toString: 'v' } } }, { 'data.foo.toString': { $exists: true } })).toBe(true);
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