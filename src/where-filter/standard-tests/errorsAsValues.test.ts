import matchJavascriptObjectReference from "../matchJavascriptObject.ts";
import type { MatchJavascriptObjectInTesting } from "./harness.ts";
import { standardTests } from "./index.ts";

/**
 * The fourth conformance consumer: the JS reference matcher wrapped as an ERRORS-AS-VALUES seam — a
 * malformed/contradictory filter surfaces as a resolved `undefined` instead of a throw.
 *
 * Why it exists: the `errorsAsValues` contract had zero coverage. It is the seam a store built on
 * `safeParse`-style validation would inject, and it must be held to the SAME "never a silent match" bar as
 * the throwing path — the malformed cases then demand `undefined` rather than a throw. The reds here are
 * therefore exactly the JS harness's SPEC-INTENT rows: where the current gate accepts a malformed filter it
 * returns a boolean, and a boolean fails the rejection contract in both directions.
 */
const matchAsValues: MatchJavascriptObjectInTesting = async (obj, filter) => {
    try {
        return matchJavascriptObjectReference(obj, filter);
    } catch {
        return undefined;
    }
};

standardTests({
    test,
    expect,
    matchJavascriptObject: matchAsValues,
    implementationName: 'js-errors-as-values',
    errorsAsValues: true,
    fuzz: { iterations: 100 },
});
