import { describe, it, expect } from "vitest";
import {
    probeSetPropertyUndefined,
    commitSetPropertyUndefined,
    probeDeleteProperty,
    commitDeleteProperty,
} from "./applyPropertyPathWrite.ts";

describe("clearing and removing a property named by a path", () => {

    describe("what counts as a change", () => {

        it("clearing a property that holds a value changes the object", () => {
            expect(probeSetPropertyUndefined({ id: "1", text: "hi" }, "text")).toEqual({ changed: true });
        });

        it("clearing a property that is already undefined changes nothing", () => {
            expect(probeSetPropertyUndefined({ id: "1", text: undefined }, "text")).toEqual({ changed: false });
        });

        it("clearing a property that is absent changes nothing — the verb never introduces a key", () => {
            expect(probeSetPropertyUndefined({ id: "1" }, "text")).toEqual({ changed: false });
        });

        it("removing a property that holds a value changes the object", () => {
            expect(probeDeleteProperty({ id: "1", text: "hi" }, "text")).toEqual({ changed: true });
        });

        it("removing a property that is present but undefined changes the object — the key still goes", () => {
            expect(probeDeleteProperty({ id: "1", text: undefined }, "text")).toEqual({ changed: true });
        });

        it("removing a property that is absent changes nothing", () => {
            expect(probeDeleteProperty({ id: "1" }, "text")).toEqual({ changed: false });
        });

        it("an inherited property is not the object's own, so neither verb reports a change", () => {
            const item = Object.create({ inherited: "from the prototype" }) as Record<string, unknown>;
            item['id'] = "1";
            expect(probeSetPropertyUndefined(item, "inherited")).toEqual({ changed: false });
            expect(probeDeleteProperty(item, "inherited")).toEqual({ changed: false });
        });
    });

    describe("the outcome of committing", () => {

        it("clearing keeps the key and leaves it holding undefined", () => {
            const item: Record<string, unknown> = { id: "1", text: "hi" };
            commitSetPropertyUndefined(item, "text");
            expect(Object.hasOwn(item, "text")).toBe(true);
            expect(item['text']).toBe(undefined);
            expect(Object.keys(item)).toEqual(["id", "text"]);
        });

        it("removing takes the key away", () => {
            const item: Record<string, unknown> = { id: "1", text: "hi" };
            commitDeleteProperty(item, "text");
            expect(Object.hasOwn(item, "text")).toBe(false);
            expect(Object.keys(item)).toEqual(["id"]);
        });

        it("only the named property is touched", () => {
            const item: Record<string, unknown> = { id: "1", text: "hi", owner: "ann" };
            commitDeleteProperty(item, "text");
            expect(item).toEqual({ id: "1", owner: "ann" });
        });

        it("committing twice leaves the same outcome as committing once", () => {
            const once: Record<string, unknown> = { id: "1", text: "hi" };
            const twice: Record<string, unknown> = { id: "1", text: "hi" };
            commitDeleteProperty(once, "text");
            commitDeleteProperty(twice, "text");
            commitDeleteProperty(twice, "text");
            expect(Object.keys(twice)).toEqual(Object.keys(once));

            const clearedOnce: Record<string, unknown> = { id: "1", text: "hi" };
            const clearedTwice: Record<string, unknown> = { id: "1", text: "hi" };
            commitSetPropertyUndefined(clearedOnce, "text");
            commitSetPropertyUndefined(clearedTwice, "text");
            commitSetPropertyUndefined(clearedTwice, "text");
            expect(Object.keys(clearedTwice)).toEqual(Object.keys(clearedOnce));
            expect(clearedTwice['text']).toBe(clearedOnce['text']);
        });
    });

    describe("paths that reach into nested objects", () => {

        it("a nested property is located through the objects its leading segments name", () => {
            const item: Record<string, unknown> = { id: "1", meta: { badge: "gold", rank: 2 } };
            expect(probeDeleteProperty(item, "meta.badge")).toEqual({ changed: true });
            commitDeleteProperty(item, "meta.badge");
            expect(item['meta']).toEqual({ rank: 2 });
        });

        it("a key holding a literal dot is one segment when the dot is escaped", () => {
            const item: Record<string, unknown> = { id: "1", "rank.value": 7 };
            expect(probeDeleteProperty(item, "rank\\.value")).toEqual({ changed: true });
            commitDeleteProperty(item, "rank\\.value");
            expect(Object.hasOwn(item, "rank.value")).toBe(false);
        });

        it("an unescaped dot names two segments, so it reaches a different property entirely", () => {
            const item: Record<string, unknown> = { id: "1", "rank.value": 7 };
            expect(probeDeleteProperty(item, "rank.value")).toEqual({ changed: false });
            commitDeleteProperty(item, "rank.value");
            expect(item['rank.value']).toBe(7);
        });

        it("a missing object on the way is left alone rather than built", () => {
            const item: Record<string, unknown> = { id: "1" };
            expect(probeDeleteProperty(item, "meta.badge")).toEqual({ changed: false });
            expect(probeSetPropertyUndefined(item, "meta.badge")).toEqual({ changed: false });
            commitDeleteProperty(item, "meta.badge");
            commitSetPropertyUndefined(item, "meta.badge");
            expect(item).toEqual({ id: "1" });
            expect(Object.keys(item)).toEqual(["id"]);
        });

        it("an inherited object on the way stops the walk, so a shared prototype is never written through", () => {
            const shared = { meta: { badge: "gold" } };
            const item = Object.create(shared) as Record<string, unknown>;
            item['id'] = "1";

            expect(probeDeleteProperty(item, "meta.badge")).toEqual({ changed: false });
            commitDeleteProperty(item, "meta.badge");
            commitSetPropertyUndefined(item, "meta.badge");

            expect(shared.meta).toEqual({ badge: "gold" });
            expect(Object.keys(item)).toEqual(["id"]);
        });

        it("a non-object on the way stops the walk, so a scalar is never indexed into", () => {
            const item: Record<string, unknown> = { id: "1", meta: "not an object" };
            expect(probeDeleteProperty(item, "meta.badge")).toEqual({ changed: false });
            commitDeleteProperty(item, "meta.badge");
            expect(item['meta']).toBe("not an object");
        });

        it("an array on the way stops the walk — array contents are reached by scoping into the array", () => {
            const item: Record<string, unknown> = { id: "1", rows: [{ rid: "a", hint: "x" }] };
            expect(probeDeleteProperty(item, "rows.hint")).toEqual({ changed: false });
            commitDeleteProperty(item, "rows.hint");
            expect(item['rows']).toEqual([{ rid: "a", hint: "x" }]);
        });
    });

    describe("paths that must never be written, whatever the caller passes", () => {

        // Each fixture holds a real, reachable property behind the empty key, so a walk that treated `''` as
        // an ordinary key would visibly write to the wrong place rather than merely stopping early.
        it.each([
            ["a leading dot", ".text", { id: "1", "": { text: "behind the empty key" }, text: "hi" }],
            ["a trailing dot", "text.", { id: "1", text: { "": "behind the empty key" } }],
            ["a doubled dot", "meta..badge", { id: "1", meta: { "": { badge: "gold" } } }],
        ])("%s names an empty key, so nothing is written", (_label, path, fixture) => {
            const item: Record<string, unknown> = structuredClone(fixture);
            const before = structuredClone(fixture);
            expect(probeDeleteProperty(item, path)).toEqual({ changed: false });
            expect(probeSetPropertyUndefined(item, path)).toEqual({ changed: false });
            commitDeleteProperty(item, path);
            commitSetPropertyUndefined(item, path);
            expect(item).toEqual(before);
            expect(JSON.stringify(item)).toBe(JSON.stringify(before));
        });

        it.each(["__proto__", "prototype", "constructor"])("%s names inherited machinery, so nothing is written", (segment) => {
            const item: Record<string, unknown> = { id: "1" };
            expect(probeDeleteProperty(item, segment)).toEqual({ changed: false });
            expect(probeSetPropertyUndefined(item, segment)).toEqual({ changed: false });
            commitDeleteProperty(item, segment);
            commitSetPropertyUndefined(item, segment);
            expect(Object.keys(item)).toEqual(["id"]);
            // The prototype chain is intact, so ordinary objects are unaffected.
            expect(({} as Record<string, unknown>)['polluted']).toBe(undefined);
        });

        it("a disallowed segment part-way along a path stops the walk too", () => {
            const item: Record<string, unknown> = { id: "1", meta: { badge: "gold" } };
            expect(probeDeleteProperty(item, "constructor.badge")).toEqual({ changed: false });
            commitDeleteProperty(item, "constructor.badge");
            expect(item['meta']).toEqual({ badge: "gold" });
        });

        it("a path leading through __proto__ cannot reach the shared prototype every object inherits from", () => {
            const item: Record<string, unknown> = { id: "1" };
            expect(probeSetPropertyUndefined(item, "__proto__.polluted")).toEqual({ changed: false });
            commitSetPropertyUndefined(item, "__proto__.polluted");
            commitDeleteProperty(item, "__proto__.toString");

            expect("polluted" in ({} as Record<string, unknown>)).toBe(false);
            expect(typeof ({} as Record<string, unknown>)['toString']).toBe("function");
        });
    });

    describe("committing to a different object than the one probed", () => {

        it("the write lands in the object passed to commit, leaving the probed object untouched", () => {
            const source: Record<string, unknown> = { id: "1", meta: { badge: "gold" } };
            const clone = structuredClone(source);

            expect(probeDeleteProperty(source, "meta.badge")).toEqual({ changed: true });
            commitDeleteProperty(clone, "meta.badge");

            expect(source['meta']).toEqual({ badge: "gold" });
            expect(clone['meta']).toEqual({});
        });

        it("clearing likewise reaches only the object passed to commit", () => {
            const source: Record<string, unknown> = { id: "1", meta: { badge: "gold" } };
            const clone = structuredClone(source);

            expect(probeSetPropertyUndefined(source, "meta.badge")).toEqual({ changed: true });
            commitSetPropertyUndefined(clone, "meta.badge");

            expect((source['meta'] as Record<string, unknown>)['badge']).toBe("gold");
            expect(Object.hasOwn(clone['meta'] as Record<string, unknown>, "badge")).toBe(true);
            expect((clone['meta'] as Record<string, unknown>)['badge']).toBe(undefined);
        });
    });
});
