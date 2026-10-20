import { describe, expect, it } from "vitest";
import type { CatanEvent } from "../games/catan/events";
import { replay } from "../games/catan/evolve";
import {
  buildScoreboard,
  describeEvent,
  describeViolation,
} from "./scoreboard";

const log = (...events: CatanEvent[]) => replay(events);

describe("Feature: the scoreboard view", () => {
  describe("Scenario: rows follow seating order", () => {
    it("given a started game, every player has a zero row in order", () => {
      const rows = buildScoreboard(
        log({ type: "GameStarted", players: ["ana", "ben"] }),
      );

      expect(rows.map((row) => row.player)).toEqual(["ana", "ben"]);
      expect(rows.every((row) => row.points === 0)).toBe(true);
    });

    it("given no game, there are no rows", () => {
      expect(buildScoreboard(log())).toEqual([]);
    });
  });

  describe("Scenario: points and badges", () => {
    it("given a city and a settlement, the total is 3", () => {
      const rows = buildScoreboard(
        log(
          { type: "GameStarted", players: ["ana", "ben"] },
          { type: "SettlementBuilt", player: "ana" },
          { type: "SettlementBuilt", player: "ana" },
          { type: "SettlementUpgraded", player: "ana" },
        ),
      );

      expect(rows[0]).toMatchObject({ player: "ana", points: 3, cities: 1, settlements: 1 });
    });

    it("given a road of 5, the holder is flagged and gets award points", () => {
      const rows = buildScoreboard(
        log(
          { type: "GameStarted", players: ["ana", "ben"] },
          { type: "RoadLengthRecorded", player: "ben", length: 5 },
        ),
      );

      expect(rows[1]).toMatchObject({ hasLongestRoad: true, points: 2 });
      expect(rows[0]?.hasLongestRoad).toBe(false);
    });

    it("given ten points, the winner is flagged", () => {
      const rows = buildScoreboard(
        log(
          { type: "GameStarted", players: ["ana", "ben"] },
          ...Array.from({ length: 10 }, (): CatanEvent => ({ type: "VictoryPointCardRevealed", player: "ana" })),
        ),
      );

      expect(rows[0]).toMatchObject({ isWinner: true, points: 10 });
      expect(rows[1]?.isWinner).toBe(false);
    });
  });
});

describe("Feature: readable messages", () => {
  it("explains a rule violation", () => {
    expect(describeViolation({ code: "NO_SETTLEMENT_TO_UPGRADE", player: "ana" })).toBe(
      "ana has no settlement to upgrade.",
    );
    expect(describeViolation({ code: "GAME_OVER", winner: "ben" })).toContain("ben");
    expect(describeViolation({ code: "INVALID_SEED", seed: -1 })).toBe("-1 is not a valid board seed.");
  });

  it("describes events for the history list", () => {
    expect(describeEvent({ type: "KnightPlayed", player: "ana" })).toBe("ana played a knight");
    expect(describeEvent({ type: "GameStarted", players: ["ana", "ben"] })).toBe(
      "Game started: ana, ben",
    );
  });
});
