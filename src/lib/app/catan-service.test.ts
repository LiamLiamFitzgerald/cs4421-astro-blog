import { describe, expect, it } from "vitest";
import { MemoryEventStore } from "../adapters/memory-event-store";
import type { CatanEvent } from "../games/catan/events";
import { executeCommand, loadGame } from "./catan-service";

function newStore() {
  return new MemoryEventStore<CatanEvent>();
}

describe("Feature: running commands through the event store", () => {
  describe("Scenario: a valid command", () => {
    it("given a new game, StartGame stores the event and returns the state", async () => {
      const store = newStore();

      const result = await executeCommand(store, "g1", {
        type: "StartGame",
        players: ["ana", "ben"],
      });

      expect(result.ok).toBe(true);
      expect(await store.load("g1")).toEqual([
        { type: "GameStarted", players: ["ana", "ben"] },
      ]);
      if (result.ok) expect(result.value.playerOrder).toEqual(["ana", "ben"]);
    });

    it("given earlier events, a new command builds on the stored history", async () => {
      const store = newStore();
      await executeCommand(store, "g1", { type: "StartGame", players: ["ana", "ben"] });

      const result = await executeCommand(store, "g1", {
        type: "BuildSettlement",
        player: "ana",
      });

      expect(result.ok && result.value.players.ana?.settlements).toBe(1);
      expect(await store.load("g1")).toHaveLength(2);
    });
  });

  describe("Scenario: a rule violation", () => {
    it("given an invalid command, nothing is stored and the violation is returned", async () => {
      const store = newStore();
      await executeCommand(store, "g1", { type: "StartGame", players: ["ana", "ben"] });

      const result = await executeCommand(store, "g1", {
        type: "UpgradeSettlement",
        player: "ana",
      });

      expect(result).toMatchObject({ ok: false, error: { code: "NO_SETTLEMENT_TO_UPGRADE" } });
      expect(await store.load("g1")).toHaveLength(1);
    });
  });

  describe("Scenario: loading a game", () => {
    it("given stored events, loadGame replays them into state", async () => {
      const store = newStore();
      await executeCommand(store, "g1", { type: "StartGame", players: ["ana", "ben"] });
      await executeCommand(store, "g1", { type: "PlayKnight", player: "ben" });

      const state = await loadGame(store, "g1");

      expect(state.players.ben?.knights).toBe(1);
    });

    it("given an unknown game, loadGame returns the initial state", async () => {
      const state = await loadGame(newStore(), "nope");

      expect(state.started).toBe(false);
    });
  });
});
