import { type Browser, expect, type Page, test } from "@playwright/test";

/**
 * Shared rooms (ADR-019, ADR-021): the board on one screen and a phone per
 * player, each its own browser context (its own storage, like real devices).
 */
async function openRoom(browser: Browser, players = 2) {
  const board = await (await browser.newContext()).newPage();
  await board.goto("/rooms");
  for (let n = 4; n > players; n--) await board.getByRole("button", { name: "One fewer player" }).click();
  for (let n = 4; n < players; n++) await board.getByRole("button", { name: "One more player" }).click();
  await board.getByRole("button", { name: "Create room" }).click();
  await expect(board).toHaveURL(/\/rooms\?code=[A-Z]{4}&screen=board$/);
  const code = new URL(board.url()).searchParams.get("code") ?? "";
  return { board, code };
}

async function phone(browser: Browser, code: string, name: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/rooms?code=${code}`);
  await page.getByLabel("Your name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Join the game" }).click();
  await expect(page.locator(".room-bar__you")).toHaveText(`You are ${name}`);
  return page;
}

/** A started 2-player game: the board and both phones. */
async function startedRoom(browser: Browser) {
  const { board, code } = await openRoom(browser, 2);
  const ana = await phone(browser, code, "Ana");
  const ben = await phone(browser, code, "Ben");
  await expect(board.getByRole("button", { name: "Start game" })).toBeEnabled({ timeout: 5000 });
  await board.getByRole("button", { name: "Start game" }).click();
  await expect(board.locator("#play")).toBeVisible({ timeout: 5000 });
  return { board, code, ana, ben };
}

test.describe("Feature: setting up a room (ADR-021)", () => {
  test("given a player count, the board shows the code, the link and that many open seats", async ({ browser }) => {
    const { board, code } = await openRoom(browser, 3);
    await expect(board.locator(".room-bar__value")).toHaveText(code);
    await expect(board.locator(".room-bar__link a")).toHaveAttribute("href", new RegExp(`/rooms\\?code=${code}$`));
    await expect(board.locator(".lobby-seat")).toHaveText(["1Open seat", "2Open seat", "3Open seat"]);
    await expect(board.getByRole("button", { name: "Start game" })).toBeDisabled();
  });

  test("given a phone that types its name, it takes the next seat and the board shows it", async ({ browser }) => {
    const { board, code } = await openRoom(browser, 3);
    const ana = await phone(browser, code, "Ana");
    await expect(board.locator(".lobby-seat--joined")).toHaveText(["1Ana"], { timeout: 5000 });
    await expect(ana.locator(".lobby-wait")).toHaveText("You're in as Ana. The host will start the game.");
  });

  test("given the code typed on the Rooms page, the phone is taken to that room", async ({ browser }) => {
    const { code } = await openRoom(browser);
    const page = await (await browser.newContext()).newPage();
    await page.goto("/rooms");
    await page.getByLabel("Room code").fill(code.toLowerCase());
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/rooms\\?code=${code}$`));
    await expect(page.getByLabel("Your name", { exact: true })).toBeVisible();
  });

  test("given a code that is not 4 letters, the box says so", async ({ page }) => {
    await page.goto("/rooms");
    await page.getByLabel("Room code").fill("AB1");
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await expect(page.locator("#code-error")).toHaveText("A room code is 4 letters, like ABCD.");
  });

  test("given the host, seats can be added and empty ones removed before the start", async ({ browser }) => {
    const { board, code } = await openRoom(browser, 2);
    await board.getByRole("button", { name: "Add a seat" }).click();
    await expect(board.locator(".lobby-seat")).toHaveCount(3);
    await phone(browser, code, "Ana");
    await phone(browser, code, "Ben");
    await phone(browser, code, "Cy");
    await expect(board.locator(".lobby-seat--joined")).toHaveCount(3, { timeout: 5000 });
    await expect(board.getByRole("button", { name: "Remove an empty seat" })).toBeDisabled();
  });

  test("given a name already in the room, the phone is told to pick another", async ({ browser }) => {
    const { code } = await openRoom(browser, 3);
    await phone(browser, code, "Ana");
    const other = await (await browser.newContext()).newPage();
    await other.goto(`/rooms?code=${code}`);
    await other.getByLabel("Your name", { exact: true }).fill("ana");
    await other.getByRole("button", { name: "Join the game" }).click();
    await expect(other.locator("#failure")).toContainText("already called ana");
  });

  test("given a code that does not exist, the phone is told so", async ({ page }) => {
    await page.goto("/rooms?code=ZZZZ");
    await expect(page.locator("#failure")).toContainText("Room not found");
  });

  test("given a phone that reloads in the lobby, it keeps its seat", async ({ browser }) => {
    const { code } = await openRoom(browser);
    const ana = await phone(browser, code, "Ana");
    await ana.reload();
    await expect(ana.locator(".room-bar__you")).toHaveText("You are Ana");
  });
});

test.describe("Feature: playing in a room", () => {
  test("given the host starts, every screen switches to the game", async ({ browser }) => {
    const { ana, ben } = await startedRoom(browser);
    await expect(ana.locator("#play")).toBeVisible({ timeout: 5000 });
    await expect(ben.locator("#play")).toBeVisible({ timeout: 5000 });
  });

  test("given two phones, each sees only its own controls, and a move shows on every screen", async ({ browser }) => {
    const { board, ana, ben } = await startedRoom(browser);
    await expect(ana.locator("#play-board [data-spot]").first()).toBeVisible({ timeout: 5000 });
    await expect(ben.locator("#play-board [data-spot]")).toHaveCount(0);
    await expect(ben.locator(".turn__waiting")).toHaveText("Waiting for Ana.");
    await expect(board.locator("#play-board [data-spot]")).toHaveCount(0);
    await expect(board.locator(".turn__waiting")).toHaveText("Waiting for Ana to play on their phone.");

    await ana.locator("#play-board [data-spot]").first().click();
    await expect(board.locator("#play-events li").first()).toContainText("Ana built a settlement", { timeout: 5000 });
    await expect(ben.locator("#play-events li").first()).toContainText("Ana built a settlement", { timeout: 5000 });
  });

  test("given the board, a leaderboard ranks the players; nobody's cards are shown", async ({ browser }) => {
    const { board } = await startedRoom(browser);
    const rows = board.getByRole("region", { name: "Leaderboard" }).locator(".leaderboard__row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Ana");
    await expect(rows.first()).toContainText("playing");
    await expect(board.locator(".leaderboard__cards").first()).toHaveText(/^\d+ cards?$/);
    await expect(board.locator("#play-players dl.hand")).toHaveCount(0);
  });

  test("given a settlement built on a phone, the board shows a banner", async ({ browser }) => {
    const { board, ana } = await startedRoom(browser);
    await ana.locator("#play-board [data-spot]").first().click();
    await expect(board.locator("#play-banner")).toBeVisible({ timeout: 3000 });
    await expect(board.locator("#play-banner")).toHaveText("Ana settled");
    await expect(board.locator("#play-banner")).toHaveAttribute("aria-hidden", "true");
  });

  test("given a phone that reloads mid-game, it rejoins the same seat", async ({ browser }) => {
    const { ana } = await startedRoom(browser);
    await ana.reload();
    await expect(ana.locator(".room-bar__you")).toHaveText("You are Ana");
    await expect(ana.locator("#play")).toBeVisible();
  });

  test("given a started game, a new phone is told it has already started", async ({ browser }) => {
    const { code } = await startedRoom(browser);
    const late = await (await browser.newContext()).newPage();
    await late.goto(`/rooms?code=${code}`);
    await expect(late.locator("#failure")).toContainText("already started");
  });
});

test.describe("Feature: moves are pushed to the screens", () => {
  test("given the board is connected, a join arrives as a push notice, and a move faster than a poll", async ({ browser }) => {
    const { board, code } = await openRoom(browser, 2);
    const notices: string[] = [];
    board.on("websocket", (socket) => socket.on("framereceived", (frame) => notices.push(String(frame.payload))));
    await board.reload();
    await expect(board.locator(".room-bar__value")).toHaveText(code);
    const ana = await phone(browser, code, "Ana");
    await expect.poll(() => notices.length, { timeout: 5000 }).toBeGreaterThan(0);
    expect(JSON.parse(notices[0] ?? "{}")).toEqual({ type: "changed" });
    await phone(browser, code, "Ben");
    await expect(board.getByRole("button", { name: "Start game" })).toBeEnabled({ timeout: 3000 });
    await board.getByRole("button", { name: "Start game" }).click();
    await expect(ana.locator("#play-board [data-spot]").first()).toBeVisible({ timeout: 5000 });
    await ana.locator("#play-board [data-spot]").first().click();
    await expect(board.locator("#play-events li").first()).toContainText("Ana built a settlement", { timeout: 1200 });
  });
});
