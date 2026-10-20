import { BOARD_POSITIONS } from "../catan/board";

/**
 * Corners (where settlements and cities go) and edges (where roads go) of the
 * base board, as a graph. Pure data, built once from the 19 hex positions.
 *
 * Coordinates are exact integers: for pointy-top hexes of radius 1, a point's
 * x is X·√3/2 and its y is Y/2. Using integers means two hexes that share a
 * corner compute exactly the same key, with no floating-point rounding.
 */

export type VertexId = number;
export type EdgeId = number;

export interface Vertex {
  readonly id: VertexId;
  readonly x: number;
  readonly y: number;
  /** Keys ("q,r") of the 1–3 hexes this corner touches. */
  readonly hexes: readonly string[];
  /** Corners one road away. */
  readonly neighbours: readonly VertexId[];
  /** Edges that end here. */
  readonly edges: readonly EdgeId[];
}

export interface Edge {
  readonly id: EdgeId;
  /** The two corners it joins, lower id first. */
  readonly ends: readonly [VertexId, VertexId];
}

export interface Topology {
  readonly vertices: readonly Vertex[];
  readonly edges: readonly Edge[];
  /** Corner ids of each hex, clockwise from the top. */
  readonly hexCorners: Readonly<Record<string, readonly VertexId[]>>;
}

/** Corner offsets of a pointy-top hex, clockwise from the top. */
const CORNERS: readonly (readonly [number, number])[] = [
  [0, -2],
  [1, -1],
  [1, 1],
  [0, 2],
  [-1, 1],
  [-1, -1],
];

export function buildTopology(positions: readonly (readonly [number, number])[]): Topology {
  const cornerPoints = positions.map(([q, r]) => {
    const cx = 2 * q + r;
    const cy = 3 * r;
    return { hex: `${q},${r}`, points: CORNERS.map(([dx, dy]) => [cx + dx, cy + dy] as const) };
  });

  // Unique corners, numbered top to bottom then left to right.
  const pointKey = ([x, y]: readonly [number, number]) => `${x},${y}`;
  const unique = new Map<string, readonly [number, number]>();
  for (const { points } of cornerPoints) for (const p of points) unique.set(pointKey(p), p);
  const ordered = [...unique.values()].sort(([ax, ay], [bx, by]) => ay - by || ax - bx);
  const idOf = new Map(ordered.map((p, id) => [pointKey(p), id]));
  const id = (p: readonly [number, number]) => idOf.get(pointKey(p)) as VertexId;

  const hexCorners: Record<string, VertexId[]> = {};
  const hexesAt = ordered.map((): string[] => []);
  const edgeKeys = new Map<string, readonly [VertexId, VertexId]>();
  for (const { hex, points } of cornerPoints) {
    const ids = points.map(id);
    hexCorners[hex] = ids;
    ids.forEach((v, i) => {
      hexesAt[v]?.push(hex);
      const w = ids[(i + 1) % 6] as VertexId;
      const ends = (v < w ? [v, w] : [w, v]) as readonly [VertexId, VertexId];
      edgeKeys.set(`${ends[0]}-${ends[1]}`, ends);
    });
  }

  const edges: Edge[] = [...edgeKeys.values()]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map((ends, edgeId) => ({ id: edgeId, ends }));

  const vertices: Vertex[] = ordered.map(([x, y], v) => {
    const touching = edges.filter((e) => e.ends.includes(v));
    return {
      id: v,
      x,
      y,
      hexes: hexesAt[v] ?? [],
      neighbours: touching.map((e) => (e.ends[0] === v ? e.ends[1] : e.ends[0])),
      edges: touching.map((e) => e.id),
    };
  });

  return { vertices, edges, hexCorners };
}

/** The base board's corners and edges. */
export const TOPOLOGY: Topology = buildTopology(BOARD_POSITIONS);

/** The edge joining two corners, or undefined if they are not neighbours. */
export function edgeBetween(a: VertexId, b: VertexId, topology: Topology = TOPOLOGY): EdgeId | undefined {
  return topology.edges.find((e) => (e.ends[0] === a && e.ends[1] === b) || (e.ends[0] === b && e.ends[1] === a))?.id;
}
