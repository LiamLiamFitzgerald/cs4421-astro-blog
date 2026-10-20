import { expect, type Page, test } from "@playwright/test";

const card = (page: Page, name: string) =>
  page.locator("article.player").filter({ has: page.getByRole("heading", { name }) });

async function startGame(page: Page, names: string) {
  await page.goto("/catan");
  await page.getByLabel(/Players/).fill(names);
  await page.getByRole("button", { name: "Start game" }).click();
}

test.describe("Feature: scoring a Catan game in the browser", () => {
  test.beforeEach(async ({ page }) => {
    // Each test starts from an empty saved game.
    await page.goto("/catan");
    await page.evaluate(() => window.localStorage.clear());
  });

  test("given three players, every player starts on 0 VP", async ({ page }) => {
    await startGame(page, "Ana, Ben, Cara");

    await expect(page.locator("article.player")).toHaveCount(3);
    for (const name of ["Ana", "Ben", "Cara"]) {
      await expect(card(page, name).locator(".score strong")).toHaveText("0");
    }
  });

  test("given one player, the game is refused with a reason", async ({ page }) => {
    await startGame(page, "Ana");

    await expect(page.getByRole("status")).toContainText("2 to 6 players");
    await expect(page.locator("#setup")).toBeVisible();
  });

  test("given settlements and a city, points and the event log update", async ({ page }) => {
    await startGame(page, "Ana, Ben");
    const ana = card(page, "Ana");

    await ana.getByRole("button", { name: "→ City" }).click();
    await expect(page.getByRole("status")).toHaveText("Ana has no settlement to upgrade.");

    await ana.getByRole("button", { name: "+ Settlement" }).click();
    await ana.getByRole("button", { name: "+ Settlement" }).click();
    await ana.getByRole("button", { name: "→ City" }).click();

    await expect(ana.locator(".score strong")).toHaveText("3");
    await expect(page.locator("#message")).toBeEmpty();
    await expect(page.locator("#events li").first()).toHaveText("Ana upgraded a settlement to a city");
    await expect(page.locator("#event-count")).toHaveText("(4)");
  });

  test("given three knights, Largest Army is awarded for 2 points", async ({ page }) => {
    await startGame(page, "Ana, Ben");
    const ben = card(page, "Ben");

    for (let i = 0; i < 3; i++) await ben.getByRole("button", { name: "+ Knight" }).click();

    await expect(ben.getByText("Largest Army")).toBeVisible();
    await expect(ben.locator(".score strong")).toHaveText("2");
  });

  test("given ten points, the winner is shown and actions are disabled", async ({ page }) => {
    await startGame(page, "Ana, Ben");
    const ana = card(page, "Ana");

    for (let i = 0; i < 10; i++) await ana.getByRole("button", { name: "+ VP card" }).click();

    await expect(ana.getByText("Winner")).toBeVisible();
    await expect(card(page, "Ben").getByRole("button", { name: "+ Settlement" })).toBeDisabled();
  });

  test("given a game in progress, it survives a reload and New game clears it", async ({ page }) => {
    await startGame(page, "Ana, Ben");
    await card(page, "Ana").getByRole("button", { name: "+ Settlement" }).click();

    await page.reload();

    await expect(card(page, "Ana").locator(".score strong")).toHaveText("1");
    await page.getByRole("button", { name: "New game" }).click();
    await page.reload();
    await expect(page.locator("#setup")).toBeVisible();
  });
});
