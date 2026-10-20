import type { PlayerId } from "../catan/events";
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
  | { readonly code: "ROAD_NOT_BESIDE_NEW_SETTLEMENT" };
