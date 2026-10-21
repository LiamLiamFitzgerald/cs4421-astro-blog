import type { PlayerId } from "../catan/events";
import { emptyHand, type Hand, hand, PRODUCES, RESOURCES, type Resource } from "./resources";
import type { PlayState, Step } from "./state";
import { type EdgeId, TOPOLOGY, type VertexId } from "./topology";

/**
 * Read-only questions about a game. `decide` uses them to check commands and
 * the UI uses them to highlight legal moves, so the rules live in one place.
 */

/** Seat indexes in setup order: 0, 1, …, n−1, then n−1, …, 0. */
export function snakeOrder(playerCount: number): number[] {
  const forward = [...Array(playerCount).keys()];
  return [...forward, ...[...forward].reverse()];
}

export function currentPlayer(state: PlayState): PlayerId | null {
  return state.started ? (state.players[state.current] ?? null) : null;
}

/** What the current player has to do next, or null before the start and after the end. */
export function expectedStep(state: PlayState): Step | null {
  if (!state.started || state.phase === "finished") return null;
  if (state.phase === "setup") return state.pendingSettlement === null ? "place-settlement" : "place-road";
  return state.phase === "roll" ? "roll" : "build-or-end";
}

/** True when the corner and every corner next to it are empty (the distance rule). */
export function isOpenCorner(state: PlayState, vertex: VertexId): boolean {
  const v = TOPOLOGY.vertices[vertex];
  if (!v || state.buildings[vertex]) return false;
  return v.neighbours.every((n) => !state.buildings[n]);
}

/** Where the current player may place a settlement during setup. */
export function legalSetupSettlements(state: PlayState): VertexId[] {
  if (expectedStep(state) !== "place-settlement") return [];
  return TOPOLOGY.vertices.filter((v) => isOpenCorner(state, v.id)).map((v) => v.id);
}

/** Where the current player may place the road that follows a setup settlement. */
export function legalSetupRoads(state: PlayState): EdgeId[] {
  if (expectedStep(state) !== "place-road" || state.pendingSettlement === null) return [];
  const corner = TOPOLOGY.vertices[state.pendingSettlement];
  // Every edge of a new setup settlement is free (see placeSetupRoad in decide.ts).
  return [...(corner?.edges ?? [])];
}

/**
 * What a roll gives each player: 1 per settlement and 2 per city on every
 * corner of each hex showing the rolled number. Nothing on a 7.
 *
 * If the bank cannot pay everyone who earned a resource, nobody gets it, unless
 * only one player earned it, in which case they get what the bank has left.
 */
export function production(
  state: PlayState,
  total: number,
): { produced: Record<PlayerId, Hand>; shortages: Resource[] } {
  const earned: Record<PlayerId, Record<Resource, number>> = Object.fromEntries(
    state.players.map((p) => [p, { ...emptyHand }]),
  );
  for (const hex of state.board?.hexes ?? []) {
    const resource = PRODUCES[hex.terrain];
    if (hex.token !== total || !resource) continue;
    for (const corner of TOPOLOGY.hexCorners[`${hex.q},${hex.r}`] ?? []) {
      const building = state.buildings[corner];
      const tally = building ? earned[building.player] : undefined;
      if (building && tally) tally[resource] += building.kind === "city" ? 2 : 1;
    }
  }
  const shortages: Resource[] = [];
  for (const resource of RESOURCES) {
    const claimants = state.players.filter((p) => (earned[p]?.[resource] ?? 0) > 0);
    const demand = claimants.reduce((sum, p) => sum + (earned[p]?.[resource] ?? 0), 0);
    if (demand <= state.bank[resource]) continue;
    shortages.push(resource);
    for (const p of state.players) {
      const tally = earned[p];
      if (tally) tally[resource] = claimants.length === 1 && claimants[0] === p ? state.bank[resource] : 0;
    }
  }
  return {
    produced: Object.fromEntries(state.players.map((p) => [p, hand(earned[p] ?? {})])),
    shortages,
  };
}
