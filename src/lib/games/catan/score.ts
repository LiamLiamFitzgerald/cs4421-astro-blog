import type { PlayerId } from "./events";
import type { CatanState, PlayerState } from "./state";

export const SETTLEMENT_POINTS = 1;
export const CITY_POINTS = 2;
export const VICTORY_POINT_CARD_POINTS = 1;

/** Victory points from pieces and VP cards only (no awards). */
export function basePoints(player: PlayerState): number {
  return (
    player.settlements * SETTLEMENT_POINTS +
    player.cities * CITY_POINTS +
    player.victoryPointCards * VICTORY_POINT_CARD_POINTS
  );
}

/** Base points for every player in the match. */
export function baseScoreboard(state: CatanState): Record<PlayerId, number> {
  return Object.fromEntries(
    Object.entries(state.players).map(([id, player]) => [id, basePoints(player)]),
  );
}
