import { err, ok, type Result } from "../../core/result";
import { generateBoard, isValidSeed } from "../catan/board";
import { type DevCard, shuffledDeck } from "./dev-cards";
import { dealHarbours } from "./harbours";
import { decide as decideScoring } from "../catan/decide";
import { initialState as initialScoringState } from "../catan/state";
import type { PlayCommand } from "./commands";
import type { PlayEvent } from "./events";
import {
  actingPlayer,
  cardAt,
  connectsToNetwork,
  expectedStep,
  isOpenCorner,
  piecesLeft,
  playableCardIndex,
  tradeRate,
} from "./queries";
import {
  COSTS,
  DEV_CARD_COST,
  emptyHand,
  type Hand,
  handSize,
  isResource,
  missing,
  type Piece,
  type Resource,
  RESOURCES,
} from "./resources";
import type { PlayState, Step } from "./state";
import { TOPOLOGY } from "./topology";
import type { PlayViolation } from "./violations";

type Decision = Result<readonly PlayEvent[], PlayViolation>;

/**
 * Checks a command against the rules of a played game and returns the events
 * it produces or the rule it breaks. Pure: it never changes `state`.
 */
export function decide(state: PlayState, command: PlayCommand): Decision {
  if (command.type === "StartGame") return startGame(state, command);
  if (!state.started) return err({ code: "GAME_NOT_STARTED" });
  if (state.winner !== null) return err({ code: "GAME_OVER", winner: state.winner });

  const actor = actingPlayer(state);
  if (actor !== null && command.player !== actor) {
    return err({ code: "NOT_YOUR_TURN", player: command.player, current: actor });
  }

  switch (command.type) {
    case "PlaceSetupSettlement":
      return requireStep(state, "place-settlement") ?? placeSetupSettlement(state, command.player, command.vertex);
    case "PlaceSetupRoad":
      return requireStep(state, "place-road") ?? placeSetupRoad(state, command.player, command.edge);
    case "RollDice":
      return requireStep(state, "roll") ?? rollDice(command.player, command.dice);
    case "EndTurn":
      return requireStep(state, "build-or-end") ?? ok([{ type: "TurnEnded", player: command.player }]);
    case "BuildRoad":
      if (expectedStep(state) === "place-free-road") return buildRoad(state, command.player, command.edge, true);
      return requireStep(state, "build-or-end") ?? buildRoad(state, command.player, command.edge, false);
    case "BuildSettlement":
      return requireStep(state, "build-or-end") ?? buildSettlement(state, command.player, command.vertex);
    case "BuildCity":
      return requireStep(state, "build-or-end") ?? buildCity(state, command.player, command.vertex);
    case "TradeWithBank":
      return requireStep(state, "build-or-end") ?? tradeWithBank(state, command.player, command.give, command.get);
    case "DiscardCards":
      return requireStep(state, "discard") ?? discardCards(state, command.player, command.cards);
    case "MoveRobber":
      return requireStep(state, "move-robber") ?? moveRobber(state, command.player, command.hex);
    case "StealFrom":
      return requireStep(state, "steal") ?? stealFrom(state, command.player, command.victim, command.pick);
    case "BuyDevelopmentCard":
      return requireStep(state, "build-or-end") ?? buyDevelopmentCard(state, command.player);
    case "PlayKnight":
      return canPlay(state, command.player, "knight") ?? ok([{ type: "KnightPlayed", player: command.player }]);
    case "PlayRoadBuilding":
      return canPlay(state, command.player, "road-building") ?? ok([{ type: "RoadBuildingPlayed", player: command.player }]);
    case "PlayYearOfPlenty":
      return canPlay(state, command.player, "year-of-plenty") ?? yearOfPlenty(state, command.player, command.resources);
    case "PlayMonopoly":
      return (
        canPlay(state, command.player, "monopoly") ??
        (isResource(command.resource)
          ? ok([{ type: "MonopolyPlayed", player: command.player, resource: command.resource }])
          : err({ code: "INVALID_TRADE", reason: "unknown-resource" }))
      );
    default:
      return assertNever(command);
  }
}

/** Starting a game reuses the scoring module's player checks and board dealing, so they exist once. */
function startGame(state: PlayState, command: Extract<PlayCommand, { type: "StartGame" }>): Decision {
  if (state.started) return err({ code: "GAME_ALREADY_STARTED" });
  const players = decideScoring(initialScoringState, { type: "StartGame", players: command.players });
  // From an empty game the only possible refusal is INVALID_PLAYERS.
  if (!players.ok) return err(players.error as Extract<PlayViolation, { code: "INVALID_PLAYERS" }>);
  if (!isValidSeed(command.seed)) return err({ code: "INVALID_SEED", seed: command.seed });
  return ok([
    {
      type: "GameStarted",
      players: [...command.players],
      board: generateBoard(command.seed),
      deck: shuffledDeck(command.seed),
      harbours: dealHarbours(command.seed),
    },
  ]);
}

function requireStep(state: PlayState, step: Step): Decision | null {
  return expectedStep(state) === step ? null : err({ code: "WRONG_STEP", expected: expectedStep(state) ?? step });
}

function placeSetupSettlement(state: PlayState, player: string, vertex: number): Decision {
  if (!TOPOLOGY.vertices[vertex]) return err({ code: "UNKNOWN_SPOT" });
  if (state.buildings[vertex]) return err({ code: "SPOT_TAKEN" });
  if (!isOpenCorner(state, vertex)) return err({ code: "TOO_CLOSE_TO_SETTLEMENT" });
  return ok([{ type: "SetupSettlementPlaced", player, vertex }]);
}

function placeSetupRoad(state: PlayState, player: string, edge: number): Decision {
  const target = TOPOLOGY.edges[edge];
  if (!target) return err({ code: "UNKNOWN_SPOT" });
  // No road can already touch a new setup settlement: the distance rule keeps
  // every road end next to an existing building, so "taken" cannot happen here.
  if (state.pendingSettlement === null || !target.ends.includes(state.pendingSettlement)) {
    return err({ code: "ROAD_NOT_BESIDE_NEW_SETTLEMENT" });
  }
  return ok([{ type: "SetupRoadPlaced", player, edge }]);
}

/** Checks the supply and the cost of a piece; null when the player can build one. */
function payFor(state: PlayState, player: string, piece: Piece): Decision | null {
  if (piecesLeft(state, player)[piece] <= 0) return err({ code: "NO_PIECES_LEFT", piece });
  const short = missing(state.hands[player] ?? emptyHand, COSTS[piece]);
  return handSize(short) > 0 ? err({ code: "CANNOT_AFFORD", piece, missing: short }) : null;
}

function buildRoad(state: PlayState, player: string, edge: number, free: boolean): Decision {
  if (!TOPOLOGY.edges[edge]) return err({ code: "UNKNOWN_SPOT" });
  if (state.roads[edge] !== undefined) return err({ code: "SPOT_TAKEN" });
  if (!connectsToNetwork(state, player, edge)) return err({ code: "ROAD_NOT_CONNECTED" });
  // Road Building only places roads that are left on the board, so no supply check is needed.
  if (free) return ok([{ type: "RoadBuilt", player, edge, free: true }]);
  return payFor(state, player, "road") ?? ok([{ type: "RoadBuilt", player, edge }]);
}

function buildSettlement(state: PlayState, player: string, vertex: number): Decision {
  const corner = TOPOLOGY.vertices[vertex];
  if (!corner) return err({ code: "UNKNOWN_SPOT" });
  if (state.buildings[vertex]) return err({ code: "SPOT_TAKEN" });
  if (!isOpenCorner(state, vertex)) return err({ code: "TOO_CLOSE_TO_SETTLEMENT" });
  if (!corner.edges.some((e) => state.roads[e] === player)) return err({ code: "SETTLEMENT_NOT_ON_ROAD" });
  return payFor(state, player, "settlement") ?? ok([{ type: "SettlementBuilt", player, vertex }]);
}

function buildCity(state: PlayState, player: string, vertex: number): Decision {
  const building = state.buildings[vertex];
  if (building?.player !== player || building.kind !== "settlement") return err({ code: "NOT_YOUR_SETTLEMENT" });
  return payFor(state, player, "city") ?? ok([{ type: "CityBuilt", player, vertex }]);
}

function tradeWithBank(state: PlayState, player: string, give: string, get: string): Decision {
  if (!isResource(give) || !isResource(get)) return err({ code: "INVALID_TRADE", reason: "unknown-resource" });
  if (give === get) return err({ code: "INVALID_TRADE", reason: "same-resource" });
  const rate = tradeRate(state, player, give);
  if ((state.hands[player]?.[give] ?? 0) < rate) return err({ code: "NOT_ENOUGH_TO_TRADE", give, needed: rate });
  if (state.bank[get] < 1) return err({ code: "BANK_EMPTY", resource: get });
  return ok([{ type: "BankTraded", player, give, get, rate }]);
}

function discardCards(state: PlayState, player: string, cards: Hand): Decision {
  const owed = state.pending?.kind === "discard" ? (state.pending.owed[player] ?? 0) : 0;
  if (owed === 0) return err({ code: "NOTHING_TO_DISCARD" });
  const given = RESOURCES.reduce((n, r) => n + (cards[r] ?? 0), 0);
  const whole = RESOURCES.every((r) => Number.isInteger(cards[r] ?? 0) && (cards[r] ?? 0) >= 0);
  if (!whole || given !== owed) return err({ code: "WRONG_DISCARD_COUNT", owed, given });
  const held = state.hands[player] ?? emptyHand;
  if (RESOURCES.some((r) => (cards[r] ?? 0) > held[r])) return err({ code: "NOT_IN_HAND" });
  return ok([{ type: "CardsDiscarded", player, cards: Object.fromEntries(RESOURCES.map((r) => [r, cards[r] ?? 0])) as Hand }]);
}

function moveRobber(state: PlayState, player: string, hex: string): Decision {
  if (!state.board?.hexes.some((h) => `${h.q},${h.r}` === hex)) return err({ code: "UNKNOWN_SPOT" });
  if (hex === state.robber) return err({ code: "ROBBER_MUST_MOVE" });
  return ok([{ type: "RobberMoved", player, hex }]);
}

function stealFrom(state: PlayState, player: string, victim: string, pick: number): Decision {
  const victims = state.pending?.kind === "steal" ? state.pending.victims : [];
  if (!victims.includes(victim)) return err({ code: "NOT_A_VICTIM", victims: [...victims] });
  const resource = Number.isInteger(pick) && pick >= 0 ? cardAt(state.hands[victim] ?? emptyHand, pick) : null;
  if (resource === null) return err({ code: "INVALID_PICK" });
  return ok([{ type: "CardStolen", player, victim, resource }]);
}

function buyDevelopmentCard(state: PlayState, player: string): Decision {
  const card = state.deck[0];
  if (card === undefined) return err({ code: "DECK_EMPTY" });
  const short = missing(state.hands[player] ?? emptyHand, DEV_CARD_COST);
  if (handSize(short) > 0) return err({ code: "CANNOT_AFFORD", piece: "development-card", missing: short });
  return ok([{ type: "DevelopmentCardBought", player, card }]);
}

/**
 * Development cards (not victory points) can be played before or after the
 * roll, one per turn, and never on the turn they were bought.
 */
function canPlay(state: PlayState, player: string, card: DevCard): Decision | null {
  const step = expectedStep(state);
  if (step !== "roll" && step !== "build-or-end") return err({ code: "WRONG_STEP", expected: step ?? "roll" });
  if (!(state.devCards[player] ?? []).some((c) => c.card === card)) return err({ code: "NO_SUCH_CARD", card });
  if (state.playedDevCardThisTurn) return err({ code: "ALREADY_PLAYED_CARD" });
  if (playableCardIndex(state, player, card) < 0) return err({ code: "CARD_TOO_NEW", card });
  return null;
}

function yearOfPlenty(state: PlayState, player: string, resources: readonly [string, string]): Decision {
  if (resources.length !== 2 || !resources.every(isResource)) return err({ code: "INVALID_TRADE", reason: "unknown-resource" });
  const [a, b] = resources as readonly [Resource, Resource];
  for (const r of [a, b]) {
    const wanted = (a === r ? 1 : 0) + (b === r ? 1 : 0);
    if (state.bank[r] < wanted) return err({ code: "BANK_EMPTY", resource: r });
  }
  return ok([{ type: "YearOfPlentyPlayed", player, resources: [a, b] }]);
}

const isDie = (n: number) => Number.isInteger(n) && n >= 1 && n <= 6;

function rollDice(player: string, dice: readonly [number, number]): Decision {
  if (dice.length !== 2 || !dice.every(isDie)) return err({ code: "INVALID_DICE", dice: [...dice] });
  return ok([{ type: "DiceRolled", player, dice: [dice[0], dice[1]] }]);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled command: ${JSON.stringify(value)}`);
}
