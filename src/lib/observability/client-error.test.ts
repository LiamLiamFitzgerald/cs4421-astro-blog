import { describe, expect, it } from "vitest";
import {
  buildGameContext,
  MAX_LOG_CHARS,
  MAX_REPORT_BYTES,
  parseClientErrorReport,
} from "./client-error";

const valid = {
  context: "command:BuildSettlement",
  name: "QuotaExceededError",
  message: "Quota exceeded",
  page: "/catan",
};

describe("Feature: accepting browser error reports", () => {
  it("given a valid report, it is accepted as is", () => {
    expect(parseClientErrorReport(valid)).toEqual({ ok: true, value: valid });
  });

  it("given no name, it defaults to Error", () => {
    const rest: Partial<typeof valid> = { ...valid };
    delete rest.name;
    expect(parseClientErrorReport(rest)).toEqual({ ok: true, value: { ...rest, name: "Error" } });
  });

  it("given extra fields, they are dropped", () => {
    const result = parseClientErrorReport({ ...valid, stack: "secret", cookie: "x" });
    expect(result.ok && Object.keys(result.value).sort()).toEqual([
      "context",
      "message",
      "name",
      "page",
    ]);
  });

  it.each([null, "text", 42, [valid]])("given %j, it is refused", (body) => {
    expect(parseClientErrorReport(body)).toEqual({
      ok: false,
      error: "report must be a JSON object",
    });
  });

  it.each(["context", "message", "page"])("given no %s, it is refused", (key) => {
    const body: Record<string, unknown> = { ...valid };
    delete body[key];
    expect(parseClientErrorReport(body)).toEqual({
      ok: false,
      error: `${key} must be a non-empty string`,
    });
  });

  it.each(["context", "name", "message", "page"])("given a blank %s, it is refused", (key) => {
    expect(parseClientErrorReport({ ...valid, [key]: "  " })).toEqual({
      ok: false,
      error: `${key} must be a non-empty string`,
    });
  });

  it("given a field that is not a string, it is refused", () => {
    expect(parseClientErrorReport({ ...valid, message: 5 }).ok).toBe(false);
  });

  it.each([
    ["context", 100],
    ["name", 100],
    ["message", 500],
    ["page", 200],
  ] as const)(
    "given %s at its limit of %i characters, it is accepted, and one more is refused",
    (key, limit) => {
      const at = key === "page" ? `/${"a".repeat(limit - 1)}` : "a".repeat(limit);
      expect(parseClientErrorReport({ ...valid, [key]: at }).ok).toBe(true);
      expect(parseClientErrorReport({ ...valid, [key]: `${at}a` })).toEqual({
        ok: false,
        error: `${key} must be at most ${limit} characters`,
      });
    },
  );

  it("given a page that is a full URL, it is refused", () => {
    expect(parseClientErrorReport({ ...valid, page: "https://evil.example/" })).toEqual({
      ok: false,
      error: "page must be a path starting with /",
    });
  });
});

const game = {
  id: "local",
  version: 1,
  eventCount: 2,
  events: [{ type: "GameStarted" }, { type: "TurnEnded" }],
};

describe("Feature: reports that carry the game", () => {
  it("given no game, the report has none", () => {
    const result = parseClientErrorReport(valid);
    expect(result.ok && "game" in result.value).toBe(false);
  });

  it("given a game with its log, it is accepted as is", () => {
    expect(parseClientErrorReport({ ...valid, game })).toEqual({
      ok: true,
      value: { ...valid, game },
    });
  });

  it("given a game whose log was left out, that is kept", () => {
    const sent = { id: "local", version: 1, eventCount: 900, eventsOmitted: true };
    expect(parseClientErrorReport({ ...valid, game: sent })).toEqual({
      ok: true,
      value: { ...valid, game: sent },
    });
  });

  it("given extra fields on the game, they are dropped", () => {
    const result = parseClientErrorReport({ ...valid, game: { ...game, secret: "x" } });
    expect(result.ok && Object.keys(result.value.game ?? {}).sort()).toEqual([
      "eventCount",
      "events",
      "id",
      "version",
    ]);
  });

  it.each([null, "x", 3, [game]])("given a game of %j, it is refused", (bad) => {
    expect(parseClientErrorReport({ ...valid, game: bad })).toEqual({
      ok: false,
      error: "game must be an object",
    });
  });

  it.each(["", "  ", "x".repeat(101), 5])("given a game id of %j, it is refused", (id) => {
    expect(parseClientErrorReport({ ...valid, game: { ...game, id } })).toEqual({
      ok: false,
      error: "game.id must be 1 to 100 characters",
    });
  });

  it("accepts a game id of exactly 100 characters", () => {
    expect(parseClientErrorReport({ ...valid, game: { ...game, id: "x".repeat(100) } }).ok).toBe(
      true,
    );
  });

  it.each([-1, 1.5, 1001, "1"])("given a version of %j, it is refused", (version) => {
    expect(parseClientErrorReport({ ...valid, game: { ...game, version } })).toEqual({
      ok: false,
      error: "game.version must be a whole number",
    });
  });

  it("accepts versions 0 and 1000", () => {
    expect(parseClientErrorReport({ ...valid, game: { ...game, version: 0 } }).ok).toBe(true);
    expect(parseClientErrorReport({ ...valid, game: { ...game, version: 1000 } }).ok).toBe(true);
  });

  it.each([-1, 2.5, 100001, null])("given an event count of %j, it is refused", (eventCount) => {
    expect(parseClientErrorReport({ ...valid, game: { ...game, eventCount } })).toEqual({
      ok: false,
      error: "game.eventCount must be a whole number",
    });
  });

  it("accepts event counts of 0 and 100000", () => {
    expect(parseClientErrorReport({ ...valid, game: { ...game, eventCount: 0 } }).ok).toBe(true);
    expect(parseClientErrorReport({ ...valid, game: { ...game, eventCount: 100000 } }).ok).toBe(
      true,
    );
  });

  it("given a log that is not a list, or is too long, it is refused", () => {
    const error = "game.events must be a list of at most 2000 events";
    expect(parseClientErrorReport({ ...valid, game: { ...game, events: "x" } })).toEqual({
      ok: false,
      error,
    });
    expect(parseClientErrorReport({ ...valid, game: { ...game, events: {} } })).toEqual({
      ok: false,
      error,
    });
    const many = Array.from({ length: 2001 }, () => ({ type: "TurnEnded" }));
    expect(parseClientErrorReport({ ...valid, game: { ...game, events: many } })).toEqual({
      ok: false,
      error,
    });
  });

  it("accepts a log of exactly 2000 events", () => {
    const many = Array.from({ length: 2000 }, () => ({ type: "TurnEnded" }));
    expect(parseClientErrorReport({ ...valid, game: { ...game, events: many } }).ok).toBe(true);
  });

  it("given log entries that are not objects with a type, it is refused", () => {
    const error = "game.events must be objects with a type";
    for (const events of [[1], [null], [{}], [{ type: 3 }], [[{ type: "a" }]]]) {
      expect(parseClientErrorReport({ ...valid, game: { ...game, events } })).toEqual({
        ok: false,
        error,
      });
    }
  });

  it("allows reports big enough to carry a log", () => {
    expect(MAX_REPORT_BYTES).toBeGreaterThan(MAX_LOG_CHARS);
  });
});

describe("Feature: building the game part of a report", () => {
  it("given a small log, attaches it with its length and version", () => {
    const stored = [{ type: "GameStarted", players: ["ana"] }, { type: "TurnEnded" }];
    expect(buildGameContext("local", 1, stored)).toEqual({
      id: "local",
      version: 1,
      eventCount: 2,
      events: stored,
    });
  });

  it("given entries that are not events, marks their place without their content", () => {
    const built = buildGameContext("g", 1, [{ type: "A" }, null, "x", { nope: 1 }, { type: 4 }]);
    expect(built.events).toEqual([
      { type: "A" },
      { type: "unreadable" },
      { type: "unreadable" },
      { type: "unreadable" },
      { type: "unreadable" },
    ]);
    expect(built.eventCount).toBe(5);
  });

  it("given a log too long to send, leaves it out but keeps the length", () => {
    const stored = Array.from({ length: 1500 }, () => ({
      type: "DiceRolled",
      player: "ana",
      dice: [3, 4],
      padding: "x".repeat(20),
    }));
    const built = buildGameContext("g", 1, stored);
    expect(built).toEqual({ id: "g", version: 1, eventCount: 1500, eventsOmitted: true });
  });

  it("given more events than a report may carry, leaves them out", () => {
    const stored = Array.from({ length: 2001 }, () => ({ type: "T" }));
    expect(buildGameContext("g", 1, stored)).toEqual({
      id: "g",
      version: 1,
      eventCount: 2001,
      eventsOmitted: true,
    });
  });

  it("attaches a log of exactly the largest allowed size", () => {
    const filler = (n: number) => [{ type: "x".repeat(n) }];
    const overhead = JSON.stringify(filler(0)).length;
    const exact = buildGameContext("g", 1, filler(MAX_LOG_CHARS - overhead));
    expect(exact.events).toBeDefined();
    const over = buildGameContext("g", 1, filler(MAX_LOG_CHARS - overhead + 1));
    expect(over.eventsOmitted).toBe(true);
  });

  it("produces something the server accepts", () => {
    const built = buildGameContext("local", 1, [{ type: "GameStarted" }]);
    expect(
      parseClientErrorReport({ context: "c", name: "E", message: "m", page: "/catan", game: built })
        .ok,
    ).toBe(true);
  });
});
