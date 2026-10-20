import { describe, expect, it } from "vitest";
import type { CatanEvent } from "../games/catan/events";
import { replay } from "../games/catan/evolve";
import {
  buildScoreboard,
  describeEvent,
  describeFailure,
  describeViolation,
  parsePlayerNames,
  parseSeed,
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
    expect(describeViolation({ code: "INVALID_PLAYERS", reason: "a game needs 2 to 6 players" })).toBe(
      "A game needs 2 to 6 players.",
    );
  });

  it("describes events for the history list", () => {
    expect(describeEvent({ type: "KnightPlayed", player: "ana" })).toBe("ana played a knight");
    expect(describeEvent({ type: "GameStarted", players: ["ana", "ben"] })).toBe(
      "Game started: ana, ben",
    );
  });
});

describe("Feature: reading setup input", () => {
  it("trims names and ignores empty fields", () => {
    expect(parsePlayerNames([" Ana ", "", "Ben", "   "])).toEqual(["Ana", "Ben"]);
  });

  it("keeps duplicates so the rules can reject them", () => {
    expect(parsePlayerNames(["Ana", "Ana"])).toEqual(["Ana", "Ana"]);
  });

  it.each([
    ["42", 42],
    ["0", 0],
    [null, null],
    ["", null],
    ["-3", null],
    ["1.5", null],
    ["abc", null],
    ["12abc", null],
  ])("parses seed %j as %j", (input, expected) => {
    expect(parseSeed(input)).toBe(expected);
  });
});

describe("Feature: explaining unexpected failures", () => {
  const named = (name: string, message = "boom") => Object.assign(new Error(message), { name });

  it("explains full storage", () => {
    expect(describeFailure(named("QuotaExceededError")).title).toContain("storage is full");
  });

  it("explains blocked storage", () => {
    expect(describeFailure(named("SecurityError")).title).toContain("blocking storage");
  });

  it("falls back to a general message with a retry hint", () => {
    const failure = describeFailure(new TypeError("x is undefined"));
    expect(failure.title).toBe("Something went wrong and the action was not saved.");
    expect(failure.advice).toContain("Try again");
    expect(failure.detail).toBe("TypeError: x is undefined");
  });

  it("handles thrown values that are not errors", () => {
    expect(describeFailure("nope").detail).toBe("string: nope");
  });

  it("keeps the technical detail short", () => {
    expect(describeFailure(new Error("a".repeat(500))).detail.length).toBe(200);
  });
});
