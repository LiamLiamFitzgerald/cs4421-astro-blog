import { expect, test } from "@playwright/test";

test.describe("Feature: health and error reporting endpoints", () => {
  test("given the health endpoint, it reports ok without caching", async ({ request }) => {
    const response = await request.get("/api/health");

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  test("given the liveness endpoint, it reports ok without caching", async ({ request }) => {
    const response = await request.get("/api/live");

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("given the readiness endpoint, it reports each check without caching", async ({
    request,
  }) => {
    const response = await request.get("/api/ready");

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ready",
      checks: [{ name: "rules-engine", ok: true }],
    });
  });

  test("given a valid browser error report, it is accepted", async ({ request }) => {
    const response = await request.post("/api/client-errors", {
      data: { context: "e2e", name: "Error", message: "test report", page: "/catan" },
    });

    expect(response.status()).toBe(204);
  });

  test("given an invalid report, it is refused with a reason", async ({ request }) => {
    const response = await request.post("/api/client-errors", { data: { context: "e2e" } });

    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: "message must be a non-empty string" });
  });

  test("given an oversized report, it is refused", async ({ request }) => {
    const response = await request.post("/api/client-errors", {
      data: { context: "e2e", message: "x".repeat(40000), page: "/" },
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: "report too large" });
  });

  test("given a message over its own limit, the field is named", async ({ request }) => {
    const response = await request.post("/api/client-errors", {
      data: { context: "e2e", message: "x".repeat(5000), page: "/" },
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: "message must be at most 500 characters" });
  });

  test("given a report that carries the game and its log, it is accepted", async ({ request }) => {
    const response = await request.post("/api/client-errors", {
      data: {
        context: "e2e",
        name: "Error",
        message: "with a game",
        page: "/catan",
        game: { id: "local", version: 1, eventCount: 2, events: [{ type: "GameStarted" }, { type: "TurnEnded" }] },
      },
    });

    expect(response.status()).toBe(204);
  });

  test("given a report whose game is malformed, it is refused with a reason", async ({ request }) => {
    const response = await request.post("/api/client-errors", {
      data: { context: "e2e", message: "bad game", page: "/catan", game: { id: "", version: 1, eventCount: 0 } },
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: "game.id must be 1 to 100 characters" });
  });
});

test.describe("Feature: pages that do not exist", () => {
  test("given an unknown address, a 404 page links back to the app", async ({ page }) => {
    const response = await page.goto("/no-such-page");

    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "This page is not on the map" })).toBeVisible();
    await page.getByRole("link", { name: "Play a game" }).click();
    await expect(page).toHaveURL(/\/catan/);
  });
});
