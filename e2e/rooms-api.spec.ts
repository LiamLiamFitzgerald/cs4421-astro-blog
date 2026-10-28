import { expect, test } from "@playwright/test";

/** The rooms API on the server build, with rooms in memory (no ROOMS_TABLE). */
test.describe("Feature: the rooms API", () => {
  type Ctx = import("@playwright/test").APIRequestContext;
  async function lobby(request: Ctx) {
    const created = await request.post("/api/rooms", { data: { action: "create", seats: 2 } });
    expect(created.status()).toBe(201);
    const { code, hostToken } = (await created.json()) as { code: string; hostToken: string };
    expect(code).toMatch(/^[A-Z]{4}$/);
    return { code, hostToken };
  }
  const join = async (request: Ctx, code: string, name: string) =>
    (await (await request.post("/api/rooms", { data: { action: "join", code, name } })).json()) as { token: string; player: string };

  test("given a lobby, players join by name and the host starts the game", async ({ request }) => {
    const { code, hostToken } = await lobby(request);
    const ana = await join(request, code, "Ana");
    expect(ana.player).toBe("Ana");

    const board = await request.get(`/api/rooms?code=${code}`);
    expect(board.headers()["cache-control"]).toBe("no-store");
    // Version 17: no moves, 2 seats, 1 joined (0 × 64 + 2 × 8 + 1).
    expect(await board.json()).toMatchObject({ code, version: 17, started: false, you: null, seats: [{ name: "Ana", joined: true }, { name: null, joined: false }] });
    expect(await (await request.get(`/api/rooms?code=${code}&since=17`)).json()).toEqual({ unchanged: true, version: 17 });

    const tooSoon = await request.post("/api/rooms", { headers: { "x-room-token": hostToken }, data: { action: "start", code } });
    expect(tooSoon.status()).toBe(409);
    await join(request, code, "Ben");
    const start = await request.post("/api/rooms", { headers: { "x-room-token": hostToken }, data: { action: "start", code } });
    expect(await start.json()).toEqual({ players: ["Ana", "Ben"] });

    const phone = await request.get(`/api/rooms?code=${code}`, { headers: { "x-room-token": ana.token } });
    expect(await phone.json()).toMatchObject({ you: "Ana", started: true });
  });

  test("given a seat token, a phone can only move for its own player", async ({ request }) => {
    const { code, hostToken } = await lobby(request);
    await join(request, code, "Ana");
    const { token } = await join(request, code, "Ben");
    await request.post("/api/rooms", { headers: { "x-room-token": hostToken }, data: { action: "start", code } });
    const forAna = await request.post("/api/rooms", {
      headers: { "x-room-token": token },
      data: { action: "command", code, command: { type: "EndTurn", player: "Ana" } },
    });
    expect(forAna.status()).toBe(403);
    const outOfTurn = await request.post("/api/rooms", {
      headers: { "x-room-token": token },
      data: { action: "command", code, command: { type: "EndTurn", player: "Ben" } },
    });
    expect(outOfTurn.status()).toBe(422);
  });

  test("given bad requests, the API refuses with reasons and never fails", async ({ request }) => {
    expect((await request.get("/api/rooms?code=ZZZZ")).status()).toBe(404);
    expect((await request.get("/api/rooms")).status()).toBe(400);
    expect((await request.post("/api/rooms", { data: "{not json", headers: { "content-type": "application/json" } })).status()).toBe(400);
    // Astro refuses cross-site form-style posts without an origin (CSRF protection).
    expect((await request.post("/api/rooms", { data: "x", headers: { "content-type": "text/plain" } })).status()).toBe(403);
    expect((await request.post("/api/rooms", { data: { action: "join", code: "ZZZZ", name: "Ana" } })).status()).toBe(404);
    expect((await request.post("/api/rooms", { data: { action: "create", seats: 9 } })).status()).toBe(400);
    expect((await request.post("/api/rooms", { data: { action: "create", names: ["x".repeat(9000)] } })).status()).toBe(413);
    const { code } = await lobby(request);
    expect((await request.get(`/api/rooms?code=${code}`, { headers: { "x-room-token": "forged" } })).status()).toBe(403);
  });
});
