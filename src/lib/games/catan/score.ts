import { AWARD_POINTS } from "./awards";
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

/** Bonus points from Largest Army and Longest Road. */
export function awardPoints(state: CatanState, player: PlayerId): number {
  return (
    (state.largestArmy === player ? AWARD_POINTS : 0) +
    (state.longestRoad === player ? AWARD_POINTS : 0)
  );
}
