import { describe, it, expect, vi } from 'vitest';
import { ObjectsDeltaEmitter } from './ObjectsDeltaEmitter.ts';
import type { ObjectsDelta } from './types.ts';

// Mock data type for our tests
type TestItem = {
    id: number;
    value: string;
    nested?: {
        prop: string;
    };
};

describe('ObjectsDeltaEmitter', () => {

    it('should correctly identify and emit deltas when using deep equality (useDeepEqual: true)', () => {
        // 1. Setup
        const viewDeltaEmitter = new ObjectsDeltaEmitter<TestItem>('id', { useDeepEqual: true });
        const listener = vi.fn();
        viewDeltaEmitter.on('UPDATE_DELTA', listener);

        const initialItems: TestItem[] = [{ id: 1, value: 'A' }, { id: 2, value: 'B' }];
        const updatedItems: TestItem[] = [
            { id: 1, value: 'A_modified' }, // Updated
            { id: 3, value: 'C' }          // Added
            // Item with id: 2 is removed
        ];

        // 2. Initial update
        viewDeltaEmitter.update(initialItems);

        // 3. Second update to generate a delta
        viewDeltaEmitter.update(updatedItems);

        // 4. Assertions
        expect(listener).toHaveBeenCalledTimes(2);

        const expectedInitialDelta: ObjectsDelta<TestItem> = {
            added: [{ id: 1, value: 'A' }, { id: 2, value: 'B' }],
            updated: [],
            removed: [],
        };
        expect(listener).toHaveBeenNthCalledWith(1, expectedInitialDelta);

        const expectedSecondDelta: ObjectsDelta<TestItem> = {
            added: [{ id: 3, value: 'C' }],
            updated: [{ id: 1, value: 'A_modified' }],
            removed: [{ id: 2, value: 'B' }],
        };
        expect(listener).toHaveBeenNthCalledWith(2, expectedSecondDelta);
    });

    it('should correctly identify and emit deltas when using referential equality (useDeepEqual: false)', () => {
        // 1. Setup
        const viewDeltaEmitter = new ObjectsDeltaEmitter<TestItem>('id', { useDeepEqual: false });
        const listener = vi.fn();
        viewDeltaEmitter.on('UPDATE_DELTA', listener);

        const item1 = { id: 1, value: 'A' };
        const item2 = { id: 2, value: 'B' };
        const initialItems: TestItem[] = [item1, item2];

        // Create a new object for the updated item to break reference equality
        const item1Updated = { id: 1, value: 'A_modified' };
        const item3 = { id: 3, value: 'C' };
        const updatedItems: TestItem[] = [item1Updated, item3];

        // 2. Actions
        viewDeltaEmitter.update(initialItems);
        viewDeltaEmitter.update(updatedItems);

        // 3. Assertions
        expect(listener).toHaveBeenCalledTimes(2);

        const expectedDelta: ObjectsDelta<TestItem> = {
            added: [item3],
            updated: [item1Updated],
            removed: [item2],
        };
        expect(listener).toHaveBeenLastCalledWith(expectedDelta);
    });

    it('should NOT emit an UPDATE_DELTA event if there are no changes', () => {
        // 1. Setup
        const viewDeltaEmitter = new ObjectsDeltaEmitter<TestItem>('id', { useDeepEqual: true });
        const listener = vi.fn();
        viewDeltaEmitter.on('UPDATE_DELTA', listener);

        const initialItems: TestItem[] = [{ id: 1, value: 'A' }];

        // 2. Actions
        viewDeltaEmitter.update(initialItems); // First call, should emit
        viewDeltaEmitter.update(initialItems); // Second call with same data, should NOT emit

        // 3. Assertions
        expect(listener).toHaveBeenCalledOnce();
        const expectedDelta: ObjectsDelta<TestItem> = {
            added: [{ id: 1, value: 'A' }],
            updated: [],
            removed: [],
        };
        expect(listener).toHaveBeenCalledWith(expectedDelta);
    });

    it('should not detect an update with useDeepEqual: false if the object reference has not changed', () => {
        // 1. Setup
        const viewDeltaEmitter = new ObjectsDeltaEmitter<TestItem>('id', { useDeepEqual: false });
        const listener = vi.fn();
        viewDeltaEmitter.on('UPDATE_DELTA', listener);

        const item1 = { id: 1, value: 'A' };
        const initialItems: TestItem[] = [item1];

        // 2. Actions
        viewDeltaEmitter.update(initialItems);

        // Mutate the original object
        item1.value = 'A_modified';
        viewDeltaEmitter.update(initialItems); // Pass the same array reference again

        // 3. Assertions
        // The listener should only have been called once, for the initial add.
        // The second update should not trigger an emit because referential equality is used,
        // and the object reference for item1 is still the same.
        expect(listener).toHaveBeenCalledOnce();
    });

    it('should emit a deep clone of the delta to prevent downstream mutations', () => {
        // 1. Setup
        const viewDeltaEmitter = new ObjectsDeltaEmitter<TestItem>('id', { useDeepEqual: true });
        const capturedDelta: ObjectsDelta<TestItem>[] = [];
        viewDeltaEmitter.on('UPDATE_DELTA', (delta) => {
            capturedDelta.push(delta);
        });

        const originalItem = { id: 1, value: 'A', nested: { prop: 'original' } };
        const items = [originalItem];

        // 2. Action
        viewDeltaEmitter.update(items);

        // 3. Assertion
        expect(capturedDelta.length).toBe(1);

        const delta = capturedDelta[0]!;
        const addedItemInDelta = delta.added[0]!;

        // Check that the object in the delta is not the same reference as the original
        expect(addedItemInDelta).not.toBe(originalItem);
        expect(addedItemInDelta.nested).not.toBe(originalItem.nested);
        // Verify it's a deep copy with the same values
        expect(addedItemInDelta).toEqual(originalItem);

        // Prove that mutating the delta does not affect the emitter's internal state
        addedItemInDelta.value = 'mutated';
        addedItemInDelta.nested!.prop = 'mutated';

        // Update with an empty array to see what is reported as "removed"
        viewDeltaEmitter.update([]);
        const secondDelta = capturedDelta[1]!;

        // The "removed" item should be the original, unmodified object, not the mutated one.
        expect(secondDelta.removed[0]!.value).toBe('A');
        expect(secondDelta.removed[0]!.nested?.prop).toBe('original');
    });
});