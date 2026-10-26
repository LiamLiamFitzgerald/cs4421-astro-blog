import { describe, expect, it } from "vitest";
import { MemoryRoomRepository } from "../adapters/memory-room-repository";
import { replayPlay } from "../games/catan-play/evolve";
import { legalSetupSettlements } from "../games/catan-play/queries";
import { createRateLimiter } from "./rate-limit";
import { getRoom, postRoom, type RoomLimits } from "./room-api";
import type { RoomDeps } from "./rooms";

function setup(limit = 1000) {
  let n = 0;
  let r = 0;
  // One clock for the service and the store, so rooms never expire mid-test whatever today's date is.
  const now = () => new Date("2026-10-23T18:00:00Z");
  const deps: RoomDeps = {
    rooms: new MemoryRoomRepository(now),
    random: (max) => r++ % max,
    now,
    newToken: () => `t${++n}`,
    hashToken: (t) => `#${t}`,
  };
  const limiter = () => createRateLimiter(limit, 60_000, () => 0);
  const limits: RoomLimits = { create: limiter(), join: limiter(), command: limiter(), view: limiter() };
  return { deps, limits };
}

const body = (res: { body: unknown }) => res.body as Record<string, unknown>;

async function room(s = setup()) {
  const created = await postRoom(s.deps, s.limits, { action: "create", names: [" Ana ", "Ben"] }, null, "ip");
  const code = body(created)["code"] as string;
  const ana = body(await postRoom(s.deps, s.limits, { action: "join", code, seat: 0 }, null, "ip"))["token"] as string;
  return { ...s, created, code, ana };
}

describe("Feature: creating and joining rooms over HTTP", () => {
  it("given names, creates a room (201) with trimmed names", async () => {
    const { created, deps, code } = await room();
    expect(created.status).toBe(201);
    expect((await deps.rooms.get(code))?.names).toEqual(["Ana", "Ben"]);
  });

  it("given a free seat, joins it (201) and returns the token and player", async () => {
    const s = await room();
    const joined = await postRoom(s.deps, s.limits, { action: "join", code: s.code.toLowerCase(), seat: 1 }, null, "ip");
    expect(joined).toEqual({ status: 201, body: { token: "t2", player: "Ben" } });
  });

  it("given a taken seat, answers 409", async () => {
    const s = await room();
    expect((await postRoom(s.deps, s.limits, { action: "join", code: s.code, seat: 0 }, null, "ip")).status).toBe(409);
  });

  it("given names the rules refuse, answers 422 with the reason", async () => {
    const s = setup();
    const res = await postRoom(s.deps, s.limits, { action: "create", names: ["Solo"] }, null, "ip");
    expect(res.status).toBe(422);
    expect(body(res)["violation"]).toMatchObject({ code: "INVALID_PLAYERS" });
  });

  it.each([
    [null, "request must be a JSON object"],
    [[1], "request must be a JSON object"],
    [{}, "action must be create, join or command"],
    [{ action: "delete" }, "action must be create, join or command"],
    [{ action: "create", names: "Ana,Ben" }, "names must be a list of names"],
    [{ action: "create", names: ["Ana", 2] }, "names must be a list of names"],
    [{ action: "join", code: "AB", seat: 0 }, "code must be a 4-letter room code"],
    [{ action: "join", code: 12, seat: 0 }, "code must be a 4-letter room code"],
    [{ action: "join", code: "ABCD", seat: "0" }, "seat must be a seat number"],
    [{ action: "command", code: "nope", command: {} }, "code must be a 4-letter room code"],
  ])("given %j, answers 400: %s", async (input, error) => {
    const s = setup();
    expect(await postRoom(s.deps, s.limits, input, "tok", "ip")).toEqual({ status: 400, body: { error } });
  });

  it("given an unknown room, answers 404 with its code", async () => {
    const s = setup();
    const res = await postRoom(s.deps, s.limits, { action: "join", code: "ZZZZ", seat: 0 }, null, "ip");
    expect(res.status).toBe(404);
    expect(body(res)["code"]).toBe("NO_SUCH_ROOM");
  });
});

describe("Feature: playing over HTTP", () => {
  it("given a seat's token and a legal move, applies it and returns the new version", async () => {
    const s = await room();
    const vertex = legalSetupSettlements(replayPlay(await s.deps.rooms.events(s.code)))[0];
    const res = await postRoom(
      s.deps,
      s.limits,
      { action: "command", code: s.code, command: { type: "PlaceSetupSettlement", player: "Ana", vertex } },
      s.ana,
      "ip",
    );
    expect(res).toEqual({ status: 200, body: { moves: 2 } });
  });

  it("given no token, answers 401", async () => {
    const s = await room();
    expect((await postRoom(s.deps, s.limits, { action: "command", code: s.code, command: { type: "EndTurn", player: "Ana" } }, null, "ip")).status).toBe(401);
  });

  it("given a malformed command, answers 400 with what is wrong", async () => {
    const s = await room();
    expect(await postRoom(s.deps, s.limits, { action: "command", code: s.code, command: { type: "BuildCity", player: "Ana" } }, s.ana, "ip")).toEqual({
      status: 400,
      body: { error: "BuildCity.vertex must be a corner number" },
    });
  });

  it("given a move for another seat, answers 403", async () => {
    const s = await room();
    expect((await postRoom(s.deps, s.limits, { action: "command", code: s.code, command: { type: "EndTurn", player: "Ben" } }, s.ana, "ip")).status).toBe(403);
  });

  it("given a move the rules refuse, answers 422 with words and the violation", async () => {
    const s = await room();
    const res = await postRoom(s.deps, s.limits, { action: "command", code: s.code, command: { type: "EndTurn", player: "Ana" } }, s.ana, "ip");
    expect(res.status).toBe(422);
    expect(typeof body(res)["error"]).toBe("string");
    expect(body(res)["violation"]).toBeDefined();
  });
});

describe("Feature: views over HTTP", () => {
  it("given a code, returns the board's view", async () => {
    const s = await room();
    const res = await getRoom(s.deps, s.limits, new URLSearchParams({ code: s.code }), null, "ip");
    expect(res.status).toBe(200);
    expect(body(res)).toMatchObject({ code: s.code, version: 9, you: null });
  });

  it("given a push address, includes it with a full view but not with 'nothing new'", async () => {
    const s = await room();
    const full = await getRoom(s.deps, s.limits, new URLSearchParams({ code: s.code }), null, "ip", "wss://push");
    expect(body(full)["push"]).toBe("wss://push");
    const same = await getRoom(s.deps, s.limits, new URLSearchParams({ code: s.code, since: "9" }), null, "ip", "wss://push");
    expect(body(same)).toEqual({ unchanged: true, version: 9 });
    const none = await getRoom(s.deps, s.limits, new URLSearchParams({ code: s.code }), null, "ip");
    expect(body(none)["push"]).toBeUndefined();
  });

  it("given a token, returns that seat's view", async () => {
    const s = await room();
    expect(body(await getRoom(s.deps, s.limits, new URLSearchParams({ code: s.code }), s.ana, "ip"))["you"]).toBe("Ana");
  });

  it("given the current version, says nothing new", async () => {
    const s = await room();
    expect(await getRoom(s.deps, s.limits, new URLSearchParams({ code: s.code, since: "9" }), null, "ip")).toEqual({
      status: 200,
      body: { unchanged: true, version: 9 },
    });
  });

  it.each([
    [{}, "code must be a 4-letter room code"],
    [{ code: "AB" }, "code must be a 4-letter room code"],
    [{ code: "ABCD", since: "x" }, "since must be a version number"],
    [{ code: "ABCD", since: "-1" }, "since must be a version number"],
    [{ code: "ABCD", since: "1.5" }, "since must be a version number"],
  ])("given %j, answers 400", async (query, error) => {
    const s = setup();
    expect(await getRoom(s.deps, s.limits, new URLSearchParams(query as Record<string, string>), null, "ip")).toEqual({ status: 400, body: { error } });
  });

  it("given a forged token, answers 403", async () => {
    const s = await room();
    expect((await getRoom(s.deps, s.limits, new URLSearchParams({ code: s.code }), "forged", "ip")).status).toBe(403);
  });
});

describe("Feature: limits per client", () => {
  it.each(["create", "join", "command"])("given too many %s requests, answers 429", async (action) => {
    const s = setup(0);
    const res = await postRoom(s.deps, s.limits, { action, names: ["A", "B"], code: "ABCD", seat: 0, command: {} }, "t", "ip");
    expect(res.status).toBe(429);
  });

  it("given too many view requests, answers 429", async () => {
    const s = setup(0);
    expect((await getRoom(s.deps, s.limits, new URLSearchParams({ code: "ABCD" }), null, "ip")).status).toBe(429);
  });
});
