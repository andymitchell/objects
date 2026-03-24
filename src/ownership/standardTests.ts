import { z } from "zod";
import type { OwnershipRule } from "./types.ts";
import type { IUser } from "./auth.ts";
import { mockUser } from "./testing-helpers/mockUser.ts";

// ═══════════════════════════════════════════════════════════════════
// Adapter Type
// ═══════════════════════════════════════════════════════════════════

export type OwnershipTestAdapter = {
    /**
     * Given items and a user, return only the items the user has access to.
     * Tests read-side filtering (SQL WHERE / JS filter).
     * undefined = this adapter doesn't support read filtering.
     */
    filterByOwner: <T extends Record<string, any>>(config: {
        items: T[],
        ownershipRule: OwnershipRule<T>,
        user: IUser,
        schema: z.ZodType<T>,
        primaryKey: keyof T & string,
    }) => Promise<T[] | undefined>,

    /**
     * Given an item and a user, return whether the user can write to the item.
     * Tests write-side permission checking (JS checkOwnership / SQL RLS).
     * undefined = this adapter doesn't support write checking.
     */
    canWrite: <T extends Record<string, any>>(config: {
        item: T,
        ownershipRule: OwnershipRule<T>,
        user: IUser,
        schema: z.ZodType<T>,
    }) => Promise<boolean | undefined>,
}

// ═══════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════

type StandardOwnershipTestConfig = {
    test: typeof import('vitest').test,
    expect: typeof import('vitest').expect,
    createAdapter: () => OwnershipTestAdapter,
    implementationName?: string,
}

// ═══════════════════════════════════════════════════════════════════
// Test Fixtures — Schemas
// ═══════════════════════════════════════════════════════════════════

const ScalarOwnerSchema = z.object({ id: z.string(), owner_id: z.string(), name: z.string() });
type ScalarOwner = z.infer<typeof ScalarOwnerSchema>;

const ArrayOwnerSchema = z.object({ id: z.string(), owner_ids: z.array(z.string()), name: z.string() });
type ArrayOwner = z.infer<typeof ArrayOwnerSchema>;

const EmailOwnerSchema = z.object({ id: z.string(), owner_email: z.string(), name: z.string() });
type EmailOwner = z.infer<typeof EmailOwnerSchema>;

const TransferSchema = z.object({ id: z.string(), owner_id: z.string(), pending_owner_id: z.string().optional(), name: z.string() });
type TransferOwner = z.infer<typeof TransferSchema>;

const NestedOwnerSchema = z.object({ id: z.string(), meta: z.object({ owner_id: z.string() }), name: z.string() });
type NestedOwner = z.infer<typeof NestedOwnerSchema>;

const SpreadOwnerSchema = z.object({ id: z.string(), owners: z.array(z.object({ email: z.string() })), name: z.string() });
type SpreadOwner = z.infer<typeof SpreadOwnerSchema>;

// ═══════════════════════════════════════════════════════════════════
// Test Fixtures — Ownership Rules
// ═══════════════════════════════════════════════════════════════════

const scalarOwnership: OwnershipRule<ScalarOwner> = { type: 'basic', property_type: 'id', path: 'owner_id', format: 'uuid' };
const arrayOwnership: OwnershipRule<ArrayOwner> = { type: 'basic', property_type: 'id_in_scalar_array', path: 'owner_ids', format: 'uuid' };
const emailOwnership: OwnershipRule<EmailOwner> = { type: 'basic', property_type: 'id', path: 'owner_email', format: 'email' };
const transferOwnership: OwnershipRule<TransferOwner> = { type: 'basic', property_type: 'id', path: 'owner_id', format: 'uuid', transferring_to_path: 'pending_owner_id' };
const nestedOwnership: OwnershipRule<NestedOwner> = { type: 'basic', property_type: 'id', path: 'meta.owner_id', format: 'uuid' };
const spreadOwnership: OwnershipRule<SpreadOwner> = { type: 'basic', property_type: 'id', path: 'owners.email', format: 'email' };
const noneOwnership: OwnershipRule = { type: 'none' };

// ═══════════════════════════════════════════════════════════════════
// Test Fixtures — Users
// ═══════════════════════════════════════════════════════════════════

const alice = mockUser({ uuid: 'alice-uuid', email: 'alice@test.com' });
const bob = mockUser({ uuid: 'bob-uuid', email: 'bob@test.com' });
const noIdUser = mockUser({});

// ═══════════════════════════════════════════════════════════════════
// Helper
// ═══════════════════════════════════════════════════════════════════

function expectOrAcknowledgeUnsupported<T>(
    result: T | undefined,
    assertion: (r: T) => void,
    implementationName: string,
    reason?: string
): void {
    if (result === undefined) {
        console.warn(`[ACKNOWLEDGED UNSUPPORTED: ${implementationName}] ${reason ?? 'not supported'}`);
        return;
    }
    assertion(result);
}

// ═══════════════════════════════════════════════════════════════════
// Standard Tests
// ═══════════════════════════════════════════════════════════════════

export function standardOwnershipTests(config: StandardOwnershipTestConfig): void {
    const { test, expect, createAdapter, implementationName = 'unknown' } = config;

    // ───────────────────────────────────────────────────────────────
    // canWrite
    // ───────────────────────────────────────────────────────────────

    describe('canWrite', () => {

        // ── type: none ──

        describe('type: none — no restrictions', () => {
            test('any user can write any item', async () => {
                const adapter = createAdapter();
                const item: ScalarOwner = { id: '1', owner_id: 'someone-else', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: noneOwnership as OwnershipRule<ScalarOwner>, user: alice, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(true), implementationName, 'canWrite type:none');
            });

            test('user with no identity can write', async () => {
                const adapter = createAdapter();
                const item: ScalarOwner = { id: '1', owner_id: 'someone', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: noneOwnership as OwnershipRule<ScalarOwner>, user: noIdUser, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(true), implementationName, 'canWrite type:none noIdUser');
            });

            test('undefined user can write', async () => {
                const adapter = createAdapter();
                const item: ScalarOwner = { id: '1', owner_id: 'someone', name: 'x' };
                // noIdUser has all methods returning undefined — closest to "undefined user"
                const result = await adapter.canWrite({ item, ownershipRule: noneOwnership as OwnershipRule<ScalarOwner>, user: noIdUser, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(true), implementationName, 'canWrite type:none undefined user');
            });
        });

        // ── type: basic, property_type: id, format: uuid ──

        describe('type: basic, property_type: id, format: uuid', () => {
            test('owner can write their own item', async () => {
                const adapter = createAdapter();
                const item: ScalarOwner = { id: '1', owner_id: 'alice-uuid', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: scalarOwnership, user: alice, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(true), implementationName);
            });

            test('non-owner is denied', async () => {
                const adapter = createAdapter();
                const item: ScalarOwner = { id: '1', owner_id: 'alice-uuid', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: scalarOwnership, user: bob, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('user with no uuid is denied', async () => {
                const adapter = createAdapter();
                const item: ScalarOwner = { id: '1', owner_id: 'alice-uuid', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: scalarOwnership, user: noIdUser, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('undefined user is denied', async () => {
                const adapter = createAdapter();
                const item: ScalarOwner = { id: '1', owner_id: 'alice-uuid', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: scalarOwnership, user: noIdUser, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('item with missing owner field is denied', async () => {
                const adapter = createAdapter();
                const item = { id: '1', name: 'x' } as unknown as ScalarOwner;
                const result = await adapter.canWrite({ item, ownershipRule: scalarOwnership, user: alice, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('item with null owner field is denied', async () => {
                const adapter = createAdapter();
                const item = { id: '1', owner_id: null, name: 'x' } as unknown as ScalarOwner;
                const result = await adapter.canWrite({ item, ownershipRule: scalarOwnership, user: alice, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('item with empty string owner field is denied', async () => {
                const adapter = createAdapter();
                const item: ScalarOwner = { id: '1', owner_id: '', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: scalarOwnership, user: alice, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('item with owner set to empty object is denied', async () => {
                const adapter = createAdapter();
                const item = { id: '1', owner_id: {}, name: 'x' } as unknown as ScalarOwner;
                const result = await adapter.canWrite({ item, ownershipRule: scalarOwnership, user: alice, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('item with owner set to boolean or number logically equivalent to claim is denied', async () => {
                const adapter = createAdapter();
                const item = { id: '1', owner_id: true, name: 'x' } as unknown as ScalarOwner;
                const result = await adapter.canWrite({ item, ownershipRule: scalarOwnership, user: alice, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('case sensitivity: UUID case mismatch is denied', async () => {
                const adapter = createAdapter();
                const item: ScalarOwner = { id: '1', owner_id: 'ALICE-UUID', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: scalarOwnership, user: alice, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('malformed ownership rule (e.g. empty object) is denied', async () => {
                const adapter = createAdapter();
                const item: ScalarOwner = { id: '1', owner_id: 'alice-uuid', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: {} as OwnershipRule<ScalarOwner>, user: alice, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });
        });

        // ── format strictness ──

        describe('type: basic, format strictness', () => {
            test('denies when rule requires UUID but item owner matches user email claim', async () => {
                const adapter = createAdapter();
                // Rule requires uuid format, but item owner_id holds alice's email
                const item: ScalarOwner = { id: '1', owner_id: 'alice@test.com', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: scalarOwnership, user: alice, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('denies when rule requires email but item owner matches user UUID claim', async () => {
                const adapter = createAdapter();
                // Rule requires email format, but item owner_email holds alice's uuid
                const item: EmailOwner = { id: '1', owner_email: 'alice-uuid', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: emailOwnership, user: alice, schema: EmailOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('denies when user has empty or undefined claim for the required format', async () => {
                const adapter = createAdapter();
                const emailOnlyUser = mockUser({ email: 'alice@test.com' }); // no uuid
                const item: ScalarOwner = { id: '1', owner_id: 'alice@test.com', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: scalarOwnership, user: emailOnlyUser, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });
        });

        // ── type: basic, property_type: id, format: email ──

        describe('type: basic, property_type: id, format: email', () => {
            test('owner can write (email match)', async () => {
                const adapter = createAdapter();
                const item: EmailOwner = { id: '1', owner_email: 'alice@test.com', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: emailOwnership, user: alice, schema: EmailOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(true), implementationName);
            });

            test('non-owner is denied (different email)', async () => {
                const adapter = createAdapter();
                const item: EmailOwner = { id: '1', owner_email: 'alice@test.com', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: emailOwnership, user: bob, schema: EmailOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('user with invalid email format is denied', async () => {
                const adapter = createAdapter();
                const badEmailUser = mockUser({ email: 'not-an-email' });
                const item: EmailOwner = { id: '1', owner_email: 'not-an-email', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: emailOwnership, user: badEmailUser, schema: EmailOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('email comparison is case-sensitive (convention: lowercase)', async () => {
                const adapter = createAdapter();
                const item: EmailOwner = { id: '1', owner_email: 'Alice@test.com', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: emailOwnership, user: alice, schema: EmailOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });
        });

        // ── type: basic, property_type: id_in_scalar_array ──

        describe('type: basic, property_type: id_in_scalar_array', () => {
            test('user in array can write (single element)', async () => {
                const adapter = createAdapter();
                const item: ArrayOwner = { id: '1', owner_ids: ['alice-uuid'], name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: arrayOwnership, user: alice, schema: ArrayOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(true), implementationName);
            });

            test('user in array can write (arbitrary index among many)', async () => {
                const adapter = createAdapter();
                const item: ArrayOwner = { id: '1', owner_ids: ['other-1', 'other-2', 'alice-uuid', 'other-3'], name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: arrayOwnership, user: alice, schema: ArrayOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(true), implementationName);
            });

            test('user not in array is denied', async () => {
                const adapter = createAdapter();
                const item: ArrayOwner = { id: '1', owner_ids: ['bob-uuid', 'charlie-uuid'], name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: arrayOwnership, user: alice, schema: ArrayOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('empty array denies everyone', async () => {
                const adapter = createAdapter();
                const item: ArrayOwner = { id: '1', owner_ids: [], name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: arrayOwnership, user: alice, schema: ArrayOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('array with null entries does not match', async () => {
                const adapter = createAdapter();
                const item = { id: '1', owner_ids: [null, null], name: 'x' } as unknown as ArrayOwner;
                const result = await adapter.canWrite({ item, ownershipRule: arrayOwnership, user: alice, schema: ArrayOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('user appears multiple times — still permitted (no duplication bug)', async () => {
                const adapter = createAdapter();
                const item: ArrayOwner = { id: '1', owner_ids: ['alice-uuid', 'alice-uuid', 'alice-uuid'], name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: arrayOwnership, user: alice, schema: ArrayOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(true), implementationName);
            });

            test('scalar string of comma-separated valid claims is denied (expects array)', async () => {
                const adapter = createAdapter();
                const item = { id: '1', owner_ids: 'alice-uuid,bob-uuid', name: 'x' } as unknown as ArrayOwner;
                const result = await adapter.canWrite({ item, ownershipRule: arrayOwnership, user: alice, schema: ArrayOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('array contains objects wrapping valid claim (e.g. [{id: "claim"}]) is denied', async () => {
                const adapter = createAdapter();
                const item = { id: '1', owner_ids: [{ id: 'alice-uuid' }], name: 'x' } as unknown as ArrayOwner;
                const result = await adapter.canWrite({ item, ownershipRule: arrayOwnership, user: alice, schema: ArrayOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('array is entirely null or missing is denied', async () => {
                const adapter = createAdapter();
                const item = { id: '1', owner_ids: null, name: 'x' } as unknown as ArrayOwner;
                const result = await adapter.canWrite({ item, ownershipRule: arrayOwnership, user: alice, schema: ArrayOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('user claim is only a substring of an array element — denied', async () => {
                const adapter = createAdapter();
                const item: ArrayOwner = { id: '1', owner_ids: ['alice-uuid-extended'], name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: arrayOwnership, user: alice, schema: ArrayOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('array contains mix of nulls, numbers, objects, and non-matching strings — denied', async () => {
                const adapter = createAdapter();
                const item = { id: '1', owner_ids: [null, 42, { id: 'alice-uuid' }, 'not-alice'], name: 'x' } as unknown as ArrayOwner;
                const result = await adapter.canWrite({ item, ownershipRule: arrayOwnership, user: alice, schema: ArrayOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });
        });

        // ── ownership transfer ──

        describe('ownership transfer (transferring_to_path)', () => {
            test('original owner can still write', async () => {
                const adapter = createAdapter();
                const item: TransferOwner = { id: '1', owner_id: 'alice-uuid', pending_owner_id: 'bob-uuid', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: transferOwnership, user: alice, schema: TransferSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(true), implementationName);
            });

            test('pending owner can write', async () => {
                const adapter = createAdapter();
                const item: TransferOwner = { id: '1', owner_id: 'alice-uuid', pending_owner_id: 'bob-uuid', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: transferOwnership, user: bob, schema: TransferSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(true), implementationName);
            });

            test('third party (neither owner nor pending) is denied', async () => {
                const adapter = createAdapter();
                const charlie = mockUser({ uuid: 'charlie-uuid', email: 'charlie@test.com' });
                const item: TransferOwner = { id: '1', owner_id: 'alice-uuid', pending_owner_id: 'bob-uuid', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: transferOwnership, user: charlie, schema: TransferSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('pending_owner_id is undefined/null — only original owner can write', async () => {
                const adapter = createAdapter();
                const item: TransferOwner = { id: '1', owner_id: 'alice-uuid', name: 'x' };
                const resultOwner = await adapter.canWrite({ item, ownershipRule: transferOwnership, user: alice, schema: TransferSchema });
                expectOrAcknowledgeUnsupported(resultOwner, r => expect(r).toBe(true), implementationName);
                const resultOther = await adapter.canWrite({ item, ownershipRule: transferOwnership, user: bob, schema: TransferSchema });
                expectOrAcknowledgeUnsupported(resultOther, r => expect(r).toBe(false), implementationName);
            });

            test('both paths set to same user — still permitted', async () => {
                const adapter = createAdapter();
                const item: TransferOwner = { id: '1', owner_id: 'alice-uuid', pending_owner_id: 'alice-uuid', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: transferOwnership, user: alice, schema: TransferSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(true), implementationName);
            });

            test('transferring_to_path field has type confusion (e.g. array instead of scalar) — denied via transfer path', async () => {
                const adapter = createAdapter();
                const item = { id: '1', owner_id: 'charlie-uuid', pending_owner_id: ['alice-uuid'], name: 'x' } as unknown as TransferOwner;
                const charlie = mockUser({ uuid: 'charlie-uuid' });
                // Charlie is the current owner, so should still be permitted via primary path
                const resultOwner = await adapter.canWrite({ item, ownershipRule: transferOwnership, user: charlie, schema: TransferSchema });
                expectOrAcknowledgeUnsupported(resultOwner, r => expect(r).toBe(true), implementationName);
                // Alice should NOT get access through the malformed transfer path
                const resultAlice = await adapter.canWrite({ item, ownershipRule: transferOwnership, user: alice, schema: TransferSchema });
                expectOrAcknowledgeUnsupported(resultAlice, r => expect(r).toBe(false), implementationName);
            });

            test('current owner still permitted even if transferring_to_path contains malformed data', async () => {
                const adapter = createAdapter();
                const item = { id: '1', owner_id: 'alice-uuid', pending_owner_id: { nested: 'bad' }, name: 'x' } as unknown as TransferOwner;
                const result = await adapter.canWrite({ item, ownershipRule: transferOwnership, user: alice, schema: TransferSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(true), implementationName);
            });
        });

        // ── nested paths ──

        describe('nested paths (e.g. meta.owner_id)', () => {
            test('owner at nested path can write', async () => {
                const adapter = createAdapter();
                const item: NestedOwner = { id: '1', meta: { owner_id: 'alice-uuid' }, name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: nestedOwnership, user: alice, schema: NestedOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(true), implementationName);
            });

            test('non-owner at nested path is denied', async () => {
                const adapter = createAdapter();
                const item: NestedOwner = { id: '1', meta: { owner_id: 'alice-uuid' }, name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: nestedOwnership, user: bob, schema: NestedOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('missing intermediate object (meta is undefined) is denied', async () => {
                const adapter = createAdapter();
                const item = { id: '1', meta: undefined, name: 'x' } as unknown as NestedOwner;
                const result = await adapter.canWrite({ item, ownershipRule: nestedOwnership, user: alice, schema: NestedOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('intermediate path segment is null (meta is null) is denied', async () => {
                const adapter = createAdapter();
                const item = { id: '1', meta: null, name: 'x' } as unknown as NestedOwner;
                const result = await adapter.canWrite({ item, ownershipRule: nestedOwnership, user: alice, schema: NestedOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });
        });

        // ── spreading paths through object arrays ──

        describe('spreading paths through object arrays (e.g. owners.email where owners: {email}[])', () => {
            test('owner matched via spread path can write', async () => {
                const adapter = createAdapter();
                const item: SpreadOwner = { id: '1', owners: [{ email: 'alice@test.com' }], name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: spreadOwnership, user: alice, schema: SpreadOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(true), implementationName);
            });

            test('non-owner via spread path is denied', async () => {
                const adapter = createAdapter();
                const item: SpreadOwner = { id: '1', owners: [{ email: 'alice@test.com' }], name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: spreadOwnership, user: bob, schema: SpreadOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('empty object array denies everyone', async () => {
                const adapter = createAdapter();
                const item: SpreadOwner = { id: '1', owners: [], name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: spreadOwnership, user: alice, schema: SpreadOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });
        });

        // ── attack: substring & partial matches ──

        describe('attack: substring & partial matches', () => {
            test('item owner field contains user claim as prefix — denied', async () => {
                const adapter = createAdapter();
                const item: ScalarOwner = { id: '1', owner_id: 'alice-uuid-extended', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: scalarOwnership, user: alice, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('item owner field contains user claim as suffix — denied', async () => {
                const adapter = createAdapter();
                const item: ScalarOwner = { id: '1', owner_id: 'prefix-alice-uuid', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: scalarOwnership, user: alice, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('user claim contains item owner field as substring — denied', async () => {
                const adapter = createAdapter();
                const item: ScalarOwner = { id: '1', owner_id: 'alice', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: scalarOwnership, user: alice, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });
        });

        // ── attack: injection & escaping ──

        describe('attack: injection & escaping (SQL / JSON)', () => {
            test('user claim contains SQL string terminators (quotes, semicolons) — denied securely', async () => {
                const adapter = createAdapter();
                const maliciousUser = mockUser({ uuid: "'; DROP TABLE users; --" });
                const item: ScalarOwner = { id: '1', owner_id: 'alice-uuid', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: scalarOwnership, user: maliciousUser, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('user claim contains JSON path injection payloads — denied securely', async () => {
                const adapter = createAdapter();
                const maliciousUser = mockUser({ uuid: '$.owner' });
                const item: ScalarOwner = { id: '1', owner_id: 'alice-uuid', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: scalarOwnership, user: maliciousUser, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('user claim contains SQL wildcards (%, _) — denied securely', async () => {
                const adapter = createAdapter();
                const maliciousUser = mockUser({ uuid: '%alice%' });
                const item: ScalarOwner = { id: '1', owner_id: 'alice-uuid', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: scalarOwnership, user: maliciousUser, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });
        });

        // ── attack: prototype pollution & path traversal ──

        describe('attack: prototype pollution & path traversal', () => {
            test('rule path attempts __proto__ — denied', async () => {
                const adapter = createAdapter();
                const item: ScalarOwner = { id: '1', owner_id: 'alice-uuid', name: 'x' };
                const maliciousRule = { type: 'basic', property_type: 'id', path: '__proto__.owner_id', format: 'uuid' } as unknown as OwnershipRule<ScalarOwner>;
                const result = await adapter.canWrite({ item, ownershipRule: maliciousRule, user: alice, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('rule path attempts constructor.prototype — denied', async () => {
                const adapter = createAdapter();
                const item: ScalarOwner = { id: '1', owner_id: 'alice-uuid', name: 'x' };
                const maliciousRule = { type: 'basic', property_type: 'id', path: 'constructor.prototype.owner_id', format: 'uuid' } as unknown as OwnershipRule<ScalarOwner>;
                const result = await adapter.canWrite({ item, ownershipRule: maliciousRule, user: alice, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('excessively long or deeply nested dot-prop path — no uncaught exception', async () => {
                const adapter = createAdapter();
                const item: ScalarOwner = { id: '1', owner_id: 'alice-uuid', name: 'x' };
                const deepPath = Array(100).fill('a').join('.');
                const maliciousRule = { type: 'basic', property_type: 'id', path: deepPath, format: 'uuid' } as unknown as OwnershipRule<ScalarOwner>;
                const result = await adapter.canWrite({ item, ownershipRule: maliciousRule, user: alice, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });
        });

        // ── runtime validation of ownership rule ──

        describe('runtime validation of ownership rule', () => {
            test('missing ownership rule at runtime throws/errors (not silently passes)', async () => {
                const adapter = createAdapter();
                const item: ScalarOwner = { id: '1', owner_id: 'alice-uuid', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: undefined as unknown as OwnershipRule<ScalarOwner>, user: alice, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('null ownership rule at runtime throws/errors', async () => {
                const adapter = createAdapter();
                const item: ScalarOwner = { id: '1', owner_id: 'alice-uuid', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: null as unknown as OwnershipRule<ScalarOwner>, user: alice, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });

            test('ownership rule with unknown type throws/errors', async () => {
                const adapter = createAdapter();
                const item: ScalarOwner = { id: '1', owner_id: 'alice-uuid', name: 'x' };
                const result = await adapter.canWrite({ item, ownershipRule: { type: 'unknown_type' } as unknown as OwnershipRule<ScalarOwner>, user: alice, schema: ScalarOwnerSchema });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toBe(false), implementationName);
            });
        });
    });

    // ───────────────────────────────────────────────────────────────
    // filterByOwner
    // ───────────────────────────────────────────────────────────────

    describe('filterByOwner', () => {

        // ── type: none ──

        describe('type: none — no restrictions', () => {
            test('returns all items unfiltered', async () => {
                const adapter = createAdapter();
                const items: ScalarOwner[] = [
                    { id: '1', owner_id: 'alice-uuid', name: 'a' },
                    { id: '2', owner_id: 'bob-uuid', name: 'b' },
                    { id: '3', owner_id: 'charlie-uuid', name: 'c' },
                ];
                const result = await adapter.filterByOwner({ items, ownershipRule: noneOwnership as OwnershipRule<ScalarOwner>, user: alice, schema: ScalarOwnerSchema, primaryKey: 'id' });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toHaveLength(3), implementationName, 'filterByOwner type:none');
            });
        });

        // ── type: basic, property_type: id, format: uuid ──

        describe('type: basic, property_type: id, format: uuid', () => {
            const items: ScalarOwner[] = [
                { id: '1', owner_id: 'alice-uuid', name: 'a' },
                { id: '2', owner_id: 'bob-uuid', name: 'b' },
                { id: '3', owner_id: 'alice-uuid', name: 'c' },
            ];

            test('returns only items owned by user', async () => {
                const adapter = createAdapter();
                const result = await adapter.filterByOwner({ items, ownershipRule: scalarOwnership, user: alice, schema: ScalarOwnerSchema, primaryKey: 'id' });
                expectOrAcknowledgeUnsupported(result, r => {
                    expect(r).toHaveLength(2);
                    expect(r.every(i => i.owner_id === 'alice-uuid')).toBe(true);
                }, implementationName);
            });

            test('returns empty array when no items match', async () => {
                const adapter = createAdapter();
                const charlie = mockUser({ uuid: 'charlie-uuid' });
                const result = await adapter.filterByOwner({ items, ownershipRule: scalarOwnership, user: charlie, schema: ScalarOwnerSchema, primaryKey: 'id' });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toHaveLength(0), implementationName);
            });

            test('mixed ownership — returns correct subset', async () => {
                const adapter = createAdapter();
                const result = await adapter.filterByOwner({ items, ownershipRule: scalarOwnership, user: bob, schema: ScalarOwnerSchema, primaryKey: 'id' });
                expectOrAcknowledgeUnsupported(result, r => {
                    expect(r).toHaveLength(1);
                    expect(r[0]!.id).toBe('2');
                }, implementationName);
            });

            test('items with missing owner field are excluded', async () => {
                const adapter = createAdapter();
                const itemsWithMissing = [
                    { id: '1', owner_id: 'alice-uuid', name: 'a' },
                    { id: '2', name: 'b' } as unknown as ScalarOwner,
                ];
                const result = await adapter.filterByOwner({ items: itemsWithMissing, ownershipRule: scalarOwnership, user: alice, schema: ScalarOwnerSchema, primaryKey: 'id' });
                expectOrAcknowledgeUnsupported(result, r => {
                    expect(r).toHaveLength(1);
                    expect(r[0]!.id).toBe('1');
                }, implementationName);
            });
        });

        // ── type: basic, property_type: id_in_scalar_array ──

        describe('type: basic, property_type: id_in_scalar_array', () => {
            test('returns items where user is in the owners array', async () => {
                const adapter = createAdapter();
                const items: ArrayOwner[] = [
                    { id: '1', owner_ids: ['alice-uuid', 'bob-uuid'], name: 'a' },
                    { id: '2', owner_ids: ['bob-uuid'], name: 'b' },
                    { id: '3', owner_ids: ['alice-uuid'], name: 'c' },
                ];
                const result = await adapter.filterByOwner({ items, ownershipRule: arrayOwnership, user: alice, schema: ArrayOwnerSchema, primaryKey: 'id' });
                expectOrAcknowledgeUnsupported(result, r => {
                    expect(r).toHaveLength(2);
                    expect(r.map(i => i.id).sort()).toEqual(['1', '3']);
                }, implementationName);
            });

            test('items with empty owner arrays are excluded', async () => {
                const adapter = createAdapter();
                const items: ArrayOwner[] = [
                    { id: '1', owner_ids: ['alice-uuid'], name: 'a' },
                    { id: '2', owner_ids: [], name: 'b' },
                ];
                const result = await adapter.filterByOwner({ items, ownershipRule: arrayOwnership, user: alice, schema: ArrayOwnerSchema, primaryKey: 'id' });
                expectOrAcknowledgeUnsupported(result, r => {
                    expect(r).toHaveLength(1);
                    expect(r[0]!.id).toBe('1');
                }, implementationName);
            });
        });

        // ── ownership transfer ──

        describe('ownership transfer', () => {
            test('returns items where user is owner OR pending owner', async () => {
                const adapter = createAdapter();
                const items: TransferOwner[] = [
                    { id: '1', owner_id: 'alice-uuid', pending_owner_id: 'bob-uuid', name: 'a' },
                    { id: '2', owner_id: 'bob-uuid', pending_owner_id: 'alice-uuid', name: 'b' },
                    { id: '3', owner_id: 'charlie-uuid', name: 'c' },
                ];
                const result = await adapter.filterByOwner({ items, ownershipRule: transferOwnership, user: alice, schema: TransferSchema, primaryKey: 'id' });
                expectOrAcknowledgeUnsupported(result, r => {
                    expect(r).toHaveLength(2);
                    expect(r.map(i => i.id).sort()).toEqual(['1', '2']);
                }, implementationName);
            });

            test('does not return items where user is neither', async () => {
                const adapter = createAdapter();
                const items: TransferOwner[] = [
                    { id: '1', owner_id: 'alice-uuid', pending_owner_id: 'bob-uuid', name: 'a' },
                ];
                const charlie = mockUser({ uuid: 'charlie-uuid' });
                const result = await adapter.filterByOwner({ items, ownershipRule: transferOwnership, user: charlie, schema: TransferSchema, primaryKey: 'id' });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toHaveLength(0), implementationName);
            });
        });

        // ── nested paths ──

        describe('nested paths', () => {
            test('filters correctly on nested ownership path', async () => {
                const adapter = createAdapter();
                const items: NestedOwner[] = [
                    { id: '1', meta: { owner_id: 'alice-uuid' }, name: 'a' },
                    { id: '2', meta: { owner_id: 'bob-uuid' }, name: 'b' },
                ];
                const result = await adapter.filterByOwner({ items, ownershipRule: nestedOwnership, user: alice, schema: NestedOwnerSchema, primaryKey: 'id' });
                expectOrAcknowledgeUnsupported(result, r => {
                    expect(r).toHaveLength(1);
                    expect(r[0]!.id).toBe('1');
                }, implementationName);
            });
        });

        // ── spreading paths through object arrays ──

        describe('spreading paths through object arrays', () => {
            test('filters correctly on spread path (e.g. owners.email)', async () => {
                const adapter = createAdapter();
                const items: SpreadOwner[] = [
                    { id: '1', owners: [{ email: 'alice@test.com' }], name: 'a' },
                    { id: '2', owners: [{ email: 'bob@test.com' }], name: 'b' },
                    { id: '3', owners: [{ email: 'alice@test.com' }, { email: 'bob@test.com' }], name: 'c' },
                ];
                const result = await adapter.filterByOwner({ items, ownershipRule: spreadOwnership, user: alice, schema: SpreadOwnerSchema, primaryKey: 'id' });
                expectOrAcknowledgeUnsupported(result, r => {
                    expect(r).toHaveLength(2);
                    expect(r.map(i => i.id).sort()).toEqual(['1', '3']);
                }, implementationName);
            });
        });

        // ── attack scenarios ──

        describe('attack scenarios', () => {
            test('SQL injection in owner path value — no injection (parameterised)', async () => {
                const adapter = createAdapter();
                const items: ScalarOwner[] = [
                    { id: '1', owner_id: "'; DROP TABLE users; --", name: 'a' },
                    { id: '2', owner_id: 'alice-uuid', name: 'b' },
                ];
                const result = await adapter.filterByOwner({ items, ownershipRule: scalarOwnership, user: alice, schema: ScalarOwnerSchema, primaryKey: 'id' });
                expectOrAcknowledgeUnsupported(result, r => {
                    expect(r).toHaveLength(1);
                    expect(r[0]!.id).toBe('2');
                }, implementationName);
            });

            test('owner value containing special chars (\', ", \\, NULL byte)', async () => {
                const adapter = createAdapter();
                const items: ScalarOwner[] = [
                    { id: '1', owner_id: "it's a \"test\"\\\0", name: 'a' },
                    { id: '2', owner_id: 'alice-uuid', name: 'b' },
                ];
                const result = await adapter.filterByOwner({ items, ownershipRule: scalarOwnership, user: alice, schema: ScalarOwnerSchema, primaryKey: 'id' });
                expectOrAcknowledgeUnsupported(result, r => {
                    expect(r).toHaveLength(1);
                    expect(r[0]!.id).toBe('2');
                }, implementationName);
            });

            test('extremely long owner value — no crash', async () => {
                const adapter = createAdapter();
                const longValue = 'x'.repeat(100_000);
                const items: ScalarOwner[] = [
                    { id: '1', owner_id: longValue, name: 'a' },
                    { id: '2', owner_id: 'alice-uuid', name: 'b' },
                ];
                const result = await adapter.filterByOwner({ items, ownershipRule: scalarOwnership, user: alice, schema: ScalarOwnerSchema, primaryKey: 'id' });
                expectOrAcknowledgeUnsupported(result, r => {
                    expect(r).toHaveLength(1);
                    expect(r[0]!.id).toBe('2');
                }, implementationName);
            });

            test('owner field set to array when expecting scalar — no match', async () => {
                const adapter = createAdapter();
                const items = [
                    { id: '1', owner_id: ['alice-uuid'], name: 'a' } as unknown as ScalarOwner,
                    { id: '2', owner_id: 'alice-uuid', name: 'b' },
                ];
                const result = await adapter.filterByOwner({ items, ownershipRule: scalarOwnership, user: alice, schema: ScalarOwnerSchema, primaryKey: 'id' });
                expectOrAcknowledgeUnsupported(result, r => {
                    expect(r).toHaveLength(1);
                    expect(r[0]!.id).toBe('2');
                }, implementationName);
            });

            test('owner field set to object when expecting scalar — no match', async () => {
                const adapter = createAdapter();
                const items = [
                    { id: '1', owner_id: { id: 'alice-uuid' }, name: 'a' } as unknown as ScalarOwner,
                    { id: '2', owner_id: 'alice-uuid', name: 'b' },
                ];
                const result = await adapter.filterByOwner({ items, ownershipRule: scalarOwnership, user: alice, schema: ScalarOwnerSchema, primaryKey: 'id' });
                expectOrAcknowledgeUnsupported(result, r => {
                    expect(r).toHaveLength(1);
                    expect(r[0]!.id).toBe('2');
                }, implementationName);
            });

            test('prototype pollution attempt (__proto__ as path) — no match', async () => {
                const adapter = createAdapter();
                const items: ScalarOwner[] = [
                    { id: '1', owner_id: 'alice-uuid', name: 'a' },
                ];
                const maliciousRule = { type: 'basic', property_type: 'id', path: '__proto__', format: 'uuid' } as unknown as OwnershipRule<ScalarOwner>;
                const result = await adapter.filterByOwner({ items, ownershipRule: maliciousRule, user: alice, schema: ScalarOwnerSchema, primaryKey: 'id' });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toHaveLength(0), implementationName);
            });

            test('user claim contains SQL wildcards — no match', async () => {
                const adapter = createAdapter();
                const wildcardUser = mockUser({ uuid: '%' });
                const items: ScalarOwner[] = [
                    { id: '1', owner_id: 'alice-uuid', name: 'a' },
                    { id: '2', owner_id: 'bob-uuid', name: 'b' },
                ];
                const result = await adapter.filterByOwner({ items, ownershipRule: scalarOwnership, user: wildcardUser, schema: ScalarOwnerSchema, primaryKey: 'id' });
                expectOrAcknowledgeUnsupported(result, r => expect(r).toHaveLength(0), implementationName);
            });
        });
    });
}
