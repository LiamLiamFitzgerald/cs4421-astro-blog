import { describe, expect, it } from "vitest";
import type { CatanEvent } from "./events";
import { evolve, replay } from "./evolve";
import { initialState } from "./state";

const started: CatanEvent = { type: "GameStarted", players: ["ana", "ben"] };

describe("Feature: match state is derived from events", () => {
  describe("Scenario: starting a game", () => {
    it("given a GameStarted event, gives every player an empty tally", () => {
      const state = replay([started]);

      expect(state.started).toBe(true);
      expect(state.playerOrder).toEqual(["ana", "ben"]);
      expect(state.players.ana).toEqual({
        settlements: 0,
        cities: 0,
        victoryPointCards: 0,
        knights: 0,
        roadLength: 0,
      });
      expect(state.players.ben).toEqual(state.players.ana);
    });

    it("given no events, is the initial state", () => {
      expect(replay([])).toEqual(initialState);
    });
  });

  describe("Scenario: building and upgrading", () => {
    it("given SettlementBuilt events, counts settlements per player", () => {
      const state = replay([
        started,
        { type: "SettlementBuilt", player: "ana" },
        { type: "SettlementBuilt", player: "ana" },
        { type: "SettlementBuilt", player: "ben" },
      ]);

      expect(state.players.ana?.settlements).toBe(2);
      expect(state.players.ben?.settlements).toBe(1);
    });

    it("given an upgrade, turns one settlement into a city", () => {
      const state = replay([
        started,
        { type: "SettlementBuilt", player: "ana" },
        { type: "SettlementBuilt", player: "ana" },
        { type: "SettlementUpgraded", player: "ana" },
      ]);

      expect(state.players.ana?.settlements).toBe(1);
      expect(state.players.ana?.cities).toBe(1);
    });

    it("given an upgrade with no settlement, ignores the event", () => {
      const state = replay([started, { type: "SettlementUpgraded", player: "ana" }]);

      expect(state.players.ana?.settlements).toBe(0);
      expect(state.players.ana?.cities).toBe(0);
    });
  });

  describe("Scenario: cards, knights and roads", () => {
    it("given a revealed VP card, counts it for that player", () => {
      const state = replay([started, { type: "VictoryPointCardRevealed", player: "ben" }]);

      expect(state.players.ben?.victoryPointCards).toBe(1);
    });

    it("given KnightPlayed events, counts knights for that player", () => {
      const state = replay([
        started,
        { type: "KnightPlayed", player: "ana" },
        { type: "KnightPlayed", player: "ana" },
      ]);

      expect(state.players.ana?.knights).toBe(2);
    });

    it("given RoadLengthRecorded events, keeps the latest length", () => {
      const state = replay([
        started,
        { type: "RoadLengthRecorded", player: "ana", length: 4 },
        { type: "RoadLengthRecorded", player: "ana", length: 2 },
      ]);

      expect(state.players.ana?.roadLength).toBe(2);
    });
  });

  describe("Scenario: robustness", () => {
    it("given an event for an unknown player, leaves state unchanged", () => {
      const before = replay([started]);
      const after = evolve(before, { type: "KnightPlayed", player: "zed" });

      expect(after).toEqual(before);
    });

    it("given the same events twice, produces identical state", () => {
      const events: CatanEvent[] = [
        started,
        { type: "SettlementBuilt", player: "ana" },
        { type: "KnightPlayed", player: "ben" },
      ];

      expect(replay(events)).toEqual(replay(events));
    });

    it("given a state, does not mutate it", () => {
      const before = replay([started]);
      const snapshot = JSON.stringify(before);

      evolve(before, { type: "SettlementBuilt", player: "ana" });

      expect(JSON.stringify(before)).toBe(snapshot);
    });
  });
});
