import { describe, expect, it } from "vitest";
import { MemoryRoomRepository } from "../adapters/memory-room-repository";
import { replayPlay } from "../games/catan-play/evolve";
import { legalSetupSettlements } from "../games/catan-play/queries";
import { createRateLimiter } from "./rate-limit";
import { getRoom, postRoom, type RoomLimits } from "./room-api";
import { type RoomDeps, viewVersion } from "./rooms";

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

/** A lobby for 2, with Ana joined. */
async function lobby(s = setup()) {
  const created = await postRoom(s.deps, s.limits, { action: "create", seats: 2 }, null, "ip");
  const code = body(created)["code"] as string;
  const host = body(created)["hostToken"] as string;
  const ana = body(await postRoom(s.deps, s.limits, { action: "join", code, name: " Ana " }, null, "ip"))["token"] as string;
  return { ...s, created, code, host, ana };
}

/** A started game between Ana and Ben. */
async function started() {
  const room = await lobby();
  const ben = body(await postRoom(room.deps, room.limits, { action: "join", code: room.code, name: "Ben" }, null, "ip"))["token"] as string;
  const start = await postRoom(room.deps, room.limits, { action: "start", code: room.code }, room.host, "ip");
  expect(start).toEqual({ status: 200, body: { players: ["Ana", "Ben"] } });
  return { ...room, ben };
}

describe("Feature: the lobby over HTTP", () => {
  it("given a player count, creates a lobby (201) and returns the code and host token", async () => {
    const { created, deps, code } = await lobby();
    expect(created.status).toBe(201);
    expect(body(created)["hostToken"]).toBe("t1");
    expect((await deps.rooms.get(code))?.seats).toBe(2);
  });

  it("given a name, joins (201) with a tidied name", async () => {
    const s = await lobby();
    expect((await s.deps.rooms.seats(s.code)).get(0)?.name).toBe("Ana");
  });

  it("given a name already used, answers 409 with its code", async () => {
    const s = await lobby();
    const res = await postRoom(s.deps, s.limits, { action: "join", code: s.code, name: "ana" }, null, "ip");
    expect(res.status).toBe(409);
    expect(body(res)["code"]).toBe("NAME_TAKEN");
  });

  it("given the host token, resizes the lobby", async () => {
    const s = await lobby();
    expect(await postRoom(s.deps, s.limits, { action: "resize", code: s.code, seats: 5 }, s.host, "ip")).toEqual({ status: 200, body: { seats: 5 } });
  });

  it("given a player's token, refuses to resize or start (403)", async () => {
    const s = await lobby();
    expect((await postRoom(s.deps, s.limits, { action: "resize", code: s.code, seats: 5 }, s.ana, "ip")).status).toBe(403);
    expect((await postRoom(s.deps, s.limits, { action: "start", code: s.code }, s.ana, "ip")).status).toBe(403);
  });

  it("given too few players, refuses to start (409)", async () => {
    const s = await lobby();
    const res = await postRoom(s.deps, s.limits, { action: "start", code: s.code }, s.host, "ip");
    expect(res.status).toBe(409);
    expect(body(res)["code"]).toBe("TOO_FEW_PLAYERS");
  });

  it("given a bad player count, answers 400 with words", async () => {
    const s = setup();
    const res = await postRoom(s.deps, s.limits, { action: "create", seats: 9 }, null, "ip");
    expect(res.status).toBe(400);
    expect(body(res)["error"]).toMatch(/2 to 6 players/);
  });

  it.each([
    [null, "request must be a JSON object"],
    [[1], "request must be a JSON object"],
    [{}, "action must be create, join, resize, start or command"],
    [{ action: "delete" }, "action must be create, join, resize, start or command"],
    [{ action: "create", seats: "4" }, "seats must be a number of players"],
    [{ action: "join", code: "AB", name: "Ana" }, "code must be a 4-letter room code"],
    [{ action: "join", code: 12, name: "Ana" }, "code must be a 4-letter room code"],
    [{ action: "join", code: "ABCD", name: 5 }, "name must be text"],
    [{ action: "resize", code: "nope", seats: 3 }, "code must be a 4-letter room code"],
    [{ action: "resize", code: "ABCD", seats: "3" }, "seats must be a number of players"],
    [{ action: "start", code: 1 }, "code must be a 4-letter room code"],
    [{ action: "command", code: "nope", command: {} }, "code must be a 4-letter room code"],
  ])("given %j, answers 400: %s", async (input, error) => {
    const s = setup();
    expect(await postRoom(s.deps, s.limits, input, "tok", "ip")).toEqual({ status: 400, body: { error } });
  });

  it.each(["resize", "start", "command"])("given %s without a token, answers 401", async (action) => {
    const s = setup();
    expect((await postRoom(s.deps, s.limits, { action, code: "ABCD", seats: 3 }, null, "ip")).status).toBe(401);
  });

  it("given an unknown room, answers 404 with its code", async () => {
    const s = setup();
    const res = await postRoom(s.deps, s.limits, { action: "join", code: "ZZZZ", name: "Ana" }, null, "ip");
    expect(res.status).toBe(404);
    expect(body(res)["code"]).toBe("NO_SUCH_ROOM");
  });
});

describe("Feature: playing over HTTP", () => {
  it("given a seat's token and a legal move, applies it", async () => {
    const s = await started();
    const vertex = legalSetupSettlements(replayPlay(await s.deps.rooms.events(s.code)))[0];
    const res = await postRoom(s.deps, s.limits, { action: "command", code: s.code, command: { type: "PlaceSetupSettlement", player: "Ana", vertex } }, s.ana, "ip");
    expect(res).toEqual({ status: 200, body: { moves: 2 } });
  });

  it("given a malformed command, answers 400 with what is wrong", async () => {
    const s = await started();
    expect(await postRoom(s.deps, s.limits, { action: "command", code: s.code, command: { type: "BuildCity", player: "Ana" } }, s.ana, "ip")).toEqual({
      status: 400,
      body: { error: "BuildCity.vertex must be a corner number" },
    });
  });

  it("given a move for another seat, answers 403", async () => {
    const s = await started();
    expect((await postRoom(s.deps, s.limits, { action: "command", code: s.code, command: { type: "EndTurn", player: "Ben" } }, s.ana, "ip")).status).toBe(403);
  });

  it("given a move in the lobby, answers 409", async () => {
    const s = await lobby();
    expect((await postRoom(s.deps, s.limits, { action: "command", code: s.code, command: { type: "EndTurn", player: "Ana" } }, s.ana, "ip")).status).toBe(409);
  });

  it("given a move the rules refuse, answers 422 with words and the violation", async () => {
    const s = await started();
    const res = await postRoom(s.deps, s.limits, { action: "command", code: s.code, command: { type: "EndTurn", player: "Ana" } }, s.ana, "ip");
    expect(res.status).toBe(422);
    expect(typeof body(res)["error"]).toBe("string");
    expect(body(res)["violation"]).toBeDefined();
  });
});

describe("Feature: views over HTTP", () => {
  it("given a code, returns the board's view of the lobby", async () => {
    const s = await lobby();
    const res = await getRoom(s.deps, s.limits, new URLSearchParams({ code: s.code }), null, "ip");
    expect(res.status).toBe(200);
    expect(body(res)).toMatchObject({ code: s.code, started: false, version: viewVersion(0, 2, 1), you: null, host: false });
  });

  it("given the host token, marks the host's screen", async () => {
    const s = await lobby();
    expect(body(await getRoom(s.deps, s.limits, new URLSearchParams({ code: s.code }), s.host, "ip"))["host"]).toBe(true);
  });

  it("given a seat token, returns that seat's view", async () => {
    const s = await started();
    expect(body(await getRoom(s.deps, s.limits, new URLSearchParams({ code: s.code }), s.ana, "ip"))["you"]).toBe("Ana");
  });

  it("given a push address, includes it with a full view but not with 'nothing new'", async () => {
    const s = await lobby();
    const v = String(viewVersion(0, 2, 1));
    expect(body(await getRoom(s.deps, s.limits, new URLSearchParams({ code: s.code }), null, "ip", "wss://push"))["push"]).toBe("wss://push");
    expect(body(await getRoom(s.deps, s.limits, new URLSearchParams({ code: s.code, since: v }), null, "ip", "wss://push"))).toEqual({
      unchanged: true,
      version: Number(v),
    });
    expect(body(await getRoom(s.deps, s.limits, new URLSearchParams({ code: s.code }), null, "ip"))["push"]).toBeUndefined();
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
    const s = await lobby();
    expect((await getRoom(s.deps, s.limits, new URLSearchParams({ code: s.code }), "forged", "ip")).status).toBe(403);
  });
});

describe("Feature: limits per client", () => {
  it.each(["create", "join", "resize", "start", "command"])("given too many %s requests, answers 429", async (action) => {
    const s = setup(0);
    const res = await postRoom(s.deps, s.limits, { action, seats: 2, code: "ABCD", name: "A", command: {} }, "t", "ip");
    expect(res.status).toBe(429);
  });

  it("given too many view requests, answers 429", async () => {
    const s = setup(0);
    expect((await getRoom(s.deps, s.limits, new URLSearchParams({ code: "ABCD" }), null, "ip")).status).toBe(429);
  });
});
