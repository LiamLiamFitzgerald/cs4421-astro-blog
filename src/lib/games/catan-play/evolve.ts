import type { PlayerId } from "../catan/events";
import type { PlayEvent } from "./events";
import { LONGEST_ROAD_THRESHOLD, resolveExclusiveAward } from "../catan/awards";
import { WINNING_POINTS } from "../catan/score";
import { discardsOwed, longestRoadLength, points, production, robberVictims, snakeOrder } from "./queries";
import { addHands, BANK_TRADE_RATE, COSTS, emptyHand, type Hand, hand, PRODUCES, type Resource, subtractHands } from "./resources";
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
        robber: desertKey(event.board),
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
    case "RoadBuilt":
      return afterBuild(
        pay({ ...state, roads: { ...state.roads, [event.edge]: event.player } }, event.player, COSTS.road),
        event.player,
      );
    case "SettlementBuilt":
      return afterBuild(
        pay(
          { ...state, buildings: { ...state.buildings, [event.vertex]: { player: event.player, kind: "settlement" } } },
          event.player,
          COSTS.settlement,
        ),
        event.player,
      );
    case "CityBuilt":
      return afterBuild(
        pay(
          { ...state, buildings: { ...state.buildings, [event.vertex]: { player: event.player, kind: "city" } } },
          event.player,
          COSTS.city,
        ),
        event.player,
      );
    case "CardsDiscarded": {
      if (state.pending?.kind !== "discard") return state;
      const stillOwed = Object.fromEntries(Object.entries(state.pending.owed).filter(([p]) => p !== event.player));
      const next: PlayState = {
        ...state,
        hands: { ...state.hands, [event.player]: subtractHands(state.hands[event.player] ?? emptyHand, event.cards) },
        bank: addHands(state.bank, event.cards),
      };
      const resume = state.pending.resume;
      return {
        ...next,
        pending: Object.keys(stillOwed).length > 0 ? { kind: "discard", owed: stillOwed, resume } : { kind: "move-robber", resume },
      };
    }
    case "RobberMoved": {
      const resume = state.pending?.kind === "move-robber" ? state.pending.resume : "build-or-end";
      const moved = { ...state, robber: event.hex };
      const victims = robberVictims(moved, event.hex, event.player);
      return { ...moved, pending: victims.length > 0 ? { kind: "steal", victims, resume } : null };
    }
    case "CardStolen": {
      const card = hand({ [event.resource]: 1 });
      return {
        ...state,
        hands: {
          ...state.hands,
          [event.victim]: subtractHands(state.hands[event.victim] ?? emptyHand, card),
          [event.player]: addHands(state.hands[event.player] ?? emptyHand, card),
        },
        pending: null,
      };
    }
    case "BankTraded": {
      const given = hand({ [event.give]: BANK_TRADE_RATE });
      const got = hand({ [event.get]: 1 });
      const held = state.hands[event.player] ?? emptyHand;
      return {
        ...state,
        hands: { ...state.hands, [event.player]: addHands(subtractHands(held, given), got) },
        bank: subtractHands(addHands(state.bank, given), got),
      };
    }
    default:
      return assertNever(event);
  }
}

export function replayPlay(events: readonly PlayEvent[]): PlayState {
  return events.reduce(evolve, initialPlayState);
}

function desertKey(board: { hexes: readonly { q: number; r: number; terrain: string }[] }): string | null {
  const desert = board.hexes.find((h) => h.terrain === "desert");
  return desert ? `${desert.q},${desert.r}` : null;
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
  const rolled: PlayState = {
    ...state,
    phase: "main",
    hands,
    bank: subtractHands(state.bank, paid),
    lastRoll: { player, dice: [dice[0], dice[1]], total, produced, shortages },
  };
  if (total !== 7) return rolled;
  // A 7: big hands are halved first, then the roller moves the robber.
  const owed = discardsOwed(rolled);
  return {
    ...rolled,
    pending:
      Object.keys(owed).length > 0
        ? { kind: "discard", owed, resume: "build-or-end" }
        : { kind: "move-robber", resume: "build-or-end" },
  };
}

/** Moves a cost from the player's hand back to the bank. */
function pay(state: PlayState, player: PlayerId, cost: Hand): PlayState {
  return {
    ...state,
    hands: { ...state.hands, [player]: subtractHands(state.hands[player] ?? emptyHand, cost) },
    bank: addHands(state.bank, cost),
  };
}

/**
 * Re-works Longest Road (a settlement can break an opponent's road) and ends
 * the game if the builder has reached the winning total on their turn.
 */
function afterBuild(state: PlayState, builder: PlayerId): PlayState {
  const longestRoad = resolveExclusiveAward({
    incumbent: state.longestRoad,
    counts: Object.fromEntries(state.players.map((p) => [p, longestRoadLength(state, p)])),
    threshold: LONGEST_ROAD_THRESHOLD,
  });
  const scored = { ...state, longestRoad };
  return points(scored, builder) >= WINNING_POINTS ? { ...scored, winner: builder, phase: "finished" } : scored;
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
