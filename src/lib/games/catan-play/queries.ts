import type { PlayerId } from "../catan/events";
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
