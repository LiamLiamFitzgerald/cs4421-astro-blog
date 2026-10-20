import { err, ok, type Result } from "../../core/result";
import { generateBoard, isValidSeed } from "../catan/board";
import { decide as decideScoring } from "../catan/decide";
import { initialState as initialScoringState } from "../catan/state";
import type { PlayCommand } from "./commands";
import type { PlayEvent } from "./events";
import { currentPlayer, expectedStep, isOpenCorner } from "./queries";
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

const isDie = (n: number) => Number.isInteger(n) && n >= 1 && n <= 6;

function rollDice(player: string, dice: readonly [number, number]): Decision {
  if (dice.length !== 2 || !dice.every(isDie)) return err({ code: "INVALID_DICE", dice: [...dice] });
  return ok([{ type: "DiceRolled", player, dice: [dice[0], dice[1]] }]);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled command: ${JSON.stringify(value)}`);
}
