import { expect, test } from "@playwright/test";

test.describe("Feature: health and error reporting endpoints", () => {
  test("given the health endpoint, it reports ok without caching", async ({ request }) => {
    const response = await request.get("/api/health");

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toMatchObject({ status: "ok" });
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
      data: { context: "e2e", message: "x".repeat(5000), page: "/" },
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: "report too large" });
  });
});

test.describe("Feature: pages that do not exist", () => {
  test("given an unknown address, a 404 page links back to the app", async ({ page }) => {
    const response = await page.goto("/no-such-page");

    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "This page is not on the map" })).toBeVisible();
    await page.getByRole("link", { name: "Go to the scoreboard" }).click();
    await expect(page).toHaveURL(/\/catan/);
  });
});
