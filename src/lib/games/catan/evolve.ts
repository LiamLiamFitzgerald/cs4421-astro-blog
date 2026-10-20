import {
  LARGEST_ARMY_THRESHOLD,
  LONGEST_ROAD_THRESHOLD,
  resolveExclusiveAward,
} from "./awards";
import type { Board } from "./board";
import type { CatanEvent, PlayerId } from "./events";
import { totalPoints, WINNING_POINTS } from "./score";
import {
  emptyPlayer,
  initialState,
  type CatanState,
  type PlayerState,
} from "./state";

/**
 * Applies one event to a state and returns the next state. Pure: it never
 * mutates its input.
 *
 * Events are facts that `decide` has already validated, so `evolve` never
 * produces an invalid state: an event for an unknown player, or an upgrade with
 * no settlement to upgrade, is ignored rather than corrupting the tally.
 */
export function evolve(state: CatanState, event: CatanEvent): CatanState {
  return latchWinner(resolveAwards(applyEvent(state, event)));
}

function applyEvent(state: CatanState, event: CatanEvent): CatanState {
  switch (event.type) {
    case "GameStarted":
      return startGame(state, event.players, event.board ?? null);
    case "SettlementBuilt":
      return updatePlayer(state, event.player, (p) => ({
        ...p,
        settlements: p.settlements + 1,
      }));
    case "SettlementUpgraded":
      return updatePlayer(state, event.player, (p) =>
        p.settlements > 0
          ? { ...p, settlements: p.settlements - 1, cities: p.cities + 1 }
          : p,
      );
    case "VictoryPointCardRevealed":
      return updatePlayer(state, event.player, (p) => ({
        ...p,
        victoryPointCards: p.victoryPointCards + 1,
      }));
    case "KnightPlayed":
      return updatePlayer(state, event.player, (p) => ({
        ...p,
        knights: p.knights + 1,
      }));
    case "RoadLengthRecorded":
      return updatePlayer(state, event.player, (p) => ({
        ...p,
        roadLength: event.length,
      }));
    default:
      return assertNever(event);
  }
}

/** Rebuilds a match from its event log. */
export function replay(events: readonly CatanEvent[]): CatanState {
  return events.reduce(evolve, initialState);
}

/**
 * Records the winner the first time anyone reaches the winning total. Once set
 * it never changes.
 *
 * At most one player can newly reach the total on a single event: base points
 * only change for the acting player, and an event moves at most one award, which
 * lifts at most one player. So when the winner is unset, `reached` has at most
 * one entry. (Found by mutation testing: an earlier tie-break here was dead code.)
 */
function latchWinner(state: CatanState): CatanState {
  if (state.winner !== null) return state;

  const winner = state.playerOrder.find(
    (id) => totalPoints(state, id) >= WINNING_POINTS,
  );
  return winner === undefined ? state : { ...state, winner };
}

/** Recomputes who holds each award from the current counts. */
function resolveAwards(state: CatanState): CatanState {
  const largestArmy = resolveExclusiveAward({
    incumbent: state.largestArmy,
    counts: countsOf(state, (p) => p.knights),
    threshold: LARGEST_ARMY_THRESHOLD,
  });
  const longestRoad = resolveExclusiveAward({
    incumbent: state.longestRoad,
    counts: countsOf(state, (p) => p.roadLength),
    threshold: LONGEST_ROAD_THRESHOLD,
  });
  if (largestArmy === state.largestArmy && longestRoad === state.longestRoad) {
    return state;
  }
  return { ...state, largestArmy, longestRoad };
}

function countsOf(
  state: CatanState,
  pick: (player: PlayerState) => number,
): Record<PlayerId, number> {
  return Object.fromEntries(
    Object.entries(state.players).map(([id, player]) => [id, pick(player)]),
  );
}

function startGame(
  state: CatanState,
  players: readonly PlayerId[],
  board: Board | null,
): CatanState {
  if (state.started) return state;
  return {
    ...state,
    started: true,
    playerOrder: [...players],
    players: Object.fromEntries(players.map((id) => [id, emptyPlayer])),
    board,
  };
}

function updatePlayer(
  state: CatanState,
  id: PlayerId,
  change: (player: PlayerState) => PlayerState,
): CatanState {
  const current = state.players[id];
  if (!current) return state;
  return { ...state, players: { ...state.players, [id]: change(current) } };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled event: ${JSON.stringify(value)}`);
}
