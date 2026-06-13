import { z } from "zod";
import { test, describe, expect } from "vitest";
import type { DDL } from "../../ddl/types.ts";
import { writeToItemsArray } from "./writeToItemsArray.ts";
import { standardTests, type AdapterFactory } from "../standardTests.ts";
import { getWriteErrors, isUpdateOrDeleteWritePayload } from "../helpers.ts";
import { compileValidateWhereFilter } from "../../where-filter/index.ts";

/**
 * A deliberately weak cross-check that keeps `validateWhereFilter` in sync with the write engine: it runs
 * the whole write-action standard battery through an adapter that *also* exercises the validator. Every
 * `where`/`items_where` in that corpus is a legitimate filter on a known field, so the validator must flag
 * none of them — a flag here is a false positive (validator drifting stricter than the matcher). Its value
 * is not depth but that it fails loudly the moment the validator starts rejecting filters the engine accepts.
 */
const createValidatingAdapter: AdapterFactory = <T extends Record<string, any>>(schema: z.ZodType<T, any, any>, ddl: DDL<T>) => ({
    apply: async ({ initialItems, writeActions, options, schema: configSchema, ddl: configDdl }) => {
        // Directly assert the public validator flags none of the corpus's (all legitimate) top-level wheres.
        const validate = compileValidateWhereFilter(configSchema);
        for (const action of writeActions) {
            const payload = action.payload;
            if (isUpdateOrDeleteWritePayload(payload)) {
                const issues = validate(payload.where);
                if (issues.length > 0) {
                    throw new Error(`validateWhereFilter false-positive on a standard-test where ${JSON.stringify(payload.where)}: ${JSON.stringify(issues)}`);
                }
            }
        }

        // Delegate to the real engine for the actual outcome, so every standard result/changes assertion still holds.
        const items = structuredClone(initialItems);
        const result = writeToItemsArray(writeActions, items, configSchema, configDdl, {
            atomic: options?.atomic,
            attempt_recover_duplicate_create: options?.attempt_recover_duplicate_create,
        });

        // Nested array_scope / pull filters are gated inside the engine, so a nested false-positive would
        // surface as an invalid_filter error — which the corpus never legitimately produces.
        const invalidFilter = getWriteErrors(result).find((e) => e.type === "invalid_filter");
        if (invalidFilter) {
            throw new Error(`writeToItemsArray rejected a standard-test filter as invalid_filter (validator drift?): ${JSON.stringify(invalidFilter)}`);
        }

        return { result, changes: result.changes, finalItems: result.changes.final_items };
    },
});

describe("writeToItemsArray + validateWhereFilter (validator/matcher sync)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vitest global vs import type mismatch
    standardTests({ test: test as any, expect: expect as any, createAdapter: createValidatingAdapter, implementationName: "writeToItemsArray+validateWhereFilter" });
});
