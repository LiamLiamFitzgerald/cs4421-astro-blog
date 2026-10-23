import { type Browser, expect, type Page, test } from "@playwright/test";

/**
 * A shared room (ADR-019): the board on one screen and a phone per player,
 * each its own browser context (so each has its own storage, like real devices).
 */
async function openRoom(browser: Browser) {
  const boardContext = await browser.newContext();
  const board = await boardContext.newPage();
  await board.goto("/rooms");
  await board.getByLabel("Player 1").fill("Ana");
  await board.getByLabel("Player 2").fill("Ben");
  await board.getByRole("button", { name: "Create room" }).click();
  await expect(board).toHaveURL(/\/rooms\?code=[A-Z]{4}&screen=board$/);
  const code = new URL(board.url()).searchParams.get("code") ?? "";
  return { board, code };
}

async function phone(browser: Browser, code: string, seat: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/rooms?code=${code}`);
  await page.getByRole("button", { name: `Play as ${seat}` }).click();
  await expect(page.locator(".room-bar__you")).toHaveText(`You are ${seat}`);
  return page;
}

test.describe("Feature: playing in a room", () => {
  test("given a host, the board shows the code, the join link and who has joined", async ({ browser }) => {
    const { board, code } = await openRoom(browser);
    await expect(board.locator(".room-bar__value")).toHaveText(code);
    await expect(board.locator(".room-bar__link a")).toHaveAttribute("href", new RegExp(`/rooms\\?code=${code}$`));
    await expect(board.locator(".room-seat")).toHaveText(["1 Ana (not joined)", "2 Ben (not joined)"]);
    await phone(browser, code, "Ana");
    await expect(board.locator(".room-seat").first()).toHaveText("1 Ana", { timeout: 5000 });
  });

  test("given two phones, each sees only its own controls, and a move shows on every screen", async ({ browser }) => {
    const { board, code } = await openRoom(browser);
    const ana = await phone(browser, code, "Ana");
    const ben = await phone(browser, code, "Ben");

    // Ana places first: her phone offers corners, Ben's and the board's do not.
    await expect(ana.locator("#play-board [data-spot]").first()).toBeVisible();
    await expect(ben.locator("#play-board [data-spot]")).toHaveCount(0);
    await expect(ben.locator(".turn__waiting")).toHaveText("Waiting for Ana.");
    await expect(board.locator("#play-board [data-spot]")).toHaveCount(0);
    await expect(board.locator(".turn__waiting")).toHaveText("Waiting for Ana to play on their phone.");

    await ana.locator("#play-board [data-spot]").first().click();
    await expect(board.locator("#play-events li").first()).toContainText("Ana built a settlement", { timeout: 5000 });
    await expect(ben.locator("#play-events li").first()).toContainText("Ana built a settlement", { timeout: 5000 });
  });

  test("given a phone that reloads, it rejoins the same seat", async ({ browser }) => {
    const { code } = await openRoom(browser);
    const ana = await phone(browser, code, "Ana");
    await ana.reload();
    await expect(ana.locator(".room-bar__you")).toHaveText("You are Ana");
  });

  test("given a taken seat, a second phone cannot take it", async ({ browser }) => {
    const { code } = await openRoom(browser);
    await phone(browser, code, "Ana");
    const other = await (await browser.newContext()).newPage();
    await other.goto(`/rooms?code=${code}`);
    await expect(other.getByRole("button", { name: "Ana (taken)" })).toBeDisabled();
  });

  test("given a code that does not exist, the phone is told so", async ({ page }) => {
    await page.goto("/rooms?code=ZZZZ");
    await expect(page.locator("#failure")).toContainText("Room not found");
  });

  test("given the board, nobody's resource cards are shown, only how many", async ({ browser }) => {
    const { board, code } = await openRoom(browser);
    await phone(browser, code, "Ana");
    await expect(board.locator("#play-players .hand-count").first()).toHaveText(/\d+ resource cards?/);
    await expect(board.locator("#play-players dl.hand")).toHaveCount(0);
  });
});
