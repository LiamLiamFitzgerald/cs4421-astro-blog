import type { Terrain } from "../catan/board";

export type Resource = "lumber" | "brick" | "wool" | "grain" | "ore";

export const RESOURCES: readonly Resource[] = ["lumber", "brick", "wool", "grain", "ore"];

/** A count of each resource: a player's hand, the bank, or a cost. */
export type Hand = Readonly<Record<Resource, number>>;

export const emptyHand: Hand = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };

/** The bank starts with 19 cards of each resource. */
export const BANK_START: Hand = { lumber: 19, brick: 19, wool: 19, grain: 19, ore: 19 };

/** What each terrain produces. The desert produces nothing. */
export const PRODUCES: Readonly<Record<Terrain, Resource | null>> = {
  forest: "lumber",
  hills: "brick",
  pasture: "wool",
  fields: "grain",
  mountains: "ore",
  desert: null,
};

export function hand(partial: Partial<Record<Resource, number>>): Hand {
  return { ...emptyHand, ...partial };
}

export function addHands(a: Hand, b: Hand): Hand {
  return hand(Object.fromEntries(RESOURCES.map((r) => [r, a[r] + b[r]])));
}

export function subtractHands(a: Hand, b: Hand): Hand {
  return hand(Object.fromEntries(RESOURCES.map((r) => [r, a[r] - b[r]])));
}

export function handSize(h: Hand): number {
  return RESOURCES.reduce((total, r) => total + h[r], 0);
}

/** What is still needed to pay `cost` from `h` (all zero when it is affordable). */
export function missing(h: Hand, cost: Hand): Hand {
  return hand(Object.fromEntries(RESOURCES.map((r) => [r, Math.max(0, cost[r] - h[r])])));
}

export function canAfford(h: Hand, cost: Hand): boolean {
  return handSize(missing(h, cost)) === 0;
}
