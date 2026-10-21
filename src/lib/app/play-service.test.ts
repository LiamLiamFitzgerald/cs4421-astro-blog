import { describe, expect, it } from "vitest";
import { MemoryEventStore } from "../adapters/memory-event-store";
import type { PlayEvent } from "../games/catan-play/events";
import { executePlayCommand, loadPlay } from "./play-service";

describe("Feature: running play commands through the event store", () => {
  it("given a valid command, its events are stored and the new state is returned", async () => {
    const store = new MemoryEventStore<PlayEvent>();

    const result = await executePlayCommand(store, "g", { type: "StartGame", players: ["ana", "ben"], seed: 3 });

    expect(result.ok && result.value.state.players).toEqual(["ana", "ben"]);
    expect(result.ok && result.value.events.map((e) => e.type)).toEqual(["GameStarted"]);
    expect(await store.load("g")).toHaveLength(1);
    expect((await loadPlay(store, "g")).started).toBe(true);
  });

  it("given a refused command, nothing is stored", async () => {
    const store = new MemoryEventStore<PlayEvent>();

    const result = await executePlayCommand(store, "g", { type: "RollDice", player: "ana", dice: [1, 1] });

    expect(result).toEqual({ ok: false, error: { code: "GAME_NOT_STARTED" } });
    expect(await store.load("g")).toEqual([]);
  });
});
