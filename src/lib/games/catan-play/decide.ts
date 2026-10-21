import { err, ok, type Result } from "../../core/result";
import { generateBoard, isValidSeed } from "../catan/board";
import { decide as decideScoring } from "../catan/decide";
import { initialState as initialScoringState } from "../catan/state";
import type { PlayCommand } from "./commands";
import type { PlayEvent } from "./events";
import { connectsToNetwork, currentPlayer, expectedStep, isOpenCorner, piecesLeft } from "./queries";
import { BANK_TRADE_RATE, COSTS, emptyHand, handSize, isResource, missing, type Piece } from "./resources";
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

  const current = currentPlayer(state);
  if (current !== null && command.player !== current) {
    return err({ code: "NOT_YOUR_TURN", player: command.player, current });
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
      return requireStep(state, "build-or-end") ?? buildRoad(state, command.player, command.edge);
    case "BuildSettlement":
      return requireStep(state, "build-or-end") ?? buildSettlement(state, command.player, command.vertex);
    case "BuildCity":
      return requireStep(state, "build-or-end") ?? buildCity(state, command.player, command.vertex);
    case "TradeWithBank":
      return requireStep(state, "build-or-end") ?? tradeWithBank(state, command.player, command.give, command.get);
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
  return ok([{ type: "GameStarted", players: [...command.players], board: generateBoard(command.seed) }]);
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

function buildRoad(state: PlayState, player: string, edge: number): Decision {
  if (!TOPOLOGY.edges[edge]) return err({ code: "UNKNOWN_SPOT" });
  if (state.roads[edge] !== undefined) return err({ code: "SPOT_TAKEN" });
  if (!connectsToNetwork(state, player, edge)) return err({ code: "ROAD_NOT_CONNECTED" });
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
  if ((state.hands[player]?.[give] ?? 0) < BANK_TRADE_RATE) {
    return err({ code: "NOT_ENOUGH_TO_TRADE", give, needed: BANK_TRADE_RATE });
  }
  if (state.bank[get] < 1) return err({ code: "BANK_EMPTY", resource: get });
  return ok([{ type: "BankTraded", player, give, get }]);
}

const isDie = (n: number) => Number.isInteger(n) && n >= 1 && n <= 6;

function rollDice(player: string, dice: readonly [number, number]): Decision {
  if (dice.length !== 2 || !dice.every(isDie)) return err({ code: "INVALID_DICE", dice: [...dice] });
  return ok([{ type: "DiceRolled", player, dice: [dice[0], dice[1]] }]);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled command: ${JSON.stringify(value)}`);
}
