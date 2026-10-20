import type { CatanEvent, PlayerId } from "../games/catan/events";
import { totalPoints } from "../games/catan/score";
import type { CatanState } from "../games/catan/state";
import type { RuleViolation } from "../games/catan/violations";

/** One line of the scoreboard, ready to display. */
export interface ScoreRow {
  readonly player: PlayerId;
  readonly points: number;
  readonly settlements: number;
  readonly cities: number;
  readonly victoryPointCards: number;
  readonly knights: number;
  readonly roadLength: number;
  readonly hasLargestArmy: boolean;
  readonly hasLongestRoad: boolean;
  readonly isWinner: boolean;
}

/** Turns the derived state into rows in seating order. Pure: no DOM, no storage. */
export function buildScoreboard(state: CatanState): ScoreRow[] {
  return state.playerOrder.flatMap((player) => {
    const tally = state.players[player];
    if (!tally) return [];
    return [
      {
        player,
        points: totalPoints(state, player),
        settlements: tally.settlements,
        cities: tally.cities,
        victoryPointCards: tally.victoryPointCards,
        knights: tally.knights,
        roadLength: tally.roadLength,
        hasLargestArmy: state.largestArmy === player,
        hasLongestRoad: state.longestRoad === player,
        isWinner: state.winner === player,
      },
    ];
  });
}

/** Plain-English reason a command was refused. */
export function describeViolation(violation: RuleViolation): string {
  switch (violation.code) {
    case "GAME_ALREADY_STARTED":
      return "The game has already started.";
    case "GAME_NOT_STARTED":
      return "Start a game first.";
    case "GAME_OVER":
      return `The game is over: ${violation.winner} has already won.`;
    case "INVALID_PLAYERS":
      return `${violation.reason.charAt(0).toUpperCase()}${violation.reason.slice(1)}.`;
    case "UNKNOWN_PLAYER":
      return `${violation.player} is not in this game.`;
    case "NO_SETTLEMENT_TO_UPGRADE":
      return `${violation.player} has no settlement to upgrade.`;
    case "INVALID_ROAD_LENGTH":
      return `${violation.length} is not a valid road length.`;
    case "INVALID_SEED":
      return `${violation.seed} is not a valid board seed.`;
  }
}

/** One-line description of a stored event, for the history list. */
export function describeEvent(event: CatanEvent): string {
  switch (event.type) {
    case "GameStarted":
      return `Game started: ${event.players.join(", ")}`;
    case "SettlementBuilt":
      return `${event.player} built a settlement`;
    case "SettlementUpgraded":
      return `${event.player} upgraded a settlement to a city`;
    case "VictoryPointCardRevealed":
      return `${event.player} revealed a victory point card`;
    case "KnightPlayed":
      return `${event.player} played a knight`;
    case "RoadLengthRecorded":
      return `${event.player} has a road of length ${event.length}`;
  }
}

/** Trims the name fields and drops empty ones. The rules (count, duplicates) stay in `decide`. */
export function parsePlayerNames(fields: readonly string[]): string[] {
  return fields.map((name) => name.trim()).filter((name) => name !== "");
}

/** Reads a `?seed=` value. Returns null when it is missing or not a whole number. */
export function parseSeed(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  return Number(value);
}

/** What to tell the player when something fails that the rules did not expect. */
export interface FailureMessage {
  readonly title: string;
  readonly advice: string;
  /** Short technical summary for bug reports. Never includes a stack trace. */
  readonly detail: string;
}

export function describeFailure(error: unknown): FailureMessage {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  const detail = `${name}: ${message}`.slice(0, 200);
  if (name === "QuotaExceededError") {
    return {
      title: "The game could not be saved because browser storage is full.",
      advice: "Free up space for this site, or start a new game, then try again.",
      detail,
    };
  }
  if (name === "SecurityError") {
    return {
      title: "This browser is blocking storage for this site.",
      advice: "Allow site data for this page, or use a normal (not private) window, then try again.",
      detail,
    };
  }
  return {
    title: "Something went wrong and the action was not saved.",
    advice: "Try again. If it keeps happening, reload the page; your saved game is kept.",
    detail,
  };
}
