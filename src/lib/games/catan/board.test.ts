import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  areNeighbours,
  BOARD_POSITIONS,
  type Board,
  generateBoard,
  isValidSeed,
  MAX_SEED,
  NUMBER_TOKENS,
  redNumbersApart,
  TERRAIN_COUNTS,
} from "./board";

const seed = fc.integer({ min: 0, max: MAX_SEED });
const RUNS = { numRuns: 300 };

const countBy = <T>(items: readonly T[]) =>
  items.reduce<Map<T, number>>((counts, item) => counts.set(item, (counts.get(item) ?? 0) + 1), new Map());

const sorted = (values: readonly number[]) => [...values].sort((a, b) => a - b);

describe("Feature: dealing the base-game board", () => {
  describe("Scenario: board shape", () => {
    it("has 19 distinct positions within two steps of the centre", () => {
      expect(BOARD_POSITIONS).toHaveLength(19);
      expect(new Set(BOARD_POSITIONS.map(([q, r]) => `${q},${r}`)).size).toBe(19);
      for (const [q, r] of BOARD_POSITIONS) {
        expect(Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r))).toBeLessThanOrEqual(2);
      }
    });

    it("includes the centre and the six corners", () => {
      const keys = BOARD_POSITIONS.map(([q, r]) => `${q},${r}`);
      for (const key of ["0,0", "2,0", "-2,0", "0,2", "0,-2", "2,-2", "-2,2"]) {
        expect(keys).toContain(key);
      }
    });
  });

  describe("Scenario: neighbours", () => {
    it.each([
      [1, 0],
      [1, -1],
      [0, -1],
      [-1, 0],
      [-1, 1],
      [0, 1],
    ])("the centre neighbours (%i, %i)", (q, r) => {
      expect(areNeighbours({ q: 0, r: 0 }, { q, r })).toBe(true);
    });

    it.each([
      [0, 0],
      [2, 0],
      [1, 1],
      [-1, -1],
      [2, -1],
    ])("the centre does not neighbour (%i, %i)", (q, r) => {
      expect(areNeighbours({ q: 0, r: 0 }, { q, r })).toBe(false);
    });
  });

  describe("Scenario: red numbers", () => {
    const board = (tokens: [number, number, number | null][]): Board => ({
      hexes: tokens.map(([q, r, token]) => ({ q, r, terrain: "fields", token })),
    });

    it("given a 6 next to an 8, the board is rejected", () => {
      expect(redNumbersApart(board([[0, 0, 6], [1, 0, 8]]))).toBe(false);
    });

    it("given two 6s side by side, the board is rejected", () => {
      expect(redNumbersApart(board([[0, 0, 6], [0, 1, 6]]))).toBe(false);
    });

    it("given red numbers two steps apart, the board is accepted", () => {
      expect(redNumbersApart(board([[0, 0, 6], [2, 0, 8], [1, 0, 5]]))).toBe(true);
    });

    it("given a red number next to other numbers or the desert, the board is accepted", () => {
      expect(redNumbersApart(board([[0, 0, 6], [1, 0, 5], [0, 1, null]]))).toBe(true);
    });
  });

  describe("Scenario: seeds", () => {
    it.each([0, 1, MAX_SEED])("accepts %d", (value) => expect(isValidSeed(value)).toBe(true));
    it.each([-1, MAX_SEED + 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects %d", (value) =>
      expect(isValidSeed(value)).toBe(false),
    );
  });

  describe("Scenario: every dealt board is legal (property)", () => {
    it("uses each board position exactly once", () => {
      fc.assert(
        fc.property(seed, (s) => {
          const keys = generateBoard(s).hexes.map((h) => `${h.q},${h.r}`);
          expect(keys).toHaveLength(19);
          expect(new Set(keys)).toEqual(new Set(BOARD_POSITIONS.map(([q, r]) => `${q},${r}`)));
        }),
        RUNS,
      );
    });

    it("has the standard terrain counts", () => {
      fc.assert(
        fc.property(seed, (s) => {
          const counts = countBy(generateBoard(s).hexes.map((h) => h.terrain));
          expect(Object.fromEntries(counts)).toEqual(TERRAIN_COUNTS);
        }),
        RUNS,
      );
    });

    it("has the standard tokens, with none on the desert", () => {
      fc.assert(
        fc.property(seed, (s) => {
          const hexes = generateBoard(s).hexes;
          const tokens = hexes.flatMap((h) => (h.token === null ? [] : [h.token]));
          expect(sorted(tokens)).toEqual(sorted(NUMBER_TOKENS));
          expect(hexes.find((h) => h.terrain === "desert")?.token).toBeNull();
          expect(hexes.filter((h) => h.token === null)).toHaveLength(1);
        }),
        RUNS,
      );
    });

    it("never puts red numbers side by side", () => {
      fc.assert(
        fc.property(seed, (s) => {
          expect(redNumbersApart(generateBoard(s))).toBe(true);
        }),
        RUNS,
      );
    });

    it("is deterministic: the same seed deals the same board", () => {
      fc.assert(
        fc.property(seed, (s) => {
          expect(generateBoard(s)).toEqual(generateBoard(s));
        }),
        RUNS,
      );
    });
  });

  describe("Scenario: variety", () => {
    it("different seeds deal different boards", () => {
      const layouts = new Set(
        Array.from({ length: 50 }, (_, s) => JSON.stringify(generateBoard(s))),
      );
      expect(layouts.size).toBeGreaterThan(45);
    });

    it("the desert is not always in the same place", () => {
      const deserts = new Set(
        Array.from({ length: 60 }, (_, s) => {
          const desert = generateBoard(s).hexes.find((h) => h.terrain === "desert");
          return `${desert?.q},${desert?.r}`;
        }),
      );
      expect(deserts.size).toBeGreaterThan(8);
    });

    it("a known seed deals a known board (guards against accidental changes)", () => {
      expect(generateBoard(42)).toMatchSnapshot();
    });
  });
});
