import { err, ok, type Result } from "../core/result";

/** Largest report body accepted, in bytes. Anything bigger is refused unread. */
export const MAX_REPORT_BYTES = 32768;

/** Largest event log a browser attaches, as JSON characters. Longer logs are left out. */
export const MAX_LOG_CHARS = 24000;

/** Most events a report may carry. */
const MAX_LOG_EVENTS = 2000;

/** The game a report came from (ADR-014), so the failure can be replayed. */
export interface GameContext {
  /** Which game, as stored in the browser. */
  readonly id: string;
  /** The event-log schema version. */
  readonly version: number;
  /** How many events the game had, even when the log itself is left out. */
  readonly eventCount: number;
  /** The log, when small enough to attach. */
  readonly events?: readonly { readonly type: string }[];
  /** True when the log was too long to attach. */
  readonly eventsOmitted?: true;
}

/** An unexpected error seen in a visitor's browser, as accepted by the server. */
export interface ClientErrorReport {
  /** Where in the app it happened, for example "command:BuildSettlement". */
  readonly context: string;
  readonly name: string;
  readonly message: string;
  /** Path of the page, without query string. */
  readonly page: string;
  /** Present when the error happened during a game. */
  readonly game?: GameContext;
}

const LIMITS = { context: 100, name: 100, message: 500, page: 200 } as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCount = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;

function parseGameContext(value: unknown): Result<GameContext, string> {
  if (!isRecord(value)) return err("game must be an object");
  const { id, version, eventCount, events, eventsOmitted } = value;
  if (typeof id !== "string" || id.trim() === "" || id.length > 100)
    return err("game.id must be 1 to 100 characters");
  if (!isCount(version, 1000)) return err("game.version must be a whole number");
  if (!isCount(eventCount, 100000)) return err("game.eventCount must be a whole number");
  if (events !== undefined) {
    if (!Array.isArray(events) || events.length > MAX_LOG_EVENTS) {
      return err(`game.events must be a list of at most ${MAX_LOG_EVENTS} events`);
    }
    if (!events.every((e) => isRecord(e) && typeof e["type"] === "string")) {
      return err("game.events must be objects with a type");
    }
  }
  return ok({
    id,
    version,
    eventCount,
    ...(events === undefined ? {} : { events: events as GameContext["events"] }),
    ...(eventsOmitted === true ? { eventsOmitted: true as const } : {}),
  });
}

/**
 * Builds the game part of a report from a stored log. Items that are not
 * events are kept as a bare "unreadable" marker so the position stays visible.
 * A log too long to send is left out, with its length.
 */
export function buildGameContext(
  id: string,
  version: number,
  stored: readonly unknown[],
): GameContext {
  const events = stored.map((e) =>
    isRecord(e) && typeof e["type"] === "string" ? (e as { type: string }) : { type: "unreadable" },
  );
  if (events.length > MAX_LOG_EVENTS || JSON.stringify(events).length > MAX_LOG_CHARS) {
    return { id, version, eventCount: stored.length, eventsOmitted: true };
  }
  return { id, version, eventCount: stored.length, events };
}

/**
 * Validates an untrusted report body. Pure, so the API route stays thin and
 * every rule here is unit- and mutation-tested. Returns why a report was
 * refused rather than throwing.
 */
export function parseClientErrorReport(body: unknown): Result<ClientErrorReport, string> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return err("report must be a JSON object");
  }
  const fields = body as Record<string, unknown>;
  const report: Partial<Record<keyof typeof LIMITS, string>> = {};
  for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const value = fields[key] ?? (key === "name" ? "Error" : undefined);
    if (typeof value !== "string" || value.trim() === "")
      return err(`${key} must be a non-empty string`);
    if (value.length > LIMITS[key]) return err(`${key} must be at most ${LIMITS[key]} characters`);
    report[key] = value;
  }
  const complete = report as Omit<ClientErrorReport, "game">;
  if (!complete.page.startsWith("/")) return err("page must be a path starting with /");
  if (fields["game"] === undefined) return ok(complete);
  const game = parseGameContext(fields["game"]);
  return game.ok ? ok({ ...complete, game: game.value }) : err(game.error);
}
