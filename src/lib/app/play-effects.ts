import type { PlayState } from "../games/catan-play/state";
import { points } from "../games/catan-play/queries";

/**
 * The big moments worth celebrating on screen (ADR-020). Worked out by
 * comparing what a screen showed before with what it shows now, so they work
 * the same for a move made on this screen and one pushed from another phone.
 */
export type PlayEffect =
  | { readonly kind: "win"; readonly player: string }
  | { readonly kind: "stolen"; readonly thief: string; readonly victim: string }
  | { readonly kind: "robber" }
  | { readonly kind: "seven" }
  | { readonly kind: "city"; readonly player: string; readonly vertex: number }
  | { readonly kind: "award"; readonly award: "longest-road" | "largest-army"; readonly player: string }
  | { readonly kind: "lead"; readonly player: string }
  | { readonly kind: "settlement"; readonly player: string; readonly vertex: number };

export interface Seen {
  readonly state: PlayState;
  readonly history: readonly string[];
}

/** Matches the words describePlayEvent uses for a steal (which card is never said). */
const STEAL = /^(.+) stole a card from (.+)$/;

/** Points by player, and the single leader (null when tied or nobody has scored). */
function leader(state: PlayState): string | null {
  const scored = state.players.map((p) => ({ p, n: points(state, p) })).sort((a, b) => b.n - a.n);
  const [first, second] = scored;
  if (!first || first.n === 0 || (second && second.n === first.n)) return null;
  return first.p;
}

/** Effects of the change from `before` to `after`, most important first. None for the first view. */
export function detectEffects(before: Seen | null, after: Seen): PlayEffect[] {
  if (!before || !before.state.started) return [];
  const was = before.state;
  const now = after.state;
  const effects: PlayEffect[] = [];

  if (now.winner && now.winner !== was.winner) effects.push({ kind: "win", player: now.winner });

  for (const line of after.history.slice(before.history.length)) {
    const steal = STEAL.exec(line);
    if (steal?.[1] && steal[2]) effects.push({ kind: "stolen", thief: steal[1], victim: steal[2] });
  }

  if (now.robber !== was.robber && now.phase !== "setup") effects.push({ kind: "robber" });

  const rolledNow = JSON.stringify(now.lastRoll) !== JSON.stringify(was.lastRoll);
  if (rolledNow && now.lastRoll?.total === 7) effects.push({ kind: "seven" });

  const builds: PlayEffect[] = [];
  for (const [key, building] of Object.entries(now.buildings)) {
    const vertex = Number(key);
    const old = was.buildings[vertex];
    if (building.kind === "city" && old?.kind !== "city") effects.push({ kind: "city", player: building.player, vertex });
    else if (!old) builds.push({ kind: "settlement", player: building.player, vertex });
  }

  if (now.longestRoad && now.longestRoad !== was.longestRoad) {
    effects.push({ kind: "award", award: "longest-road", player: now.longestRoad });
  }
  if (now.largestArmy && now.largestArmy !== was.largestArmy) {
    effects.push({ kind: "award", award: "largest-army", player: now.largestArmy });
  }

  const lead = leader(now);
  if (!now.winner && now.phase !== "setup" && lead && lead !== leader(was)) effects.push({ kind: "lead", player: lead });

  return [...effects, ...builds];
}

/** The banner for an effect: a short shout and which icon goes with it. */
export function describeEffect(effect: PlayEffect): { readonly text: string; readonly icon: string } {
  switch (effect.kind) {
    case "win":
      return { text: `${effect.player} wins!`, icon: "crown" };
    case "stolen":
      return { text: `${effect.thief} robbed ${effect.victim}!`, icon: "knight" };
    case "robber":
      return { text: "The robber moves!", icon: "knight" };
    case "seven":
      return { text: "Seven! Robber time", icon: "dice" };
    case "city":
      return { text: `${effect.player} built a city!`, icon: "city" };
    case "award":
      return effect.award === "longest-road"
        ? { text: `Longest Road: ${effect.player}`, icon: "trophy" }
        : { text: `Largest Army: ${effect.player}`, icon: "army" };
    case "lead":
      return { text: `${effect.player} takes the lead!`, icon: "crown" };
    case "settlement":
      return { text: `${effect.player} settled`, icon: "settlement" };
  }
}

/** Players ranked by points (ties keep seating order), with their rank from 1. */
export function ranking(state: PlayState): { readonly player: string; readonly points: number; readonly rank: number }[] {
  const scored = state.players.map((player, seat) => ({ player, seat, points: points(state, player) }));
  scored.sort((a, b) => b.points - a.points || a.seat - b.seat);
  let rank = 0;
  let previous = Number.NaN;
  return scored.map((s, i) => {
    if (s.points !== previous) rank = i + 1;
    previous = s.points;
    return { player: s.player, points: s.points, rank };
  });
}
