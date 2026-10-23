import { expect, test } from "@playwright/test";

/** The rooms API on the server build, with rooms in memory (no ROOMS_TABLE). */
test.describe("Feature: the rooms API", () => {
  async function room(request: import("@playwright/test").APIRequestContext) {
    const created = await request.post("/api/rooms", { data: { action: "create", names: ["Ana", "Ben"] } });
    expect(created.status()).toBe(201);
    const { code } = (await created.json()) as { code: string };
    expect(code).toMatch(/^[A-Z]{4}$/);
    return code;
  }

  test("given a room, the board sees public information and a phone sees its own seat", async ({ request }) => {
    const code = await room(request);
    const joined = await request.post("/api/rooms", { data: { action: "join", code, seat: 0 } });
    expect(joined.status()).toBe(201);
    const { token, player } = (await joined.json()) as { token: string; player: string };
    expect(player).toBe("Ana");

    const board = await request.get(`/api/rooms?code=${code}`);
    expect(board.headers()["cache-control"]).toBe("no-store");
    expect(await board.json()).toMatchObject({ code, version: 9, you: null, seats: [{ name: "Ana", joined: true }, { name: "Ben", joined: false }] });

    const phone = await request.get(`/api/rooms?code=${code}`, { headers: { "x-room-token": token } });
    expect(await phone.json()).toMatchObject({ you: "Ana" });

    // Version 9: one event (the start) and one seat taken (1 × 8 + 1).
    const unchanged = await request.get(`/api/rooms?code=${code}&since=9`);
    expect(await unchanged.json()).toEqual({ unchanged: true, version: 9 });
  });

  test("given a seat token, a phone can only move for its own player", async ({ request }) => {
    const code = await room(request);
    const { token } = (await (await request.post("/api/rooms", { data: { action: "join", code, seat: 1 } })).json()) as { token: string };
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
    expect(((await outOfTurn.json()) as { error: string }).error).toMatch(/turn|Not now/);
  });

  test("given bad requests, the API refuses with reasons and never fails", async ({ request }) => {
    expect((await request.get("/api/rooms?code=ZZZZ")).status()).toBe(404);
    expect((await request.get("/api/rooms")).status()).toBe(400);
    expect((await request.post("/api/rooms", { data: "{not json", headers: { "content-type": "application/json" } })).status()).toBe(400);
    // Astro refuses cross-site form-style posts without an origin (CSRF protection).
    expect((await request.post("/api/rooms", { data: "x", headers: { "content-type": "text/plain" } })).status()).toBe(403);
    expect((await request.post("/api/rooms", { data: { action: "join", code: "ZZZZ", seat: 0 } })).status()).toBe(404);
    expect((await request.post("/api/rooms", { data: { action: "create", names: ["x".repeat(9000)] } })).status()).toBe(413);
    const code = await room(request);
    expect((await request.get(`/api/rooms?code=${code}`, { headers: { "x-room-token": "forged" } })).status()).toBe(403);
  });
});
