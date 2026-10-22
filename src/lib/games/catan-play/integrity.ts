import type { PlayEvent } from "./events";
import { evolve } from "./evolve";
import { BANK_START, RESOURCES } from "./resources";
import { initialPlayState, type PlayState } from "./state";
import { TOPOLOGY } from "./topology";

/**
 * The version of the stored/reported event log. Bump it when an event changes
 * in a way old logs cannot be read. Sent with every error report (ADR-014).
 */
export const PLAY_LOG_VERSION = 1;

/** Every event type the rules know. The Record makes a new event a compile error here until listed. */
const EVENT_TYPES: Record<PlayEvent["type"], null> = {
  GameStarted: null,
  SetupSettlementPlaced: null,
  SetupRoadPlaced: null,
  DiceRolled: null,
  TurnEnded: null,
  RoadBuilt: null,
  SettlementBuilt: null,
  CityBuilt: null,
  BankTraded: null,
  CardsDiscarded: null,
  RobberMoved: null,
  CardStolen: null,
  DevelopmentCardBought: null,
  KnightPlayed: null,
  RoadBuildingPlayed: null,
  YearOfPlentyPlayed: null,
  MonopolyPlayed: null,
  TradeProposed: null,
  TradeAccepted: null,
  TradeDeclined: null,
};

export function isKnownEvent(value: unknown): value is PlayEvent {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && Object.hasOwn(EVENT_TYPES, type);
}

const MAX_ROADS = 15;
const MAX_SETTLEMENTS = 5;
const MAX_CITIES = 4;

/**
 * Rules that must hold in every reachable state. A violation is a bug in the
 * rules or the data, never a player's mistake, so callers report it with the
 * log. Returns plain sentences, empty when the state is sound.
 */
export function checkInvariants(state: PlayState): string[] {
  const problems: string[] = [];
  if (!state.started) return problems;

  for (const resource of RESOURCES) {
    if (state.bank[resource] < 0) problems.push(`the bank has ${state.bank[resource]} ${resource}`);
    let total = state.bank[resource];
    for (const player of state.players) {
      const count = state.hands[player]?.[resource] ?? 0;
      if (count < 0) problems.push(`${player} has ${count} ${resource}`);
      total += count;
    }
    if (total !== BANK_START[resource]) {
      problems.push(`${resource} totals ${total} across bank and hands, expected ${BANK_START[resource]}`);
    }
  }

  for (const vertex of Object.keys(state.buildings).map(Number)) {
    if (!TOPOLOGY.vertices[vertex]) problems.push(`a building stands on corner ${vertex}, which does not exist`);
  }
  for (const edge of Object.keys(state.roads).map(Number)) {
    if (!TOPOLOGY.edges[edge]) problems.push(`a road lies on edge ${edge}, which does not exist`);
  }

  for (const player of state.players) {
    const roads = Object.values(state.roads).filter((p) => p === player).length;
    const mine = Object.values(state.buildings).filter((b) => b.player === player);
    const settlements = mine.filter((b) => b.kind === "settlement").length;
    const cities = mine.filter((b) => b.kind === "city").length;
    if (roads > MAX_ROADS) problems.push(`${player} has ${roads} roads, the limit is ${MAX_ROADS}`);
    if (settlements > MAX_SETTLEMENTS) problems.push(`${player} has ${settlements} settlements, the limit is ${MAX_SETTLEMENTS}`);
    if (cities > MAX_CITIES) problems.push(`${player} has ${cities} cities, the limit is ${MAX_CITIES}`);
  }

  if (state.players.length > 0 && (state.current < 0 || state.current >= state.players.length)) {
    problems.push(`the current player index ${state.current} is outside the ${state.players.length} seats`);
  }
  if (state.board && state.robber === null) problems.push("the robber is not on the board");
  return problems;
}

/** Where and why a log stopped being usable. */
export interface LogProblem {
  readonly kind: "unreadable-event" | "event-failed" | "invariant";
  /** Zero-based position of the event the problem was found at. */
  readonly index: number;
  readonly detail: string;
}

export interface ReplayOutcome {
  /** State after the last event that was applied. */
  readonly state: PlayState;
  /** The usable events: all of them, or the readable prefix before the first unreadable one. */
  readonly events: readonly PlayEvent[];
  /** Set when events were dropped (unreadable-event, event-failed). */
  readonly salvaged: boolean;
  readonly problems: readonly LogProblem[];
}

/**
 * Replays a stored log defensively. Unknown or unapplicable events end the
 * replay at the last good event (the rest is dropped, not guessed at). Broken
 * invariants are reported but do not drop anything, since the game is still
 * playable and the bug needs the whole log to reproduce.
 */
export function replayChecked(stored: readonly unknown[]): ReplayOutcome {
  let state = initialPlayState;
  const events: PlayEvent[] = [];
  const problems: LogProblem[] = [];
  let reportedInvariant = false;

  for (const [index, candidate] of stored.entries()) {
    if (!isKnownEvent(candidate)) {
      problems.push({ kind: "unreadable-event", index, detail: "not an event this version of the rules knows" });
      return { state, events, salvaged: true, problems };
    }
    try {
      state = evolve(state, candidate);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      problems.push({ kind: "event-failed", index, detail: `${candidate.type} could not be applied: ${reason}` });
      return { state, events, salvaged: true, problems };
    }
    events.push(candidate);
    if (!reportedInvariant) {
      const broken = checkInvariants(state);
      if (broken.length > 0) {
        reportedInvariant = true;
        problems.push({ kind: "invariant", index, detail: broken.join("; ") });
      }
    }
  }
  return { state, events, salvaged: false, problems };
}
