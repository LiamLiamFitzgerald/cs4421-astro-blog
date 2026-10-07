import { err, ok, type Result } from "../../core/result";
import type { CatanCommand } from "./commands";
import type { CatanEvent, PlayerId } from "./events";
import type { CatanState } from "./state";
import type { RuleViolation } from "./violations";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const MAX_ROAD_LENGTH = 15;

/**
 * Checks a command against the rules. Returns the events it produces or the
 * rule it breaks. Pure: it never changes `state`.
 */
export function decide(
  state: CatanState,
  command: CatanCommand,
): Result<readonly CatanEvent[], RuleViolation> {
  if (command.type === "StartGame") return startGame(state, command.players);

  if (!state.started) return err({ code: "GAME_NOT_STARTED" });
  if (state.winner !== null) {
    return err({ code: "GAME_OVER", winner: state.winner });
  }

  const player = state.players[command.player];
  if (!player) return err({ code: "UNKNOWN_PLAYER", player: command.player });

  switch (command.type) {
    case "BuildSettlement":
      return ok([{ type: "SettlementBuilt", player: command.player }]);
    case "UpgradeSettlement":
      return player.settlements > 0
        ? ok([{ type: "SettlementUpgraded", player: command.player }])
        : err({ code: "NO_SETTLEMENT_TO_UPGRADE", player: command.player });
    case "RevealVictoryPointCard":
      return ok([{ type: "VictoryPointCardRevealed", player: command.player }]);
    case "PlayKnight":
      return ok([{ type: "KnightPlayed", player: command.player }]);
    case "RecordRoadLength":
      return isValidRoadLength(command.length)
        ? ok([
            {
              type: "RoadLengthRecorded",
              player: command.player,
              length: command.length,
            },
          ])
        : err({ code: "INVALID_ROAD_LENGTH", length: command.length });
    default:
      return assertNever(command);
  }
}

function startGame(
  state: CatanState,
  players: readonly PlayerId[],
): Result<readonly CatanEvent[], RuleViolation> {
  if (state.started) return err({ code: "GAME_ALREADY_STARTED" });

  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    return err({
      code: "INVALID_PLAYERS",
      reason: `a game needs ${MIN_PLAYERS} to ${MAX_PLAYERS} players`,
    });
  }
  if (players.some((id) => id.trim() === "")) {
    return err({ code: "INVALID_PLAYERS", reason: "player ids must not be blank" });
  }
  if (new Set(players).size !== players.length) {
    return err({ code: "INVALID_PLAYERS", reason: "player ids must be unique" });
  }
  return ok([{ type: "GameStarted", players: [...players] }]);
}

function isValidRoadLength(length: number): boolean {
  return Number.isInteger(length) && length >= 0 && length <= MAX_ROAD_LENGTH;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled command: ${JSON.stringify(value)}`);
}
