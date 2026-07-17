import { getProperty, getPropertySpreadingArrays } from "../dot-prop-paths/getPropertySimpleDot.js";
import isPlainObject from "../utils/isPlainObject.js";
import { findShapeAmbiguousPaths } from "../dot-prop-paths/shape-ambiguity.ts";
import { findNormalizingPaths } from "../dot-prop-paths/schema-normalization.ts";
import type { MatchJavascriptObject, MatchJavascriptObjectOptions, MatchJavascriptObjectWithFilter, ObjOrDraft, UniversalSchemaConformance, WhereFilterDefinition } from "./types.js";
import { isWhereFilterDefinition } from "./schemas.ts";
import { isLogicFilter } from "./typeguards.ts";
import { evaluatePredicate, negationCore, parseFieldPredicate, partitionNegations } from "./ast/index.ts";
import type { Predicate, SubFilterMatcher } from "./ast/index.ts";
import { safeJson } from "./safeJson.ts";
// TODO Optimise: isPlainObject is still expensive, and used in compareValue/etc. But if the top function (matchJavascriptObject) checks object, then all children can assume to be plain object too, avoiding the need for the test. Just check the assumption that isPlainObject does indeed check all children.

/*

# This is largely inspired by Mongo. 

## If multiple criteria are on a filter it's a $and...
e.g. {name: 'Bob', age: 1}, it implicitly infers its a $and across the criteria. 

## It gets a little hard to think about around arrays. 
Use $elemMatch on an array search to define the characteristics that must be found under one element. Otherwise, it does a compound search that accepts multiple elements fulfilling the criteria.
E.g. for an array 'children' [{name: 'Bob', age: 20}, name: 'Alice', age: 1], and filter {'children': {name: 'Bob', age: 1}}, it would pass.
But if you used {'children': {$elemMatch: {name: 'Bob', age: 1}}}, then it would fail.

This is counter-intuitive partly because the normal behaviour for multiple criteria is to use $and, except in compound filters.

If you use $and/$or/$nor in your compound filters, they behave atomically on each element, equivelent to $elemMatch.

## Spreading arrays will use a generous $or
E.g. suppose you have {children: {grandchildren: {name: string}[]}[]}. I.e. arrays as elements of parent arrays. 
A criteria of {'children.grandchildren': {name: 'Bob'}} is valid. It'll analyse each leaf array (in this case, potentially multiple 'grandchildren' arrays). But the compound filter must pass within the context of one array. 

*/

export type { ObjOrDraft };

// ─── Entry gates ───
// Each gate refuses one class of bad input, and each is grouped by what it depends on: the filter, the schema,
// or the object. That split is what lets a matcher be compiled — the filter and schema gates can run as soon as
// those are known, while the object gates can only ever run per object. Both entry points share these, so a
// refusal reads the same wherever it is met.

/** Refuse a filter outside the query language. Depends on the filter alone. */
function assertFilterIsWellDefined(filter: unknown): void {
    if( !isWhereFilterDefinition(filter) ) {
        throw new Error("matchJavascriptObject filter was not well-defined. Received: "+safeJson(filter));
    }
}

/**
 * Refuse a schema the schema-driven SQL contract cannot represent. Depends on the schema alone.
 *
 * A scalar|array schema is unrepresentable downstream. A value-normalizing schema (coerce/transform/pipe) is
 * matched here against the ORIGINAL value while a schema-driven backend casts, so the two would disagree even on
 * conforming data. Reject both up-front, consistent with the matcher already throwing on invalid input.
 */
function assertSchemaIsRepresentable(conformance: UniversalSchemaConformance<any>): void {
    const ambiguous = findShapeAmbiguousPaths(conformance.schema);
    if( ambiguous.length>0 ) {
        throw new Error(`matchJavascriptObject: universalSchemaConformance rejects a shape-ambiguous schema (a schema-driven backend cannot represent a scalar|array field): ${ambiguous.map(a => a.dotprop_path).join(', ')}`);
    }
    const normalizing = findNormalizingPaths(conformance.schema);
    if( normalizing.length>0 ) {
        throw new Error(`matchJavascriptObject: universalSchemaConformance rejects a value-normalizing schema (a schema-driven backend compares the raw stored value, not the coerced/transformed one): ${normalizing.map(n => n.dotprop_path).join(', ')}`);
    }
}

/** Refuse anything but a plain object. Depends on the object alone. */
function assertIsPlainObject(object: unknown): void {
    if( !isPlainObject(object) ) {
        let json: string = process.env.NODE_ENV==='test'? safeJson(object) : 'redacted';
        throw new Error("matchJavascriptObject requires plain object. Received: "+json);
    }
}

/**
 * Refuse an object the schema does not describe. Depends on the object (and the schema).
 *
 * Non-conforming data would be duck-typed to a result a schema-driven backend cannot reproduce.
 * `objectValidatedAgainstSchema` asserts the caller has already checked, and skips it as a perf bypass.
 */
function assertObjectConformsToSchema(object: unknown, conformance: UniversalSchemaConformance<any>): void {
    if( !conformance.objectValidatedAgainstSchema && !conformance.schema.safeParse(object).success ) {
        throw new Error("matchJavascriptObject: object does not conform to the universalSchemaConformance schema");
    }
}

/**
 * Checks whether a single plain JavaScript object matches a Mongo-style `WhereFilterDefinition`.
 *
 * This is where-filter's in-memory matcher — the JS evaluator of the same query language its SQL emitters
 * (`prepareWhereClause`) compile, so one filter can run client-side here or as SQL. Like MongoDB it is
 * value-driven and duck-types: `{owner:'a'}` also matches a row whose `owner` is `['a','b']` (array
 * containment), and `$in` matches an array by intersection. Throws if `object` is not a plain object.
 *
 * @remarks
 * **Universal schema conformance (optional).** Pass `universalSchemaConformance: { schema }` to make this
 * matcher behave like the schema-driven SQL emitter — the lowest-common-denominator contract across
 * where-filter backends. The default value-driven matcher and the schema-driven SQL emitter agree only when
 * data conforms to a concrete schema; they diverge on non-conforming data — e.g. a row `{ owner: ['a','b'] }`
 * where the schema declares `owner: z.string()`, which the value-driven matcher accepts by array containment
 * but SQL (bound to a scalar column) does not — or on a shape-ambiguous schema such as
 * `owner: z.union([z.string(), z.array(z.string())])` (`string | array`). They also diverge on a value-normalizing
 * schema such as `z.coerce.number()`, which accepts the stored string `'1'` the matcher's strict `===` rejects but a
 * `::numeric` cast matches. This mode closes the gap by throwing on a shape-ambiguous or value-normalizing leaf
 * (unrepresentable in SQL) and validating the object against the schema first (throwing if it does not conform);
 * `objectValidatedAgainstSchema: true` skips the per-object check as a perf bypass (the schema-shape checks always run).
 *
 * @param object  The object to test. Must be a plain object.
 * @param filter  The `WhereFilterDefinition` describing the match criteria.
 * @param options Optional; see `universalSchemaConformance` above.
 * @returns `true` if the object matches the filter, `false` otherwise.
 * @throws If `object` is not a plain object, the filter is malformed, or — in conformance mode — the schema is
 *   shape-ambiguous or value-normalizing, or the object does not conform to it.
 *
 * @example
 * matchJavascriptObject({ name: 'Alice', age: 30 }, { age: { $gte: 18 } });   // true
 * matchJavascriptObject({ owner: ['alice', 'bob'] }, { owner: 'alice' });      // true (array containment)
 * matchJavascriptObject({ age: 30 }, { age: { $gte: 18, $lt: 65 } });         // true (several operators on one field are ANDed)
 *
 * @example
 * // Universal schema conformance — behaves like the SQL backend, refusing to duck-type non-conforming data.
 * const schema = z.object({ id: z.string(), owner: z.string() });
 * matchJavascriptObject({ owner: ['a','b'] }, { owner: 'a' }, { universalSchemaConformance: { schema } }); // throws — array under a scalar field
 */
const matchJavascriptObject:MatchJavascriptObjectWithFilter = <T extends Record<string, any> = Record<string, any>, F extends Record<string, any> = T>(object:ObjOrDraft<T>, filter:WhereFilterDefinition<F>, options?:MatchJavascriptObjectOptions<T>):boolean => {
    // The gate order is part of this function's contract: a bad object is reported ahead of a bad filter, a bad
    // filter ahead of an unrepresentable schema, and that ahead of a non-conforming object. Keep the sequence.
    assertIsPlainObject(object);
    assertFilterIsWellDefined(filter);

    const conformance = options?.universalSchemaConformance;
    if( conformance ) {
        assertSchemaIsRepresentable(conformance);
        assertObjectConformsToSchema(object, conformance);
    }

    return _matchJavascriptObject(object, filter, [filter]);

}
export default matchJavascriptObject;



/**
 * Compiles a reusable predicate from a filter definition, ready to test many objects against it.
 *
 * 101: a `WhereFilterDefinition` is data, not code — before it can answer anything about an object, it has to be
 * understood. That work depends only on the filter, so compiling does it once here instead of on every object.
 * The predicate handed back then does only what genuinely varies: reading the object and comparing values.
 *
 * Prefer this to {@link matchJavascriptObject} whenever one filter meets more than one object — filtering an
 * array, answering a query row by row. For a single object the two are equivalent.
 *
 * @param filter The filter definition describing the match criteria.
 * @param options Optional; see `universalSchemaConformance` on {@link matchJavascriptObject}. The schema's own
 *   checks belong to compiling; whether an OBJECT conforms is settled per call, since only the object answers that.
 * @returns A predicate reporting whether an object matches the filter. It throws if the object is not a plain
 *   object, or — in conformance mode — does not conform to the schema.
 * @throws If the filter is malformed, or — in conformance mode — the schema is shape-ambiguous or
 *   value-normalizing. These are faults in the arguments supplied here, so they surface here rather than being
 *   deferred to whichever object happens to arrive first.
 *
 * @example
 * const isAdult = compileMatchJavascriptObject({ age: { $gte: 18 } });
 *
 * isAdult({ name: 'Alice', age: 30 }); // true
 * isAdult({ name: 'Bob', age: 15 });   // false
 */
export const compileMatchJavascriptObject = <T extends Record<string, any>, F extends Record<string, any> = T>(filter:WhereFilterDefinition<F>, options?:MatchJavascriptObjectOptions<T>):MatchJavascriptObject<T> => {
    assertFilterIsWellDefined(filter);

    const conformance = options?.universalSchemaConformance;
    if( conformance ) assertSchemaIsRepresentable(conformance);

    return (object:ObjOrDraft<T>) => {
        assertIsPlainObject(object);
        if( conformance ) assertObjectConformsToSchema(object, conformance);

        return _matchJavascriptObject(object, filter, [filter]);
    }
}


/**
 * Filters an array of JavaScript objects, returning only those that match the given filter.
 *
 * The filter is compiled once and applied to every element, so the cost of understanding it is paid once for the
 * whole array rather than once per object.
 *
 * @param objects An array of plain JavaScript objects to filter.
 * @param filter The filter definition used to test each object.
 * @returns A new array holding only the matching objects, in their original order.
 * @throws If the filter is malformed — including for an empty array, where no object would surface the fault —
 *   or if any object is not a plain object.
 *
 * @example
 * const users = [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 16 }];
 * const filter = { age: { $gte: 18 } };
 * filterJavascriptObjects(users, filter); // [{ name: 'Alice', age: 30 }]
 */
export function filterJavascriptObjects<T extends {} = {}, F extends Record<string, any> = T extends Record<string, any> ? T : Record<string, any>>(objects:ObjOrDraft<T>[], filter:WhereFilterDefinition<F>):ObjOrDraft<T>[] {
    return objects.filter(compileMatchJavascriptObject<T, F>(filter));
}


function _matchJavascriptObject<T extends Record<string, any> = Record<string, any>>(object:ObjOrDraft<T>, filter:WhereFilterDefinition, debugPath:WhereFilterDefinition[]):boolean {
    
    
    const keys = Object.keys(filter) as Array<keyof typeof filter>;
    if( keys.length===0 ) {
        // If there are no keys on the filter, there is no filter. Therefore return all. 
        return true;
        
    } else if( keys.length>1 ) {
        // If there's more than 1 key on the filter, split it formally into a $and
        filter = {
            $and: keys.map(key => ({[key]: filter[key]}))
        }
    }

    if( isLogicFilter(filter) ) {
        // Treat it as recursive
        const subMatcher = (subFilter:WhereFilterDefinition) => _matchJavascriptObject(object, subFilter, [...debugPath, subFilter]);
        const passOr = !Array.isArray(filter.$or) || filter.$or.some(subMatcher);
        const passAnd = !Array.isArray(filter.$and) || filter.$and.every(subMatcher);
        const passNor = !Array.isArray(filter.$nor) || !filter.$nor.some(subMatcher);
        return passOr && passAnd && passNor;
    } else {
        // Test a single dotprop 

        const dotpropKey = Object.keys(filter)[0];
        if( !dotpropKey ) return false;
        let objectValue = getProperty(object, dotpropKey, true);
        const dotpropFilter = filter[dotpropKey];
        if( objectValue===undefined ) {
            // It's possible that it's an array nested under an array (spreading), so needs to be broken down to test every combination
            const spreadArrays = getPropertySpreadingArrays(object, dotpropKey);
            if( spreadArrays && spreadArrays.length && !(spreadArrays.length===1 && spreadArrays[0]!.value===undefined) ) {
                const leafMatchSubFilter = (element: Record<string, unknown>, subFilter: WhereFilterDefinition): boolean =>
                    _matchJavascriptObject(element, subFilter, [...debugPath, subFilter]);
                const predicate = parseFieldPredicate(dotpropFilter);
                // An element the path does not reach carries no value, so it offers nothing to test — the spread
                // reports it with an empty path. Reaching NO value at all is exactly a missing field, and the
                // condition's own verdict on one decides, just as it would for a path that spreads no arrays.
                const leaves = spreadArrays.filter(x => x.path!=='').map(x => x.value);
                return leaves.length===0
                    ? evaluatePredicate(undefined, predicate, leafMatchSubFilter)
                    : matchPredicateOverLeaves(leaves, predicate, leafMatchSubFilter);
            }
        }

        // The field condition means one thing, which the shared predicate tree states once; this matcher only
        // supplies the value and the way to recurse into a sub-filter.
        const matchSubFilter = (element: Record<string, unknown>, subFilter: WhereFilterDefinition): boolean =>
            _matchJavascriptObject(element, subFilter, [...debugPath, subFilter]);
        return evaluatePredicate(objectValue, parseFieldPredicate(dotpropFilter), matchSubFilter);
    }


}

/**
 * Answer a field condition against every leaf a path reaching through an array arrives at.
 *
 * A positive condition holds when SOME leaf satisfies it — and where several positive operators sit together,
 * when some single leaf satisfies them ALL. That leaf scope is deliberate: it stops a compound condition being
 * answered by pooling two different leaves (`MONGO-DIVERGENCES.md`).
 *
 * A negation cannot join that fold, because it denies the whole path rather than one leaf. So it is lifted out
 * and applied to the positive condition it wraps — see {@link negationCore}, which every engine shares.
 *
 * @param leaves - The value at each leaf the path reached.
 * @param predicate - The parsed field condition.
 * @param matchSubFilter - Applies a sub-filter to an object element of an array.
 * @returns Whether the path, taken as a whole, satisfies the condition.
 *
 * @example
 * // {items: [{k: 'a'}, {k: 'b'}]} under {'items.k': {$ne: 'b'}}
 * // → the negation asks whether SOME leaf equals 'b'. One does, so the document does not match.
 *
 * @remarks
 * A negation recurses through this same function rather than through a single leaf, which is what lets negations
 * nest: `{$not: {$ne: 'b'}}` unwinds to "some leaf equals 'b'".
 */
function matchPredicateOverLeaves(leaves: readonly unknown[], predicate: Predicate, matchSubFilter: SubFilterMatcher): boolean {
    const core = negationCore(predicate);
    if (core) return !matchPredicateOverLeaves(leaves, core, matchSubFilter);

    const { positive, negations } = partitionNegations(predicate);
    const someLeafSatisfies = positive === undefined
        || leaves.some(leaf => evaluatePredicate(leaf, positive, matchSubFilter));

    return someLeafSatisfies
        && negations.every(negation => matchPredicateOverLeaves(leaves, negation, matchSubFilter));
}
