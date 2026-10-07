import { describe, expect, it } from "vitest";
import type { CatanCommand } from "./commands";
import { decide } from "./decide";
import type { CatanEvent } from "./events";
import { replay } from "./evolve";

const started: CatanEvent = { type: "GameStarted", players: ["ana", "ben"] };

function when(given: CatanEvent[], command: CatanCommand) {
  return decide(replay(given), command);
}

describe("Feature: commands are validated against the rules", () => {
  describe("Scenario: starting a game", () => {
    it("given no game, StartGame returns a GameStarted event", () => {
      const result = when([], { type: "StartGame", players: ["ana", "ben"] });

      expect(result).toEqual({
        ok: true,
        value: [{ type: "GameStarted", players: ["ana", "ben"] }],
      });
    });

    it("given a started game, StartGame is rejected", () => {
      const result = when([started], { type: "StartGame", players: ["x", "y"] });

      expect(result).toMatchObject({ ok: false, error: { code: "GAME_ALREADY_STARTED" } });
    });

    it.each([
      ["a single player", ["ana"]],
      ["duplicate players", ["ana", "ana"]],
      ["a blank player id", ["ana", "  "]],
      ["more than six players", ["a", "b", "c", "d", "e", "f", "g"]],
    ])("given %s, StartGame is rejected", (_label, players) => {
      const result = when([], { type: "StartGame", players });

      expect(result).toMatchObject({ ok: false, error: { code: "INVALID_PLAYERS" } });
    });
  });

  describe("Scenario: acting before the game starts", () => {
    it("given no game, BuildSettlement is rejected", () => {
      const result = when([], { type: "BuildSettlement", player: "ana" });

      expect(result).toMatchObject({ ok: false, error: { code: "GAME_NOT_STARTED" } });
    });
  });

  describe("Scenario: unknown players", () => {
    it("given a player who is not in the game, the command is rejected", () => {
      const result = when([started], { type: "PlayKnight", player: "zed" });

      expect(result).toMatchObject({
        ok: false,
        error: { code: "UNKNOWN_PLAYER", player: "zed" },
      });
    });
  });

  describe("Scenario: normal actions", () => {
    it.each([
      [{ type: "BuildSettlement", player: "ana" }, "SettlementBuilt"],
      [{ type: "RevealVictoryPointCard", player: "ana" }, "VictoryPointCardRevealed"],
      [{ type: "PlayKnight", player: "ana" }, "KnightPlayed"],
    ] as const)("given a started game, %j returns %s", (command, eventType) => {
      const result = when([started], command);

      expect(result).toEqual({
        ok: true,
        value: [{ type: eventType, player: "ana" }],
      });
    });
  });

  describe("Scenario: upgrading a settlement", () => {
    it("given a settlement, UpgradeSettlement returns SettlementUpgraded", () => {
      const result = when(
        [started, { type: "SettlementBuilt", player: "ana" }],
        { type: "UpgradeSettlement", player: "ana" },
      );

      expect(result).toEqual({
        ok: true,
        value: [{ type: "SettlementUpgraded", player: "ana" }],
      });
    });

    it("given no settlement, UpgradeSettlement is rejected", () => {
      const result = when([started], { type: "UpgradeSettlement", player: "ana" });

      expect(result).toMatchObject({
        ok: false,
        error: { code: "NO_SETTLEMENT_TO_UPGRADE", player: "ana" },
      });
    });
  });

  describe("Scenario: recording road length", () => {
    it.each([0, 5, 15])("given a length of %i, the command is accepted", (length) => {
      const result = when([started], { type: "RecordRoadLength", player: "ana", length });

      expect(result).toEqual({
        ok: true,
        value: [{ type: "RoadLengthRecorded", player: "ana", length }],
      });
    });

    it.each([-1, 2.5, 16, Number.NaN])(
      "given a length of %s, the command is rejected",
      (length) => {
        const result = when([started], { type: "RecordRoadLength", player: "ana", length });

        expect(result).toMatchObject({ ok: false, error: { code: "INVALID_ROAD_LENGTH" } });
      },
    );
  });

  describe("Scenario: after the game is won", () => {
    it("given a winner, further commands are rejected", () => {
      const won: CatanEvent[] = [
        started,
        ...Array.from({ length: 5 }, () => ({ type: "SettlementBuilt", player: "ana" }) as const),
        ...Array.from({ length: 5 }, () => ({ type: "VictoryPointCardRevealed", player: "ana" }) as const),
      ];

      const result = when(won, { type: "PlayKnight", player: "ben" });

      expect(result).toMatchObject({
        ok: false,
        error: { code: "GAME_OVER", winner: "ana" },
      });
    });
  });

  describe("Scenario: purity", () => {
    it("given a state, decide does not mutate it", () => {
      const state = replay([started]);
      const snapshot = JSON.stringify(state);

      decide(state, { type: "BuildSettlement", player: "ana" });

      expect(JSON.stringify(state)).toBe(snapshot);
    });
  });
});
