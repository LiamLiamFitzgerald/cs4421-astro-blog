import { describe, expect, it } from "vitest";
import type { CatanEvent } from "./events";
import { replay } from "./evolve";
import { totalPoints } from "./score";
import { gameResult } from "./winner";

const started: CatanEvent = { type: "GameStarted", players: ["ana", "ben"] };
const settle = (player: string): CatanEvent => ({ type: "SettlementBuilt", player });
const upgrade = (player: string): CatanEvent => ({ type: "SettlementUpgraded", player });
const vpCard = (player: string): CatanEvent => ({ type: "VictoryPointCardRevealed", player });
const knight = (player: string): CatanEvent => ({ type: "KnightPlayed", player });
const road = (player: string, length: number): CatanEvent => ({
  type: "RoadLengthRecorded",
  player,
  length,
});

describe("Feature: game total and winner", () => {
  describe("Scenario: totals", () => {
    it("given pieces and awards, the total is base points plus award points", () => {
      const state = replay([
        started,
        settle("ana"),
        settle("ana"),
        upgrade("ana"),
        vpCard("ana"),
        knight("ana"),
        knight("ana"),
        knight("ana"),
      ]);

      // 1 settlement + 1 city (2) + 1 VP card + Largest Army (2) = 6
      expect(totalPoints(state, "ana")).toBe(6);
      expect(totalPoints(state, "ben")).toBe(0);
    });
  });

  describe("Scenario: reaching ten points", () => {
    it("given 10 points from pieces and cards, the player wins", () => {
      const state = replay([
        started,
        ...Array.from({ length: 5 }, () => settle("ana")),
        ...Array.from({ length: 5 }, () => vpCard("ana")),
      ]);

      expect(gameResult(state)).toEqual({ status: "won", winner: "ana" });
    });

    it("given 10 points that include an award, the player wins", () => {
      const state = replay([
        started,
        ...Array.from({ length: 4 }, () => settle("ben")),
        upgrade("ben"),
        upgrade("ben"),
        upgrade("ben"),
        upgrade("ben"),
        road("ben", 5),
      ]);

      expect(gameResult(state)).toEqual({ status: "won", winner: "ben" });
    });
  });

  describe("Scenario: nobody reaches ten", () => {
    it("given 9 points, the game is incomplete", () => {
      const state = replay([
        started,
        ...Array.from({ length: 5 }, () => settle("ana")),
        ...Array.from({ length: 4 }, () => vpCard("ana")),
      ]);

      expect(totalPoints(state, "ana")).toBe(9);
      expect(gameResult(state)).toEqual({ status: "incomplete" });
    });

    it("given no events, the game is incomplete", () => {
      expect(gameResult(replay([]))).toEqual({ status: "incomplete" });
    });
  });

  describe("Scenario: who wins when points arrive indirectly", () => {
    it("given an award passes to another player and lifts them to 10, they win", () => {
      const state = replay([
        started,
        road("ana", 6),
        ...Array.from({ length: 4 }, () => settle("ben")),
        upgrade("ben"),
        upgrade("ben"),
        upgrade("ben"),
        upgrade("ben"),
        road("ben", 5),
        road("ana", 4),
      ]);

      expect(gameResult(state)).toEqual({ status: "won", winner: "ben" });
    });
  });

  describe("Scenario: the winner is final", () => {
    it("given a winner, later events do not change the result", () => {
      const state = replay([
        started,
        ...Array.from({ length: 5 }, () => settle("ana")),
        ...Array.from({ length: 5 }, () => vpCard("ana")),
        ...Array.from({ length: 5 }, () => settle("ben")),
        ...Array.from({ length: 5 }, () => vpCard("ben")),
      ]);

      expect(gameResult(state)).toEqual({ status: "won", winner: "ana" });
    });
  });
});
