import type { PlayerId } from "../catan/events";
import type { PlayEvent } from "./events";
import { production, snakeOrder } from "./queries";
import { addHands, emptyHand, hand, PRODUCES, type Resource, subtractHands } from "./resources";
import { initialPlayState, type PlayState } from "./state";
import { TOPOLOGY, type VertexId } from "./topology";

/**
 * Applies one event to a state. Pure. Events were validated by `decide`, so
 * evolve trusts them; anything derived (turn order, resources from setup) is
 * worked out here so it is never stored.
 */
export function evolve(state: PlayState, event: PlayEvent): PlayState {
  switch (event.type) {
    case "GameStarted":
      if (state.started) return state;
      return {
        ...initialPlayState,
        started: true,
        board: event.board,
        players: [...event.players],
        hands: Object.fromEntries(event.players.map((p) => [p, emptyHand])),
      };
    case "SetupSettlementPlaced":
      return withStartingResources(
        {
          ...state,
          buildings: { ...state.buildings, [event.vertex]: { player: event.player, kind: "settlement" } },
          pendingSettlement: event.vertex,
        },
        event.player,
        event.vertex,
      );
    case "SetupRoadPlaced":
      return advanceSetup({
        ...state,
        roads: { ...state.roads, [event.edge]: event.player },
        pendingSettlement: null,
      });
    case "DiceRolled":
      return applyRoll(state, event.player, event.dice);
    case "TurnEnded":
      return { ...state, phase: "roll", current: (state.current + 1) % state.players.length };
    default:
      return assertNever(event);
  }
}

export function replayPlay(events: readonly PlayEvent[]): PlayState {
  return events.reduce(evolve, initialPlayState);
}

/** The second setup settlement collects one of each resource around it. */
function withStartingResources(state: PlayState, player: PlayerId, vertex: VertexId): PlayState {
  const secondRound = state.setupTurn >= state.players.length;
  if (!secondRound || !state.board) return state;
  const touching = new Set(TOPOLOGY.vertices[vertex]?.hexes ?? []);
  const gained: Partial<Record<Resource, number>> = {};
  for (const hex of state.board.hexes) {
    const resource = PRODUCES[hex.terrain];
    if (resource && touching.has(`${hex.q},${hex.r}`)) gained[resource] = (gained[resource] ?? 0) + 1;
  }
  const income = hand(gained);
  return {
    ...state,
    hands: { ...state.hands, [player]: addHands(state.hands[player] ?? emptyHand, income) },
    bank: subtractHands(state.bank, income),
  };
}

function applyRoll(state: PlayState, player: PlayerId, dice: readonly [number, number]): PlayState {
  const total = dice[0] + dice[1];
  const { produced, shortages } = production(state, total);
  const hands = Object.fromEntries(
    state.players.map((p) => [p, addHands(state.hands[p] ?? emptyHand, produced[p] ?? emptyHand)]),
  );
  const paid = state.players.reduce((sum, p) => addHands(sum, produced[p] ?? emptyHand), emptyHand);
  return {
    ...state,
    phase: "main",
    hands,
    bank: subtractHands(state.bank, paid),
    lastRoll: { player, dice: [dice[0], dice[1]], total, produced, shortages },
  };
}

/** Moves to the next seat in snake order, or to the first roll once everyone has placed twice. */
function advanceSetup(state: PlayState): PlayState {
  const order = snakeOrder(state.players.length);
  const next = state.setupTurn + 1;
  if (next >= order.length) return { ...state, setupTurn: next, phase: "roll", current: 0 };
  return { ...state, setupTurn: next, current: order[next] ?? 0 };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled event: ${JSON.stringify(value)}`);
}
