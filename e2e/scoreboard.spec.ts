import { expect, type Page, test } from "@playwright/test";

const card = (page: Page, name: string) =>
  page.locator("article.player").filter({ has: page.getByRole("heading", { name, exact: true }) });

const points = (page: Page, name: string) => card(page, name).locator(".player__score strong");

async function startGame(page: Page, names: string[], seed = 42) {
  await page.goto(`/catan?seed=${seed}`);
  const fields = page.locator("#player-fields input");
  while ((await fields.count()) < names.length) {
    await page.getByRole("button", { name: "Add a player" }).click();
  }
  for (const [i, name] of names.entries()) await fields.nth(i).fill(name);
  await page.getByRole("button", { name: "Start game" }).click();
}

test.beforeEach(async ({ page }) => {
  // Each test starts from an empty saved game.
  await page.goto("/catan");
  await page.evaluate(() => window.localStorage.clear());
});

test.describe("Feature: setting up a game", () => {
  test("given no saved game, the setup screen shows a dealt board with 19 hexes", async ({ page }) => {
    await page.goto("/catan?seed=42");

    await expect(page.getByRole("heading", { name: "Who is playing?" })).toBeVisible();
    await expect(page.locator("#setup-board .board__hex")).toHaveCount(19);
    await expect(page.locator("#setup-board-list li")).toHaveCount(19);
  });

  test("given the same seed, the same board is dealt", async ({ page }) => {
    await page.goto("/catan?seed=7");
    const first = await page.locator("#setup-board-list").textContent();
    await page.reload();

    await expect(page.locator("#setup-board-list")).toHaveText(first ?? "");
  });

  test("given 'Deal another board', a different board is dealt and kept in the URL", async ({ page }) => {
    await page.goto("/catan?seed=7");
    const first = await page.locator("#setup-board-list").textContent();

    await page.getByRole("button", { name: "Deal another board" }).click();

    await expect(page.locator("#setup-board-list")).not.toHaveText(first ?? "");
    expect(new URL(page.url()).searchParams.get("seed")).not.toBe("7");
  });

  test("given one player, the game is refused with a reason", async ({ page }) => {
    await startGame(page, ["Ana"]);

    await expect(page.locator("#setup-error")).toHaveText("A game needs 2 to 6 players.");
    await expect(page.locator("#setup")).toBeVisible();
  });

  test("given duplicate names, the game is refused with a reason", async ({ page }) => {
    await startGame(page, ["Ana", "Ana"]);

    await expect(page.locator("#setup-error")).toHaveText("Each player needs a different name.");
  });

  test("given the home page board, 'Start a game on this board' uses that board", async ({ page }) => {
    await page.goto("/");
    const homeBoard = await page.locator("#board-list").textContent();

    await page.getByRole("link", { name: "Start a game on this board" }).click();

    await expect(page.locator("#setup-board-list")).toHaveText(homeBoard ?? "");
  });
});

test.describe("Feature: scoring a game", () => {
  test("given three players, every player starts on 0 points next to the board", async ({ page }) => {
    await startGame(page, ["Ana", "Ben", "Cara"]);

    await expect(page.locator("article.player")).toHaveCount(3);
    for (const name of ["Ana", "Ben", "Cara"]) await expect(points(page, name)).toHaveText("0");
    await expect(page.locator("#game-board .board__hex")).toHaveCount(19);
  });

  test("given the game's board, it is the board that was dealt at setup", async ({ page }) => {
    await page.goto("/catan?seed=42");
    const dealt = await page.locator("#setup-board-list").textContent();

    await startGame(page, ["Ana", "Ben"], 42);

    await expect(page.locator("#game-board-list")).toHaveText(dealt ?? "");
  });

  test("given an upgrade with no settlement, the reason is shown and nothing is stored", async ({ page }) => {
    await startGame(page, ["Ana", "Ben"]);
    const ana = card(page, "Ana");

    await ana.getByRole("button", { name: "City" }).click();

    await expect(ana.getByRole("alert")).toHaveText("Ana has no settlement to upgrade.");
    await expect(page.locator("#event-count")).toHaveText("1");
  });

  test("given settlements and a city, points, the event log and the announcement update", async ({ page }) => {
    await startGame(page, ["Ana", "Ben"]);
    const ana = card(page, "Ana");

    await ana.getByRole("button", { name: "Settlement" }).click();
    await ana.getByRole("button", { name: "Settlement" }).click();
    await ana.getByRole("button", { name: "City" }).click();

    await expect(points(page, "Ana")).toHaveText("3");
    await expect(page.locator("#announcer")).toHaveText("Ana upgraded a settlement to a city. Ana has 3 points.");
    await page.locator("summary", { hasText: "Event log" }).click();
    await expect(page.locator("#events li").first()).toHaveText("Ana upgraded a settlement to a city");
    await expect(page.locator("#event-count")).toHaveText("4");
  });

  test("given three knights, Largest Army is awarded for 2 points", async ({ page }) => {
    await startGame(page, ["Ana", "Ben"]);
    const ben = card(page, "Ben");

    for (let i = 0; i < 3; i++) await ben.getByRole("button", { name: "Knight" }).click();

    await expect(ben.getByText("Largest Army", { exact: true })).toBeVisible();
    await expect(points(page, "Ben")).toHaveText("2");
  });

  test("given a road of five, Longest Road is awarded", async ({ page }) => {
    await startGame(page, ["Ana", "Ben"]);
    const ana = card(page, "Ana");

    for (let i = 0; i < 5; i++) await ana.getByRole("button", { name: "Ana: road one longer" }).click();

    await expect(ana.locator(".road__value")).toHaveText("5");
    await expect(ana.getByText("Longest Road", { exact: true })).toBeVisible();
  });

  test("given ten points, the winner is announced and recording is switched off", async ({ page }) => {
    await startGame(page, ["Ana", "Ben"]);
    const ana = card(page, "Ana");

    for (let i = 0; i < 10; i++) await ana.getByRole("button", { name: "VP card" }).click();

    await expect(page.locator("#winner")).toContainText("Ana wins with 10 points.");
    await expect(ana.getByText("Winner", { exact: true })).toBeVisible();
    await expect(card(page, "Ben").getByRole("button", { name: "Settlement" })).toBeDisabled();
  });
});

test.describe("Feature: keeping and discarding a game", () => {
  test("given a game in progress, it survives a reload", async ({ page }) => {
    await startGame(page, ["Ana", "Ben"]);
    await card(page, "Ana").getByRole("button", { name: "Settlement" }).click();

    await page.reload();

    await expect(points(page, "Ana")).toHaveText("1");
  });

  test("given 'New game', a confirmation is shown and 'Keep playing' keeps the game", async ({ page }) => {
    await startGame(page, ["Ana", "Ben"]);
    await card(page, "Ana").getByRole("button", { name: "Settlement" }).click();

    await page.getByRole("button", { name: "New game" }).click();
    const dialog = page.getByRole("dialog", { name: "Discard this game?" });
    await expect(dialog).toContainText("Ana, Ben");
    await dialog.getByRole("button", { name: "Keep playing" }).click();

    await expect(dialog).toBeHidden();
    await expect(points(page, "Ana")).toHaveText("1");
  });

  test("given 'Discard and start over', the saved game is cleared", async ({ page }) => {
    await startGame(page, ["Ana", "Ben"]);

    await page.getByRole("button", { name: "New game" }).click();
    await page.getByRole("button", { name: "Discard and start over" }).click();

    await expect(page.locator("#setup")).toBeVisible();
    await page.reload();
    await expect(page.locator("#setup")).toBeVisible();
  });
});

test.describe("Feature: unexpected failures", () => {
  test("given storage fails, the error is explained, nothing changes, and Try again succeeds", async ({ page }) => {
    await startGame(page, ["Ana", "Ben"]);
    const ana = card(page, "Ana");

    // Make the next save fail the way a full disk does.
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function () {
        Storage.prototype.setItem = original;
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      };
    });
    await ana.getByRole("button", { name: "Settlement" }).click();

    const failure = page.locator("#failure");
    await expect(failure).toContainText("browser storage is full");
    await expect(points(page, "Ana")).toHaveText("0");
    await expect(ana.getByRole("button", { name: "Settlement" })).toBeEnabled();

    await failure.getByRole("button", { name: "Try again" }).click();

    await expect(failure).toBeHidden();
    await expect(points(page, "Ana")).toHaveText("1");
  });

  test("given storage is blocked, the page still works and says games will not be kept", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("Blocked", "SecurityError");
        },
      });
    });
    const page = await context.newPage();

    await startGame(page, ["Ana", "Ben"]);
    await card(page, "Ana").getByRole("button", { name: "Settlement" }).click();

    await expect(page.locator("#storage-note")).toBeVisible();
    await expect(points(page, "Ana")).toHaveText("1");
    await context.close();
  });
});
