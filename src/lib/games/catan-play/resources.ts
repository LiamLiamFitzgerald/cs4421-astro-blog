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

export type Piece = "road" | "settlement" | "city";

/** What each piece costs. */
export const COSTS: Readonly<Record<Piece, Hand>> = {
  road: { ...emptyHand, lumber: 1, brick: 1 },
  settlement: { ...emptyHand, lumber: 1, brick: 1, wool: 1, grain: 1 },
  city: { ...emptyHand, grain: 2, ore: 3 },
};

/** How many of each piece a player owns. */
export const PIECE_LIMITS: Readonly<Record<Piece, number>> = { road: 15, settlement: 5, city: 4 };

/** Cards given to the bank for one card of another resource. */
export const BANK_TRADE_RATE = 4;

export function isResource(value: string): value is Resource {
  return (RESOURCES as readonly string[]).includes(value);
}
