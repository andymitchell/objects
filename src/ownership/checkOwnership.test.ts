import { describe, test, expect } from "vitest";
import { checkOwnership } from "./checkOwnership.ts";
import { standardOwnershipTests, type OwnershipTestAdapter } from "./standardTests.ts";

function createJsAdapter(): OwnershipTestAdapter {
    return {
        canWrite: async ({ item, ownershipRule, user }) => {
            const result = checkOwnership(item, ownershipRule, user);
            return result.permitted;
        },
        filterByOwner: async ({ items, ownershipRule }) => {
            if (ownershipRule.type === 'none') return [...items];
            // For filterByOwner we need the user — but adapter signature requires it
            // This is handled below by the actual adapter call which includes user
            return undefined;
        },
    };
}

// Override with a proper adapter that uses user for filtering
function createFullJsAdapter(): OwnershipTestAdapter {
    return {
        canWrite: async ({ item, ownershipRule, user }) => {
            const result = checkOwnership(item, ownershipRule, user);
            return result.permitted;
        },
        filterByOwner: async ({ items, ownershipRule, user }) => {
            return items.filter(item => checkOwnership(item, ownershipRule, user).permitted);
        },
    };
}

describe('checkOwnership (JS runtime)', () => {
    standardOwnershipTests({
        test,
        expect,
        createAdapter: createFullJsAdapter,
        implementationName: 'JS checkOwnership',
    });
});
