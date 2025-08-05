import  { createObjectsArrayDiffer, diffObjectsArrays } from "./createObjectsArrayDiffer.ts";
import type { ObjectsArrayDiffer, ObjectsDelta, ObjectsArrayDifferOptions, ObjectsDeltaApplicable } from "./types.ts";
import { isObjectsDeltaFast } from "./types.ts";
import  { ObjectsDeltaEmitter } from "./ObjectsDeltaEmitter.ts";
import  { constrainDeltaToFilter } from "./constrainDeltaToFilter.ts";
import  { applyDelta } from "./apply-delta/applyDelta.ts";
import  { isObjectsDelta, isObjectsDeltaApplicable, ObjectsDeltaApplicableSchema, ObjectsDeltaSchema } from "./schemas.ts";
import { reduceObjectsDeltas } from "./reduce-objects-delta/reduceObjectsDeltas.ts";
import  { testReduceObjectDeltas } from "./reduce-objects-delta/testReduceObjectDeltas.ts";
import  { testApplyDelta } from "./apply-delta/testApplyDelta.ts";




export {
    createObjectsArrayDiffer,
    diffObjectsArrays,
    ObjectsDeltaEmitter,

    constrainDeltaToFilter,
    applyDelta,
    reduceObjectsDeltas,

    ObjectsDeltaSchema,
    ObjectsDeltaApplicableSchema,
    isObjectsDelta,
    isObjectsDeltaApplicable,
    isObjectsDeltaFast,

    testApplyDelta,
    testReduceObjectDeltas,
}

export type {
    ObjectsDelta,
    ObjectsDeltaApplicable,
    

    ObjectsArrayDiffer,
    ObjectsArrayDifferOptions
}


