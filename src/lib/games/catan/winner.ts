import type { PlayerId } from "./events";
import type { CatanState } from "./state";

export type GameResult =
  | { readonly status: "won"; readonly winner: PlayerId }
  | { readonly status: "incomplete" };

/** The match result: a winner once someone reaches 10 points, else incomplete. */
export function gameResult(state: CatanState): GameResult {
  return state.winner === null
    ? { status: "incomplete" }
    : { status: "won", winner: state.winner };
}
