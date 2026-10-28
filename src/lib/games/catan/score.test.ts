import { describe, expect, it } from "vitest";
import type { CatanEvent } from "./events";
import { replay } from "./evolve";
import { baseScoreboard, basePoints } from "./score";

const started: CatanEvent = { type: "GameStarted", players: ["ana", "ben"] };

describe("Feature: base victory points", () => {
  describe("Scenario: tallying one player", () => {
    it("given 2 settlements, 1 city and 1 VP card, returns 5", () => {
      const state = replay([
        started,
        { type: "SettlementBuilt", player: "ana" },
        { type: "SettlementBuilt", player: "ana" },
        { type: "SettlementBuilt", player: "ana" },
        { type: "SettlementUpgraded", player: "ana" },
        { type: "VictoryPointCardRevealed", player: "ana" },
      ]);

      expect(basePoints(state.players.ana!)).toBe(5);
    });

    it("given no pieces, returns 0", () => {
      const state = replay([started]);

      expect(basePoints(state.players.ana!)).toBe(0);
    });

    it("given an upgrade, counts the city for 2 and not the settlement it replaced", () => {
      const state = replay([
        started,
        { type: "SettlementBuilt", player: "ben" },
        { type: "SettlementUpgraded", player: "ben" },
      ]);

      expect(basePoints(state.players.ben!)).toBe(2);
    });
  });

  describe("Scenario: scoreboard for every player", () => {
    it("given a game in progress, scores each player independently", () => {
      const state = replay([
        started,
        { type: "SettlementBuilt", player: "ana" },
        { type: "VictoryPointCardRevealed", player: "ben" },
        { type: "VictoryPointCardRevealed", player: "ben" },
      ]);

      expect(baseScoreboard(state)).toEqual({ ana: 1, ben: 2 });
    });
  });
});
