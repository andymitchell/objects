import type { IUser } from "./auth.ts";
import type { OwnershipRule, OwnershipCheckResult } from "./types.ts";
import { OwnershipRuleSchema } from "./schemas.ts";
import { getPropertySpreadingArrays } from "../dot-prop-paths/getPropertySimpleDot.ts";

const PERMITTED: OwnershipCheckResult = { permitted: true };

/**
 * Check whether a user owns an item according to the given ownership rule.
 *
 * Why: Centralises ownership logic so JS runtime, SQL adapters, and stores all share one source of truth.
 *
 * @example
 * const result = checkOwnership(item, { type: 'basic', property_type: 'id', path: 'owner_id', format: 'uuid' }, user);
 * if (!result.permitted) console.log(result.reason); // e.g. 'not-owner'
 */
export function checkOwnership<T extends Record<string, any>>(
    item: Readonly<T>,
    ownershipRule: OwnershipRule<T>,
    user?: IUser,
): OwnershipCheckResult {
    // Runtime validation — missing/null/unknown rules always deny
    if (!ownershipRule || !OwnershipRuleSchema.safeParse(ownershipRule).success) {
        return { permitted: false, reason: 'invalid-rule' };
    }

    if (ownershipRule.type === 'none') {
        return PERMITTED;
    }

    if (ownershipRule.type !== 'basic') {
        return { permitted: false, reason: 'unknown-type' };
    }

    // Must have a user for ownership checks
    if (!user) {
        return { permitted: false, reason: 'no-owner-id' };
    }

    // Resolve user claim based on format
    const id = resolveUserClaim(user, ownershipRule.format);
    if (!id) {
        return { permitted: false, reason: 'no-owner-id' };
    }

    // Validate email format when required
    if (ownershipRule.format === 'email' && !/.+\@.+\..+/.test(id)) {
        return { permitted: false, reason: 'expected-owner-email' };
    }

    // Check primary ownership path
    const primaryPassed = checkPath(item, ownershipRule.path, ownershipRule.property_type, id);

    // Check transfer path (only for property_type: 'id')
    let transferPassed = false;
    if (ownershipRule.property_type === 'id' && ownershipRule.transferring_to_path) {
        transferPassed = checkPath(item, ownershipRule.transferring_to_path, 'id', id);
    }

    if (!primaryPassed && !transferPassed) {
        return { permitted: false, reason: 'not-owner' };
    }

    return PERMITTED;
}

/** Why: maps format discriminant to the correct IUser claim method. */
function resolveUserClaim(user: IUser, format: 'uuid' | 'email'): string | undefined {
    if (format === 'uuid') return user.getUuid();
    if (format === 'email') return user.getEmail();
    return undefined;
}

/** Why: checks whether `id` matches the value(s) at `path` inside `item`. */
function checkPath<T extends Record<string, any>>(
    item: Readonly<T>,
    path: string,
    propertyType: 'id' | 'id_in_scalar_array',
    id: string,
): boolean {
    const arrayValues = getPropertySpreadingArrays(item, path);

    return arrayValues.some(arrayValue => {
        if (propertyType === 'id_in_scalar_array' && Array.isArray(arrayValue.value)) {
            // Each element must be strictly compared — only string matches count
            return arrayValue.value.some(el => typeof el === 'string' && el === id);
        } else if (propertyType === 'id') {
            // Strict string equality — no type coercion
            return typeof arrayValue.value === 'string' && arrayValue.value === id;
        }
        return false;
    });
}
