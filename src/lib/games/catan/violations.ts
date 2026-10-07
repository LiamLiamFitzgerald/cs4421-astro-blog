import type { PlayerId } from "./events";

/** Why a command was refused. */
export type RuleViolation =
  | { readonly code: "GAME_ALREADY_STARTED" }
  | { readonly code: "GAME_NOT_STARTED" }
  | { readonly code: "GAME_OVER"; readonly winner: PlayerId }
  | { readonly code: "INVALID_PLAYERS"; readonly reason: string }
  | { readonly code: "UNKNOWN_PLAYER"; readonly player: PlayerId }
  | { readonly code: "NO_SETTLEMENT_TO_UPGRADE"; readonly player: PlayerId }
  | { readonly code: "INVALID_ROAD_LENGTH"; readonly length: number };
