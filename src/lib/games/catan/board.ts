import { mulberry32, shuffle } from "../../core/random";

/**
 * The base-game board: 19 terrain hexes and 18 number tokens, dealt from a seed.
 *
 * Pure and deterministic: the same seed always gives the same board. The board
 * itself (not the seed) is stored in the GameStarted event, so a stored game
 * replays identically even if this generator changes. See ADR-003.
 */

export type Terrain = "forest" | "pasture" | "fields" | "hills" | "mountains" | "desert";

/** A hex in axial coordinates (q, r); the centre hex is (0, 0). */
export interface Hex {
  readonly q: number;
  readonly r: number;
  readonly terrain: Terrain;
  /** Dice number that makes this hex produce, or null for the desert. */
  readonly token: number | null;
}

export interface Board {
  readonly hexes: readonly Hex[];
}

/** How many of each terrain the base game has. */
export const TERRAIN_COUNTS: Readonly<Record<Terrain, number>> = {
  forest: 4,
  pasture: 4,
  fields: 4,
  hills: 3,
  mountains: 3,
  desert: 1,
};

/** The base game's number tokens: one 2 and 12, two of each of 3–6 and 8–11. */
export const NUMBER_TOKENS: readonly number[] = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

/** The two most likely rolls. The rules keep them off neighbouring hexes. */
export const RED_NUMBERS: readonly number[] = [6, 8];

/** Largest seed accepted: seeds are unsigned 32-bit integers. */
export const MAX_SEED = 0xffffffff;

const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

/** The 19 positions of the base board: every hex within two steps of the centre. */
export const BOARD_POSITIONS: readonly (readonly [number, number])[] = (() => {
  const positions: [number, number][] = [];
  for (let r = -2; r <= 2; r++) {
    for (let q = -2; q <= 2; q++) {
      if (Math.abs(q + r) <= 2) positions.push([q, r]);
    }
  }
  return positions;
})();

export function isValidSeed(seed: number): boolean {
  return Number.isInteger(seed) && seed >= 0 && seed <= MAX_SEED;
}

/** True when two hexes share an edge. */
export function areNeighbours(a: Pick<Hex, "q" | "r">, b: Pick<Hex, "q" | "r">): boolean {
  return DIRECTIONS.some(([dq, dr]) => a.q + dq === b.q && a.r + dr === b.r);
}

/** True when no two red-number hexes are neighbours. */
export function redNumbersApart(board: Board): boolean {
  const red = board.hexes.filter((hex) => hex.token !== null && RED_NUMBERS.includes(hex.token));
  return red.every((a, i) => red.slice(i + 1).every((b) => !areNeighbours(a, b)));
}

/** Deals a legal base-game board from a seed. Requires `isValidSeed(seed)`. */
export function generateBoard(seed: number): Board {
  const random = mulberry32(seed);
  const terrains = (Object.keys(TERRAIN_COUNTS) as Terrain[]).flatMap((terrain) =>
    Array.from({ length: TERRAIN_COUNTS[terrain] }, () => terrain),
  );
  // Rejection sampling: about a third of random deals keep 6s and 8s apart,
  // so this settles after a few tries. The random stream continues between
  // tries, so the result is still a pure function of the seed.
  for (;;) {
    const board = deal(shuffle(terrains, random), shuffle(NUMBER_TOKENS, random));
    if (redNumbersApart(board)) return board;
  }
}

function deal(terrains: readonly Terrain[], tokens: readonly number[]): Board {
  let next = 0;
  const hexes = BOARD_POSITIONS.map(([q, r], i): Hex => {
    const terrain = terrains[i] ?? "desert";
    const token = terrain === "desert" ? null : (tokens[next++] ?? null);
    return { q, r, terrain, token };
  });
  return { hexes };
}
