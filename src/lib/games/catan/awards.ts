import type { PlayerId } from "./events";

export const LARGEST_ARMY_THRESHOLD = 3;
export const LONGEST_ROAD_THRESHOLD = 5;
export const AWARD_POINTS = 2;

export interface AwardInput {
  /** Current holder, or null if the award is vacant. */
  readonly incumbent: PlayerId | null;
  /** Each player's count (knights played, or longest road length). */
  readonly counts: Readonly<Record<PlayerId, number>>;
  /** Minimum count needed to hold the award. */
  readonly threshold: number;
}

/**
 * One resolver for every exclusive award (Largest Army, Longest Road).
 *
 * Let the leaders be the players with the highest count, provided it reaches
 * the threshold. Then:
 * - the incumbent keeps the award if they are among the leaders (a tie keeps
 *   the incumbent, so a challenger must strictly exceed them);
 * - otherwise a single leader takes the award;
 * - otherwise (nobody qualifies, or leaders tie without the incumbent) the
 *   award is vacant.
 *
 * An incumbent who falls below the threshold is never a leader, so they lose it.
 */
export function resolveExclusiveAward({
  incumbent,
  counts,
  threshold,
}: AwardInput): PlayerId | null {
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;

  const highest = Math.max(...entries.map(([, count]) => count));
  if (highest < threshold) return null;

  const leaders = entries
    .filter(([, count]) => count === highest)
    .map(([id]) => id);

  if (incumbent !== null && leaders.includes(incumbent)) return incumbent;
  return leaders.length === 1 ? (leaders[0] ?? null) : null;
}
