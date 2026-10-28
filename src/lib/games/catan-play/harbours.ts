import { mulberry32, shuffle } from "../../core/random";
import type { Resource } from "./resources";
import { type EdgeId, TOPOLOGY, type Topology, type VertexId } from "./topology";

/** A harbour on a coastal edge: "any" trades 3:1, a resource harbour trades that resource 2:1. */
export interface Harbour {
  readonly edge: EdgeId;
  readonly kind: Resource | "any";
}

/** The base game's nine harbours: four 3:1 and one 2:1 for each resource. */
export const HARBOUR_KINDS: readonly Harbour["kind"][] = ["any", "any", "any", "any", "lumber", "brick", "wool", "grain", "ore"];

/**
 * Positions of the harbours around the coast, as indexes into the ring of 30
 * coastal edges. The gaps (3, 4, 3, 3, 4, 3, 3, 4, 3) spread them evenly, like
 * the printed frame of the base game.
 */
export const HARBOUR_SLOTS: readonly number[] = [0, 3, 7, 10, 13, 17, 20, 23, 27];

const sharedHexes = (topology: Topology, edge: EdgeId) => {
  const [a, b] = topology.edges[edge]?.ends ?? [-1, -1];
  return (topology.vertices[a]?.hexes ?? []).filter((h) => topology.vertices[b]?.hexes.includes(h));
};

/** The coastal edges (those touching one hex), in order around the island. */
export function coastRing(topology: Topology = TOPOLOGY): EdgeId[] {
  const coastal = topology.edges.filter((e) => sharedHexes(topology, e.id).length === 1).map((e) => e.id);
  const first = coastal[0];
  if (first === undefined) return [];
  const ring = [first];
  const seen = new Set(ring);
  let at: VertexId = topology.edges[first]?.ends[1] ?? 0;
  while (ring.length < coastal.length) {
    const next = coastal.find((e) => !seen.has(e) && topology.edges[e]?.ends.includes(at));
    if (next === undefined) break;
    ring.push(next);
    seen.add(next);
    const ends = topology.edges[next]?.ends ?? [at, at];
    at = ends[0] === at ? ends[1] : ends[0];
  }
  return ring;
}

/** Deals harbour types onto the fixed slots, shuffled from the game seed. */
export function dealHarbours(seed: number): Harbour[] {
  const ring = coastRing();
  const kinds = shuffle(HARBOUR_KINDS, mulberry32((seed ^ 0x85ebca6b) >>> 0));
  return HARBOUR_SLOTS.map((slot, i) => ({ edge: ring[slot] ?? 0, kind: kinds[i] ?? "any" }));
}
