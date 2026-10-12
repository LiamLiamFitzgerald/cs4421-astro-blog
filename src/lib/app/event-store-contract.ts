import { describe, expect, it } from "vitest";
import type { EventStore } from "./event-store";

type TestEvent = { readonly type: string; readonly n: number };

/**
 * Behaviour every EventStore adapter must have. Call it from an adapter's own
 * test file with a factory that returns a fresh, empty store.
 */
export function describeEventStoreContract(
  name: string,
  createStore: () => EventStore<TestEvent>,
): void {
  describe(`Feature: ${name} behaves as an EventStore`, () => {
    describe("Scenario: loading", () => {
      it("given a game that has no events, load returns an empty list", async () => {
        const store = createStore();

        expect(await store.load("g1")).toEqual([]);
      });
    });

    describe("Scenario: appending", () => {
      it("given appended events, load returns them in order", async () => {
        const store = createStore();

        await store.append("g1", [
          { type: "a", n: 1 },
          { type: "b", n: 2 },
        ]);

        expect(await store.load("g1")).toEqual([
          { type: "a", n: 1 },
          { type: "b", n: 2 },
        ]);
      });

      it("given several appends, events accumulate in append order", async () => {
        const store = createStore();

        await store.append("g1", [{ type: "a", n: 1 }]);
        await store.append("g1", [{ type: "b", n: 2 }]);
        await store.append("g1", []);

        expect((await store.load("g1")).map((e) => e.n)).toEqual([1, 2]);
      });
    });

    describe("Scenario: separate games", () => {
      it("given events for two games, each game only sees its own", async () => {
        const store = createStore();

        await store.append("g1", [{ type: "a", n: 1 }]);
        await store.append("g2", [{ type: "b", n: 2 }]);

        expect(await store.load("g1")).toEqual([{ type: "a", n: 1 }]);
        expect(await store.load("g2")).toEqual([{ type: "b", n: 2 }]);
      });
    });

    describe("Scenario: isolation from callers", () => {
      it("given a loaded list is changed, the store is unaffected", async () => {
        const store = createStore();
        await store.append("g1", [{ type: "a", n: 1 }]);

        const loaded = (await store.load("g1")) as TestEvent[];
        loaded.push({ type: "x", n: 99 });

        expect(await store.load("g1")).toEqual([{ type: "a", n: 1 }]);
      });

      it("given the appended array is changed afterwards, the store is unaffected", async () => {
        const store = createStore();
        const events: TestEvent[] = [{ type: "a", n: 1 }];

        await store.append("g1", events);
        events.push({ type: "x", n: 99 });

        expect(await store.load("g1")).toEqual([{ type: "a", n: 1 }]);
      });
    });
  });
}
