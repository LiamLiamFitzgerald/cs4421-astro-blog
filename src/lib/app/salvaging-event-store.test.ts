import { describe, expect, it, vi } from "vitest";
import { MemoryEventStore } from "../adapters/memory-event-store";
import type { PlayEvent } from "../games/catan-play/events";
import { completeSetup, play } from "../games/catan-play/test-helpers";
import type { EventStore } from "./event-store";
import { type SalvageReport, SalvagingPlayStore } from "./salvaging-event-store";

const log = () => completeSetup(play([{ type: "StartGame", players: ["ana", "ben"], seed: 3 }]));

/** A memory store that can also clear, like the browser adapter. */
class ClearableMemory implements EventStore<PlayEvent> {
  private readonly logs = new Map<string, PlayEvent[]>();
  async append(id: string, events: readonly PlayEvent[]) {
    this.logs.set(id, [...(this.logs.get(id) ?? []), ...events]);
  }
  async load(id: string) {
    return [...(this.logs.get(id) ?? [])];
  }
  clear(id: string) {
    this.logs.delete(id);
  }
}

const damaged = (events: readonly PlayEvent[]) => [...events.slice(0, 6), { type: "Gibberish" } as unknown as PlayEvent, ...events.slice(6)];

describe("Feature: a damaged save does not lose the whole game", () => {
  it("given a sound log, loads it untouched and reports nothing", async () => {
    const onProblem = vi.fn();
    const inner = new ClearableMemory();
    await inner.append("g", log());
    const store = new SalvagingPlayStore(inner, onProblem);

    expect(await store.load("g")).toEqual(log());
    expect(onProblem).not.toHaveBeenCalled();
  });

  it("given an unreadable event, keeps the events before it and cuts the saved game back", async () => {
    const reports: SalvageReport[] = [];
    const inner = new ClearableMemory();
    await inner.append("g", damaged(log()));
    const store = new SalvagingPlayStore(inner, (r) => reports.push(r));

    const loaded = await store.load("g");

    expect(loaded).toEqual(log().slice(0, 6));
    expect(await inner.load("g")).toEqual(log().slice(0, 6));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ gameId: "g", salvaged: true, kept: 6 });
    expect(reports[0]?.stored).toHaveLength(damaged(log()).length);
    expect(reports[0]?.problems[0]).toMatchObject({ kind: "unreadable-event", index: 6 });
  });

  it("reports the same damage only once however often the page loads", async () => {
    const onProblem = vi.fn();
    const inner = new ClearableMemory();
    await inner.append("g", damaged(log()));
    const store = new SalvagingPlayStore(inner, onProblem);

    await store.load("g");
    await store.load("g");
    await store.load("g");

    expect(onProblem).toHaveBeenCalledTimes(1);
  });

  it("given a store that cannot delete, still returns the good events and keeps reporting once", async () => {
    const onProblem = vi.fn();
    const inner = new MemoryEventStore<PlayEvent>();
    await inner.append("g", damaged(log()));
    const store = new SalvagingPlayStore(inner, onProblem);

    expect(await store.load("g")).toEqual(log().slice(0, 6));
    expect(await store.load("g")).toEqual(log().slice(0, 6));
    expect(onProblem).toHaveBeenCalledTimes(1);
    expect(await inner.load("g")).toHaveLength(damaged(log()).length);
  });

  it("given a log that breaks a rule of the game, reports it but keeps every event", async () => {
    const reports: SalvageReport[] = [];
    const inner = new ClearableMemory();
    const overdraft: PlayEvent = { type: "BankTraded", player: "ana", give: "ore", get: "grain" };
    await inner.append("g", [...log(), overdraft]);
    const store = new SalvagingPlayStore(inner, (r) => reports.push(r));

    expect(await store.load("g")).toHaveLength(log().length + 1);
    expect(reports[0]).toMatchObject({ salvaged: false });
    expect(reports[0]?.problems[0]).toMatchObject({ kind: "invariant", index: log().length });
  });

  it("appends through to the store", async () => {
    const inner = new ClearableMemory();
    const store = new SalvagingPlayStore(inner, vi.fn());
    await store.append("g", log());
    expect(await inner.load("g")).toEqual(log());
  });

  it("clears the saved game and forgets the snapshot", async () => {
    const inner = new ClearableMemory();
    await inner.append("g", log());
    const store = new SalvagingPlayStore(inner, vi.fn());
    await store.load("g");
    expect(store.snapshot()?.events).toHaveLength(log().length);

    store.clear("g");

    expect(await inner.load("g")).toEqual([]);
    expect(store.snapshot()).toBeNull();
  });

  it("offers the last loaded log for attaching to an error report, until something is appended", async () => {
    const inner = new ClearableMemory();
    await inner.append("g", log());
    const store = new SalvagingPlayStore(inner, vi.fn());
    expect(store.snapshot()).toBeNull();

    await store.load("g");
    expect(store.snapshot()).toEqual({ gameId: "g", events: log() });

    await store.append("g", [{ type: "TurnEnded", player: "ana" }]);
    expect(store.snapshot()).toBeNull();
  });
});
