import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mulberry32, shuffle } from "./random";

describe("Feature: seeded randomness", () => {
  it("gives the same sequence for the same seed", () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("gives different sequences for different seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it("stays in [0, 1)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
        const next = mulberry32(seed);
        for (let i = 0; i < 20; i++) {
          const value = next();
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThan(1);
        }
      }),
    );
  });

  it("matches a known value (guards the board and deck against accidental change)", () => {
    expect(mulberry32(42)()).toBeCloseTo(0.6011037519, 9);
  });

  it("shuffles into a new array holding the same items", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = shuffle(items, mulberry32(3));
    expect(shuffled).not.toBe(items);
    expect([...shuffled].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("actually reorders", () => {
    const orders = new Set(Array.from({ length: 20 }, (_, s) => shuffle([1, 2, 3, 4, 5], mulberry32(s)).join()));
    expect(orders.size).toBeGreaterThan(10);
  });
});
