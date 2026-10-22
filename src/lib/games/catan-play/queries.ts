import type { PlayerId } from "../catan/events";
import { AWARD_POINTS } from "../catan/awards";
import {
  BANK_TRADE_RATE,
  COSTS,
  emptyHand,
  type Hand,
  hand,
  handSize,
  missing,
  type Piece,
  PIECE_LIMITS,
  PRODUCES,
  RESOURCES,
  type Resource,
} from "./resources";
import type { DevCard } from "./dev-cards";
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

/** What has to happen next, or null before the start and after the end. */
export function expectedStep(state: PlayState): Step | null {
  if (!state.started || state.phase === "finished") return null;
  if (state.pending) return state.pending.kind;
  if (state.phase === "setup") return state.pendingSettlement === null ? "place-settlement" : "place-road";
  return state.phase === "roll" ? "roll" : "build-or-end";
}

/**
 * Who has to act now. Usually the current player, but after a 7 each player
 * who owes cards discards in seat order, starting with the roller (ADR-011).
 */
export function actingPlayer(state: PlayState): PlayerId | null {
  const pending = state.pending;
  if (pending?.kind === "respond-trade") return pending.to;
  if (pending?.kind !== "discard") return currentPlayer(state);
  const n = state.players.length;
  for (let i = 0; i < n; i++) {
    const p = state.players[(state.current + i) % n];
    if (p !== undefined && (pending.owed[p] ?? 0) > 0) return p;
  }
  return currentPlayer(state);
}

// ------------------------------------------------------------ the robber

/** Players with more than 7 cards discard half, rounded down. */
export const DISCARD_LIMIT = 7;

export function discardsOwed(state: PlayState): Record<PlayerId, number> {
  return Object.fromEntries(
    state.players
      .map((p) => [p, handSize(state.hands[p] ?? emptyHand)] as const)
      .filter(([, size]) => size > DISCARD_LIMIT)
      .map(([p, size]) => [p, Math.floor(size / 2)]),
  );
}

/** Every hex except the one the robber is on. */
export function legalRobberHexes(state: PlayState): string[] {
  return (state.board?.hexes ?? []).map((h) => `${h.q},${h.r}`).filter((key) => key !== state.robber);
}

/** Players other than the thief with a building on the hex and at least one card. */
export function robberVictims(state: PlayState, hex: string, thief: PlayerId): PlayerId[] {
  const owners = new Set(
    (TOPOLOGY.hexCorners[hex] ?? []).flatMap((v) => (state.buildings[v] ? [state.buildings[v].player] : [])),
  );
  return state.players.filter((p) => p !== thief && owners.has(p) && handSize(state.hands[p] ?? emptyHand) > 0);
}

/** The resource of the `pick`-th card when a hand is laid out in resource order. */
export function cardAt(h: Hand, pick: number): Resource | null {
  let index = pick;
  for (const r of RESOURCES) {
    if (index < h[r]) return r;
    index -= h[r];
  }
  return null;
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
    if (hex.token !== total || !resource || `${hex.q},${hex.r}` === state.robber) continue;
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

// ------------------------------------------------------------ building

/** Pieces a player still has in their supply. A city returns its settlement. */
export function piecesLeft(state: PlayState, player: PlayerId): Record<Piece, number> {
  const mine = Object.values(state.buildings).filter((b) => b.player === player);
  const roads = Object.values(state.roads).filter((owner) => owner === player).length;
  return {
    road: PIECE_LIMITS.road - roads,
    settlement: PIECE_LIMITS.settlement - mine.filter((b) => b.kind === "settlement").length,
    city: PIECE_LIMITS.city - mine.filter((b) => b.kind === "city").length,
  };
}

const blockedFor = (state: PlayState, player: PlayerId, vertex: VertexId) => {
  const building = state.buildings[vertex];
  return building !== undefined && building.player !== player;
};

/** True when a free edge touches the player's building, or their road through a corner no opponent holds. */
export function connectsToNetwork(state: PlayState, player: PlayerId, edge: EdgeId): boolean {
  const target = TOPOLOGY.edges[edge];
  if (!target || state.roads[edge] !== undefined) return false;
  return target.ends.some((v) => {
    if (state.buildings[v]?.player === player) return true;
    if (blockedFor(state, player, v)) return false;
    return (TOPOLOGY.vertices[v]?.edges ?? []).some((e) => e !== edge && state.roads[e] === player);
  });
}

export function legalRoads(state: PlayState, player: PlayerId): EdgeId[] {
  return TOPOLOGY.edges.filter((e) => connectsToNetwork(state, player, e.id)).map((e) => e.id);
}

/** Open corners (distance rule) that touch one of the player's roads. */
export function legalSettlements(state: PlayState, player: PlayerId): VertexId[] {
  return TOPOLOGY.vertices
    .filter((v) => isOpenCorner(state, v.id) && v.edges.some((e) => state.roads[e] === player))
    .map((v) => v.id);
}

export function legalCities(state: PlayState, player: PlayerId): VertexId[] {
  return Object.entries(state.buildings)
    .filter(([, b]) => b.player === player && b.kind === "settlement")
    .map(([v]) => Number(v));
}

/** Everything the UI needs to offer or explain a build, from the rules. */
export interface BuildOption {
  readonly piece: Piece;
  readonly cost: Hand;
  readonly missing: Hand;
  readonly piecesLeft: number;
  readonly spots: readonly number[];
  /** True when it is this player's build step and they could build one now. */
  readonly allowed: boolean;
}

export function buildOptions(state: PlayState, player: PlayerId): BuildOption[] {
  const left = piecesLeft(state, player);
  const yourStep = expectedStep(state) === "build-or-end" && currentPlayer(state) === player;
  const spots: Record<Piece, number[]> = {
    road: legalRoads(state, player),
    settlement: legalSettlements(state, player),
    city: legalCities(state, player),
  };
  const playerHand = state.hands[player] ?? emptyHand;
  return (["road", "settlement", "city"] as const).map((piece) => {
    const short = missing(playerHand, COSTS[piece]);
    const affordable = handSize(short) === 0;
    return {
      piece,
      cost: COSTS[piece],
      missing: short,
      piecesLeft: left[piece],
      spots: spots[piece],
      allowed: yourStep && affordable && left[piece] > 0 && spots[piece].length > 0,
    };
  });
}

// ------------------------------------------------------------ scoring

/**
 * Length of the player's longest continuous road, counted in edges. The road
 * cannot continue through a corner holding an opponent's building.
 */
export function longestRoadLength(state: PlayState, player: PlayerId): number {
  let best = 0;
  const walk = (vertex: VertexId, used: Set<EdgeId>) => {
    best = Math.max(best, used.size);
    if (used.size > 0 && blockedFor(state, player, vertex)) return;
    for (const edge of TOPOLOGY.vertices[vertex]?.edges ?? []) {
      if (state.roads[edge] !== player || used.has(edge)) continue;
      const ends = TOPOLOGY.edges[edge]?.ends ?? [vertex, vertex];
      used.add(edge);
      walk(ends[0] === vertex ? ends[1] : ends[0], used);
      used.delete(edge);
    }
  };
  for (const v of TOPOLOGY.vertices) {
    if (v.edges.some((e) => state.roads[e] === player)) walk(v.id, new Set());
  }
  return best;
}

/** Victory points: 1 per settlement, 2 per city, 2 for Longest Road. */
/** Points everyone can see: buildings, Longest Road and Largest Army. */
export function visiblePoints(state: PlayState, player: PlayerId): number {
  const mine = Object.values(state.buildings).filter((b) => b.player === player);
  return (
    mine.reduce((sum, b) => sum + (b.kind === "city" ? 2 : 1), 0) +
    (state.longestRoad === player ? AWARD_POINTS : 0) +
    (state.largestArmy === player ? AWARD_POINTS : 0)
  );
}

/** Victory point cards a player holds (hidden from the others until they win). */
export function hiddenPoints(state: PlayState, player: PlayerId): number {
  return (state.devCards[player] ?? []).filter((c) => c.card === "victory-point").length;
}

/** All of a player's points, including hidden victory point cards. Used to decide the winner. */
export function points(state: PlayState, player: PlayerId): number {
  return visiblePoints(state, player) + hiddenPoints(state, player);
}

// ------------------------------------------------------------ development cards

/** The first card of this kind the player may play now (bought before this turn), or null. */
export function playableCardIndex(state: PlayState, player: PlayerId, card: DevCard): number {
  return (state.devCards[player] ?? []).findIndex((c) => c.card === card && c.boughtOnTurn < state.turn);
}

export interface DevCardOption {
  readonly card: DevCard;
  /** How many of this card the player holds. */
  readonly held: number;
  readonly allowed: boolean;
  /** Why it cannot be played now, when not allowed. */
  readonly reason: "victory-points-are-automatic" | "bought-this-turn" | "one-per-turn" | "not-now" | null;
}

/** For each card a player holds: whether they can play it now, and why not. Used by the UI. */
export function devCardOptions(state: PlayState, player: PlayerId): DevCardOption[] {
  const held = state.devCards[player] ?? [];
  const kinds = [...new Set(held.map((c) => c.card))];
  const step = expectedStep(state);
  const theirMoment = currentPlayer(state) === player && (step === "roll" || step === "build-or-end");
  return kinds.map((card) => {
    const count = held.filter((c) => c.card === card).length;
    let reason: DevCardOption["reason"] = null;
    if (card === "victory-point") reason = "victory-points-are-automatic";
    else if (!theirMoment) reason = "not-now";
    else if (state.playedDevCardThisTurn) reason = "one-per-turn";
    else if (playableCardIndex(state, player, card) < 0) reason = "bought-this-turn";
    return { card, held: count, allowed: reason === null, reason };
  });
}

// ------------------------------------------------------------ harbours

/** Cards of `give` the player must hand the bank for one card: 4, 3 or 2 with harbours. */
export function tradeRate(state: PlayState, player: PlayerId, give: Resource): number {
  let rate = BANK_TRADE_RATE;
  for (const harbour of state.harbours) {
    const ends = TOPOLOGY.edges[harbour.edge]?.ends ?? [];
    if (!ends.some((v) => state.buildings[v]?.player === player)) continue;
    if (harbour.kind === give) rate = Math.min(rate, 2);
    if (harbour.kind === "any") rate = Math.min(rate, 3);
  }
  return rate;
}
