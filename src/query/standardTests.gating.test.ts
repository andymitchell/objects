import { describe, expect, it } from 'vitest';

import type { DDL } from '../ddl/types.ts';
import { STANDARD_TEST_DDL, type StandardTestItem } from './standardTestFixtures.ts';
import { standardTests } from './standardTests.ts';

/**
 * Verifies the per-test gating in `standardTests()` honours `DDL.lists['.'].sortable_keys`.
 *
 * Approach: pass a stubbed `it` (with a `.skip` sibling) that records the name
 * of every test registered. Capture happens at describe-callback time (not inside
 * an `it` body) — `standardTests()` calls global `describe(...)` which is only
 * valid at top level or inside another describe, never inside `it`.
 */

function captureTestRegistrations(ddl?: DDL<StandardTestItem>) {
    const ran: string[] = [];
    const skipped: string[] = [];
    const stubIt = ((name: string, _fn?: unknown) => { ran.push(name); }) as unknown as typeof it;
    (stubIt as unknown as { skip: (name: string, _fn?: unknown) => void }).skip =
        (name: string, _fn?: unknown) => { skipped.push(name); };

    // Stub `describe` invokes its callback synchronously but doesn't register a
    // group with vitest — keeps the test report clean while still letting the
    // nested `it`s flow through our stub.
    const stubDescribe = ((_name: string | Function, fn?: () => void) => {
        const cb = typeof _name === 'function' ? _name : fn;
        if (typeof cb === 'function') cb();
    }) as unknown as typeof import('vitest').describe;

    standardTests({
        it: stubIt,
        describe: stubDescribe,
        expect,
        execute: async () => undefined,
        ddl,
    });

    return { ran, skipped };
}

describe('standardTests gating via DDL.sortable_keys', () => {

    describe('arbitrary (ddl omitted)', () => {
        const { ran, skipped } = captureTestRegistrations();

        it('skips nothing', () => {
            expect(skipped).toEqual([]);
        });
        it('runs every test (sanity: standardTests has dozens of it() calls)', () => {
            expect(ran.length).toBeGreaterThan(20);
        });
    });

    describe('arbitrary (STANDARD_TEST_DDL has no sortable_keys)', () => {
        const { ran, skipped } = captureTestRegistrations(STANDARD_TEST_DDL);

        it('skips nothing', () => {
            expect(skipped).toEqual([]);
            expect(ran.length).toBeGreaterThan(20);
        });
    });

    describe('sortable_keys: [{ key: "age" }]', () => {
        const { ran, skipped } = captureTestRegistrations({
            ...STANDARD_TEST_DDL,
            lists: { '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 }, sortable_keys: [{ key: 'age' }] } },
        });

        it('runs tests using `age`', () => {
            expect(ran).toContain('sorts ascending by a numeric field');
            expect(ran).toContain('applies sort before limit');
            expect(ran).toContain('applies sort before offset');
            expect(ran).toContain('handles single-item array');
        });

        it('runs no-sort tests regardless', () => {
            expect(ran).toContain('returns all items unchanged when SortAndSlice is empty');
            expect(ran).toContain('returns at most N items when only limit is set (no sort)');
        });

        it('skips tests using disallowed single keys', () => {
            expect(skipped).toContain('sorts descending by a string field');                   // 'name'
            expect(skipped).toContain('places null sort values after all non-null (ascending)'); // 'value'
            expect(skipped).toContain('null-last applies regardless of sort direction');         // 'value' desc
            expect(skipped).toContain('deterministic order when all sort values are identical'); // 'score'
            expect(skipped).toContain('sorts by a dot-prop path into nested objects');           // 'sender.name'
        });

        it('skips multi-key tests when any key is disallowed', () => {
            expect(skipped).toContain('uses secondary key to break ties on primary');   // category, name
            expect(skipped).toContain('respects independent direction per key');        // category, date
        });

        it('skips PK-defaultSort tests when `id` is not in the allowlist', () => {
            expect(skipped).toContain('returns at most N items');                       // defaultSort 'id'
            expect(skipped).toContain('skips the first N items');
            expect(skipped).toContain('returns items after the cursor, excluding the cursor itself');
        });
    });

    describe('sortable_keys: [] (no user sort accepted)', () => {
        const { ran, skipped } = captureTestRegistrations({
            ...STANDARD_TEST_DDL,
            lists: { '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 }, sortable_keys: [] } },
        });

        it('runs no-sort tests', () => {
            expect(ran).toContain('returns all items unchanged when SortAndSlice is empty');
            expect(ran).toContain('returns at most N items when only limit is set (no sort)');
        });

        it('skips every test that requests a sort', () => {
            expect(skipped).toContain('sorts ascending by a numeric field');
            expect(skipped).toContain('returns at most N items');
            expect(skipped).toContain('returns items after the cursor, excluding the cursor itself');
            expect(skipped.length).toBeGreaterThan(20);
        });
    });

    describe('multi-key allowlist: [{ key: "category" }, { key: "name" }, { key: "date" }]', () => {
        const { ran, skipped } = captureTestRegistrations({
            ...STANDARD_TEST_DDL,
            lists: { '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 }, sortable_keys: [{ key: 'category' }, { key: 'name' }, { key: 'date' }] } },
        });

        it('runs multi-key tests when both keys are allowed', () => {
            expect(ran).toContain('uses secondary key to break ties on primary');   // category, name
            expect(ran).toContain('respects independent direction per key');        // category, date
        });

        it('skips tests using disallowed keys', () => {
            expect(skipped).toContain('sorts ascending by a numeric field'); // 'age' not allowed
            expect(skipped).toContain('returns at most N items');            // 'id' not allowed
        });
    });

    describe('dot-prop allowlist: [{ key: "sender.name" }]', () => {
        const { ran, skipped } = captureTestRegistrations({
            ...STANDARD_TEST_DDL,
            lists: { '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 }, sortable_keys: [{ key: 'sender.name' }] } },
        });

        it('matches dot-prop nested keys exactly', () => {
            expect(ran).toContain('sorts by a dot-prop path into nested objects');
            expect(skipped).toContain('sorts ascending by a numeric field');
        });
    });

    describe('direction-restricted rule: [{ key: "age", direction: -1 }]', () => {
        // Gating keys off `.key` only — a per-key `direction` restriction is a runtime concern
        // (`unsupported-ordering`), so it must register exactly the same tests as the unrestricted rule.
        const restricted = captureTestRegistrations({
            ...STANDARD_TEST_DDL,
            lists: { '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 }, sortable_keys: [{ key: 'age', direction: -1 as const }] } },
        });
        const unrestricted = captureTestRegistrations({
            ...STANDARD_TEST_DDL,
            lists: { '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 }, sortable_keys: [{ key: 'age' }] } },
        });

        it('runs the `age` tests (direction does not narrow the static gate)', () => {
            expect(restricted.ran).toContain('sorts ascending by a numeric field');
        });

        it('registers identically to the unrestricted rule', () => {
            expect(restricted.ran).toEqual(unrestricted.ran);
            expect(restricted.skipped).toEqual(unrestricted.skipped);
        });
    });
});
