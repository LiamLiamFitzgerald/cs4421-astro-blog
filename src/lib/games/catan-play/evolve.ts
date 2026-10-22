import type { PlayerId } from "../catan/events";
import type { PlayEvent } from "./events";
import { LONGEST_ROAD_THRESHOLD, resolveExclusiveAward } from "../catan/awards";
import { WINNING_POINTS } from "../catan/score";
import {
  discardsOwed,
  legalRoads,
  longestRoadLength,
  piecesLeft,
  playableCardIndex,
  points,
  production,
  robberVictims,
  snakeOrder,
} from "./queries";
import { type DevCard, LARGEST_ARMY_KNIGHTS } from "./dev-cards";
import {
  addHands,
  BANK_TRADE_RATE,
  COSTS,
  DEV_CARD_COST,
  emptyHand,
  type Hand,
  hand,
  PRODUCES,
  type Resource,
  subtractHands,
} from "./resources";
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
        deck: [...(event.deck ?? [])],
        devCards: Object.fromEntries(event.players.map((p) => [p, []])),
        knightsPlayed: Object.fromEntries(event.players.map((p) => [p, 0])),
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
      return {
        ...state,
        phase: "roll",
        current: (state.current + 1) % state.players.length,
        turn: state.turn + 1,
        playedDevCardThisTurn: false,
      };
    case "RoadBuilt": {
      const placed = { ...state, roads: { ...state.roads, [event.edge]: event.player } };
      if (!event.free) return afterBuild(pay(placed, event.player, COSTS.road), event.player);
      return afterBuild(nextFreeRoad(placed, event.player), event.player);
    }
    case "DevelopmentCardBought":
      return afterBuild(
        pay(
          {
            ...state,
            deck: state.deck.slice(1),
            devCards: {
              ...state.devCards,
              [event.player]: [...(state.devCards[event.player] ?? []), { card: event.card, boughtOnTurn: state.turn }],
            },
          },
          event.player,
          DEV_CARD_COST,
        ),
        event.player,
      );
    case "KnightPlayed": {
      const played = useCard(state, event.player, "knight");
      const knightsPlayed = { ...played.knightsPlayed, [event.player]: (played.knightsPlayed[event.player] ?? 0) + 1 };
      const largestArmy = resolveExclusiveAward({
        incumbent: played.largestArmy,
        counts: knightsPlayed,
        threshold: LARGEST_ARMY_KNIGHTS,
      });
      return afterBuild(
        { ...played, knightsPlayed, largestArmy, pending: { kind: "move-robber", resume: resumePoint(state) } },
        event.player,
      );
    }
    case "RoadBuildingPlayed": {
      const played = useCard(state, event.player, "road-building");
      const remaining = Math.min(2, piecesLeft(played, event.player).road);
      const canPlace = remaining > 0 && legalRoads(played, event.player).length > 0;
      return {
        ...played,
        pending: canPlace ? { kind: "place-free-road", remaining, resume: resumePoint(state) } : null,
      };
    }
    case "YearOfPlentyPlayed": {
      const played = useCard(state, event.player, "year-of-plenty");
      const gained = event.resources.reduce((h, r) => addHands(h, hand({ [r]: 1 })), emptyHand);
      return {
        ...played,
        hands: { ...played.hands, [event.player]: addHands(played.hands[event.player] ?? emptyHand, gained) },
        bank: subtractHands(played.bank, gained),
      };
    }
    case "MonopolyPlayed": {
      const played = useCard(state, event.player, "monopoly");
      let taken = 0;
      const hands = Object.fromEntries(
        played.players.map((p) => {
          const held = played.hands[p] ?? emptyHand;
          if (p === event.player) return [p, held];
          taken += held[event.resource];
          return [p, { ...held, [event.resource]: 0 }];
        }),
      );
      const mine = hands[event.player] ?? emptyHand;
      return { ...played, hands: { ...hands, [event.player]: { ...mine, [event.resource]: mine[event.resource] + taken } } };
    }
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

/** Where play returns after a card's effect: before the roll, or to building. */
function resumePoint(state: PlayState): "roll" | "build-or-end" {
  return state.phase === "roll" ? "roll" : "build-or-end";
}

/** Removes the first playable card of this kind and marks a card as played this turn. */
function useCard(state: PlayState, player: PlayerId, card: DevCard): PlayState {
  const index = playableCardIndex(state, player, card);
  const held = [...(state.devCards[player] ?? [])];
  if (index >= 0) held.splice(index, 1);
  return { ...state, devCards: { ...state.devCards, [player]: held }, playedDevCardThisTurn: true };
}

/** After a free road: one fewer to place, and stop early if there is nowhere left to build. */
function nextFreeRoad(state: PlayState, player: PlayerId): PlayState {
  if (state.pending?.kind !== "place-free-road") return state;
  const remaining = state.pending.remaining - 1;
  const canPlace = remaining > 0 && piecesLeft(state, player).road > 0 && legalRoads(state, player).length > 0;
  return { ...state, pending: canPlace ? { ...state.pending, remaining } : null };
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
