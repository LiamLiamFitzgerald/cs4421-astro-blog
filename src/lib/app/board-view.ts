import type { Board, Hex, Terrain } from "../games/catan/board";
import { RED_NUMBERS } from "../games/catan/board";

/** What a terrain is called and what it produces, as players say it. */
export const TERRAIN_NAMES: Readonly<Record<Terrain, { name: string; resource: string | null }>> = {
  forest: { name: "Forest", resource: "lumber" },
  pasture: { name: "Pasture", resource: "wool" },
  fields: { name: "Fields", resource: "grain" },
  hills: { name: "Hills", resource: "brick" },
  mountains: { name: "Mountains", resource: "ore" },
  desert: { name: "Desert", resource: null },
};

/** One hex, ready to draw: centre, corner points and token details. */
export interface HexView {
  readonly key: string;
  readonly terrain: Terrain;
  readonly cx: number;
  readonly cy: number;
  /** SVG polygon points, corners clockwise from the top. */
  readonly points: string;
  /** A slightly smaller outline, drawn as a bevel so tiles read as pieces of card. */
  readonly inner: string;
  readonly token: number | null;
  /** 6 and 8, the most likely rolls, are printed in red. */
  readonly red: boolean;
  /** Dots under the number: how many of the 36 dice outcomes roll it. */
  readonly pips: number;
  /** Text alternative, for example "Forest, lumber, 8". */
  readonly label: string;
}

export interface BoardView {
  readonly hexes: readonly HexView[];
  readonly viewBox: string;
  /** Points of the sea frame around the island. */
  readonly sea: string;
  /** A fine line just inside the frame, like the edge of a printed map. */
  readonly coast: string;
}

const SQRT3 = Math.sqrt(3);

/** Number of two-dice outcomes that roll `n` (0 outside 2–12). */
export function pipCount(n: number): number {
  return n >= 2 && n <= 12 ? 6 - Math.abs(7 - n) : 0;
}

export function hexLabel(hex: Pick<Hex, "terrain" | "token">): string {
  const { name, resource } = TERRAIN_NAMES[hex.terrain];
  return [name, resource, hex.token].filter((part) => part !== null).join(", ");
}

const round = (n: number) => Math.round(n * 100) / 100;

function polygon(cx: number, cy: number, radius: number, startDegrees: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = ((startDegrees + 60 * i) * Math.PI) / 180;
    return `${round(cx + radius * Math.cos(angle))},${round(cy + radius * Math.sin(angle))}`;
  }).join(" ");
}

/**
 * Lays out a board as pointy-top hexes of the given radius, centred on (0, 0).
 * Pure geometry: no DOM, so it is unit-tested and shared by every page.
 */
export function boardView(board: Board, size = 50): BoardView {
  const hexes = board.hexes.map((hex): HexView => {
    const cx = round(size * SQRT3 * (hex.q + hex.r / 2));
    const cy = round(size * 1.5 * hex.r);
    return {
      key: `${hex.q},${hex.r}`,
      terrain: hex.terrain,
      cx,
      cy,
      points: polygon(cx, cy, size * 0.97, -90),
      inner: polygon(cx, cy, size * 0.86, -90),
      token: hex.token,
      red: hex.token !== null && RED_NUMBERS.includes(hex.token),
      pips: hex.token === null ? 0 : pipCount(hex.token),
      label: hexLabel(hex),
    };
  });
  const seaRadius = size * 5.25;
  // The sea frame is flat-topped, so it is wider than it is tall.
  const halfWidth = round(seaRadius + size * 0.1);
  const halfHeight = round((seaRadius * SQRT3) / 2 + size * 0.1);
  return {
    hexes,
    viewBox: `${-halfWidth} ${-halfHeight} ${halfWidth * 2} ${halfHeight * 2}`,
    sea: polygon(0, 0, seaRadius, 0),
    coast: polygon(0, 0, seaRadius - size * 0.16, 0),
  };
}

/** Where a board corner is drawn, for hexes of radius `size` (matches boardView). */
export function cornerPoint(vertex: { x: number; y: number }, size = 50): { x: number; y: number } {
  return { x: round((vertex.x * size * SQRT3) / 2), y: round((vertex.y * size) / 2) };
}
