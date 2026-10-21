import type { PlayerId } from "../catan/events";
import type { Hand, Piece, Resource } from "./resources";
import type { Step } from "./state";

/** Why a command was refused. */
export type PlayViolation =
  | { readonly code: "GAME_ALREADY_STARTED" }
  | { readonly code: "GAME_NOT_STARTED" }
  | { readonly code: "GAME_OVER"; readonly winner: PlayerId }
  | { readonly code: "INVALID_PLAYERS"; readonly reason: string }
  | { readonly code: "INVALID_SEED"; readonly seed: number }
  | { readonly code: "NOT_YOUR_TURN"; readonly player: PlayerId; readonly current: PlayerId }
  | { readonly code: "WRONG_STEP"; readonly expected: Step }
  | { readonly code: "UNKNOWN_SPOT" }
  | { readonly code: "SPOT_TAKEN" }
  | { readonly code: "TOO_CLOSE_TO_SETTLEMENT" }
  | { readonly code: "ROAD_NOT_BESIDE_NEW_SETTLEMENT" }
  | { readonly code: "INVALID_DICE"; readonly dice: readonly number[] }
  | { readonly code: "CANNOT_AFFORD"; readonly piece: Piece; readonly missing: Hand }
  | { readonly code: "NO_PIECES_LEFT"; readonly piece: Piece }
  | { readonly code: "ROAD_NOT_CONNECTED" }
  | { readonly code: "SETTLEMENT_NOT_ON_ROAD" }
  | { readonly code: "NOT_YOUR_SETTLEMENT" }
  | { readonly code: "INVALID_TRADE"; readonly reason: "same-resource" | "unknown-resource" }
  | { readonly code: "NOT_ENOUGH_TO_TRADE"; readonly give: Resource; readonly needed: number }
  | { readonly code: "BANK_EMPTY"; readonly resource: Resource };
