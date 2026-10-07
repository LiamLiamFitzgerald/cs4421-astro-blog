import type { CatanEvent, PlayerId } from "./events";
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
  switch (event.type) {
    case "GameStarted":
      return startGame(state, event.players);
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

function startGame(state: CatanState, players: readonly PlayerId[]): CatanState {
  if (state.started) return state;
  return {
    ...state,
    started: true,
    playerOrder: [...players],
    players: Object.fromEntries(players.map((id) => [id, emptyPlayer])),
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
