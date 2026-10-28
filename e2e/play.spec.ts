import { expect, type Page, test } from "@playwright/test";
import { gameWithPlayableCard, openingLog } from "./fixtures";

/**
 * Plays the site's own game. Dice are made predictable by feeding values to
 * crypto.getRandomValues, which the page uses for dice (one byte per die).
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const queue: number[] = [];
    Object.assign(window, { __dice: queue });
    const original = crypto.getRandomValues.bind(crypto);
    const fake = (array: ArrayBufferView): ArrayBufferView => {
      if (array instanceof Uint8Array && array.length === 1 && queue.length > 0) {
        array[0] = (queue.shift() ?? 1) - 1;
        return array;
      }
      return original(array as Uint8Array<ArrayBuffer>);
    };
    crypto.getRandomValues = fake as typeof crypto.getRandomValues;
  });
  await page.goto("/catan");
  await page.evaluate(() => window.localStorage.clear());
});

const spots = (page: Page) => page.locator("#play-board [data-spot]");
const turnTitle = (page: Page) => page.locator("#turn-title");
const player = (page: Page, name: string) => page.locator("#play-players article").filter({ has: page.getByRole("heading", { name, exact: true }) });

async function nextDice(page: Page, a: number, b: number) {
  await page.evaluate(([x, y]) => (window as unknown as { __dice: number[] }).__dice.push(x, y), [a, b]);
}

async function startPlay(page: Page, names = ["Ana", "Ben"]) {
  await page.goto("/catan?seed=42");
  await expect(page.getByRole("radio", { name: /Play on the site/ })).toBeChecked();
  const fields = page.locator("#player-fields input");
  for (const [i, name] of names.entries()) await fields.nth(i).fill(name);
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.locator("#play")).toBeVisible();
}

/**
 * Plays the opening for two players. Ana's second settlement goes next to a
 * forest and hills, so she starts with lumber and brick for a road.
 */
async function playOpening(page: Page) {
  const place = async (corner = spots(page).first()) => {
    await corner.click();
    await spots(page).first().click(); // the road
  };
  await place(); // Ana
  await place(); // Ben
  await place(); // Ben again (snake order)
  await expect(turnTitle(page)).toHaveText("Ana's turn");
  await place(spots(page).and(page.locator('[aria-label*="Forest"][aria-label*="Hills"]')).first());
  await expect(page.getByRole("button", { name: "Roll the dice" })).toBeVisible();
}

test.describe("Feature: setting up a played game", () => {
  test("given Play on the site, setup asks player 1 to place a settlement on a highlighted corner", async ({ page }) => {
    await startPlay(page);

    await expect(turnTitle(page)).toHaveText("Ana's turn");
    await expect(page.locator("#play-turn")).toContainText("Place a settlement");
    await expect(spots(page)).toHaveCount(54);
    await expect(spots(page).first()).toHaveAttribute("aria-label", /^Place a settlement at /);
  });

  test("given a settlement is placed, only the roads beside it are offered, then the next player is up", async ({ page }) => {
    await startPlay(page);

    await spots(page).first().click();
    await expect(page.locator("#play-turn")).toContainText("Place a road");
    const roads = await spots(page).count();
    expect(roads).toBeGreaterThanOrEqual(2);
    expect(roads).toBeLessThanOrEqual(3);

    await spots(page).first().click();
    await expect(turnTitle(page)).toHaveText("Ben's turn");
    await expect(page.locator("#announcer")).toContainText("Ben's turn.");
  });

  test("given the distance rule, corners next to a settlement are no longer offered", async ({ page }) => {
    await startPlay(page);
    await spots(page).first().click();
    await spots(page).first().click();

    expect(await spots(page).count()).toBeLessThan(54 - 1);
  });

  test("given the keyboard, a corner can be chosen with Enter", async ({ page }) => {
    await startPlay(page);

    await spots(page).first().focus();
    await page.keyboard.press("Enter");

    await expect(page.locator("#play-turn")).toContainText("Place a road");
  });

  test("given the opening is done, player 1 rolls first and the second settlement paid out", async ({ page }) => {
    await startPlay(page);
    await playOpening(page);

    await expect(turnTitle(page)).toHaveText("Ana's turn");
    const lumber = player(page, "Ana").locator(".hand__item", { hasText: "lumber" });
    await expect(lumber.locator(".hand__count")).not.toHaveText("0");
  });
});

test.describe("Feature: taking turns", () => {
  test("given a roll, the dice and what everyone collects are shown and announced", async ({ page }) => {
    await startPlay(page);
    await playOpening(page);

    await nextDice(page, 2, 1);
    await page.getByRole("button", { name: "Roll the dice" }).click();

    await expect(page.locator(".roll__text")).toHaveText(/^Rolled 3\./);
    await expect(page.locator("#announcer")).toContainText("Rolled 3.");
    await expect(page.getByRole("button", { name: "End turn" })).toBeVisible();
  });

  test("given Ana has lumber and brick, she builds a road on a highlighted edge", async ({ page }) => {
    await startPlay(page);
    await playOpening(page);
    await nextDice(page, 2, 1);
    await page.getByRole("button", { name: "Roll the dice" }).click();

    const build = page.getByRole("button", { name: /Build road/ });
    await expect(build).toBeEnabled();
    await build.click();
    await expect(build).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#play-board-hint")).toContainText("Choose where to build the road");
    await spots(page).first().click();

    await expect(page.locator("#announcer")).toContainText("Ana built a road");
    await expect(player(page, "Ana").locator(".supply")).toContainText("12 roads");
  });

  test("given Ana cannot afford a city, it is not offered at all (ADR-020)", async ({ page }) => {
    await startPlay(page);
    await playOpening(page);
    await nextDice(page, 2, 1);
    await page.getByRole("button", { name: "Roll the dice" }).click();

    await expect(page.getByRole("button", { name: "End turn" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Build city/ })).toHaveCount(0);
    await expect(page.locator("#play-turn")).not.toContainText("Needs");
  });

  test("given every action on the turn panel, each can actually be taken", async ({ page }) => {
    await startPlay(page);
    await playOpening(page);
    await nextDice(page, 2, 1);
    await page.getByRole("button", { name: "Roll the dice" }).click();

    // The player-trade form is the one exception: Offer trade waits for the cards to be chosen.
    const actions = page.locator("#play-turn .builds button.action, #play-turn .trade button.action, #play-turn .cards button.action, #play-turn .turn__end");
    await expect(actions.first()).toBeVisible();
    for (const b of await actions.all()) await expect(b).toBeEnabled();
  });

  test("given Escape, build mode is cancelled", async ({ page }) => {
    await startPlay(page);
    await playOpening(page);
    await nextDice(page, 2, 1);
    await page.getByRole("button", { name: "Roll the dice" }).click();

    await page.getByRole("button", { name: /Build road/ }).click();
    await page.keyboard.press("Escape");

    await expect(spots(page)).toHaveCount(0);
    await expect(page.locator("#announcer")).toHaveText("Building cancelled.");
  });

  test("given End turn, play passes to the next player, who must roll", async ({ page }) => {
    await startPlay(page);
    await playOpening(page);
    await nextDice(page, 1, 1);
    await page.getByRole("button", { name: "Roll the dice" }).click();

    await page.getByRole("button", { name: "End turn" }).click();

    await expect(turnTitle(page)).toHaveText("Ben's turn");
    await expect(page.getByRole("button", { name: "Roll the dice" })).toBeVisible();
  });

  test("given a reload mid-game, the same position and turn come back", async ({ page }) => {
    await startPlay(page);
    await playOpening(page);
    await nextDice(page, 2, 1);
    await page.getByRole("button", { name: "Roll the dice" }).click();
    await page.getByRole("button", { name: /Build road/ }).click();
    await spots(page).first().click();

    await page.reload();

    await expect(turnTitle(page)).toHaveText("Ana's turn");
    await expect(player(page, "Ana").locator(".supply")).toContainText("12 roads");
    await expect(page.locator("#play-board .piece--road")).toHaveCount(5);
  });
});

test.describe("Feature: the robber", () => {
  test("given a 7, the roller moves the robber to a highlighted hex and play carries on", async ({ page }) => {
    await startPlay(page);
    await playOpening(page);
    const robber = page.locator("#play-board .robber");
    const before = await robber.getAttribute("transform");

    await nextDice(page, 3, 4);
    await page.getByRole("button", { name: "Roll the dice" }).click();
    await expect(page.locator(".roll__text")).toHaveText("Rolled 7. Nobody collects; the robber moves.");
    await expect(page.locator("#play-board-hint")).toContainText("robber");
    await expect(spots(page)).toHaveCount(18);
    await expect(spots(page).first()).toHaveAttribute("aria-label", /^Move the robber to /);

    await spots(page).first().click();
    expect(await robber.getAttribute("transform")).not.toBe(before);
    // Either someone can be robbed (choose them) or play goes straight back to building.
    const steal = page.getByRole("button", { name: /^Steal from / });
    if (await steal.count()) {
      await steal.first().click();
      await expect(page.locator("#announcer")).toContainText("stole a card from");
    }
    await expect(page.getByRole("button", { name: "End turn" })).toBeVisible();
  });
});

test.describe("Feature: failures and leaving a played game", () => {
  test("given storage fails while rolling, the error is explained and Try again rolls", async ({ page }) => {
    await startPlay(page);
    await playOpening(page);

    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function () {
        Storage.prototype.setItem = original;
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      };
    });
    await nextDice(page, 2, 2);
    await page.getByRole("button", { name: "Roll the dice" }).click();

    const failure = page.locator("#failure");
    await expect(failure).toContainText("browser storage is full");
    await expect(page.getByRole("button", { name: "Roll the dice" })).toBeVisible();

    await nextDice(page, 2, 2);
    await failure.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator(".roll__text")).toContainText("Rolled 4.");
  });

  test("given New game, the played game is discarded after confirming", async ({ page }) => {
    await startPlay(page);
    await spots(page).first().click();

    await page.getByRole("button", { name: "New game" }).click();
    await expect(page.getByRole("dialog")).toContainText("Ana, Ben");
    await page.getByRole("button", { name: "Discard and start over" }).click();

    await expect(page.locator("#setup")).toBeVisible();
    await expect(page.locator("#play")).toBeHidden();
  });
});

test.describe("Feature: development cards", () => {
  test("given a knight from an earlier turn, playing it moves the robber and adds to the army", async ({ page }) => {
    const { log, player: holder } = gameWithPlayableCard("knight");
    await page.goto("/catan");
    await page.evaluate((events) => window.localStorage.setItem("catan-play:events:local", JSON.stringify(events)), log);
    await page.reload();

    await expect(turnTitle(page)).toHaveText(`${holder}'s turn`);
    const cards = page.getByRole("region", { name: `${holder}'s development cards` });
    await expect(cards).toContainText("Play knight");
    await cards.getByRole("button", { name: "Play knight" }).click();

    await expect(page.locator("#play-turn")).toContainText("Move the robber");
    await expect(page.locator("#announcer")).toContainText(`${holder} played a knight`);
    await spots(page).first().click();
    const steal = page.getByRole("button", { name: /^Steal from / });
    if (await steal.count()) await steal.first().click();
    // A knight before the roll returns play to the roll.
    await expect(page.getByRole("button", { name: "Roll the dice" })).toBeVisible();
    await expect(player(page, holder).locator(".supply")).toContainText(/[1-9] knights? played/);
  });

  test("given Buy card is offered, the player can afford it; otherwise it is not shown", async ({ page }) => {
    await startPlay(page);
    await playOpening(page);
    await nextDice(page, 2, 1);
    await page.getByRole("button", { name: "Roll the dice" }).click();

    await expect(page.getByRole("button", { name: "End turn" })).toBeVisible();
    const buy = page.getByRole("button", { name: /Buy card/ });
    if ((await buy.count()) > 0) await expect(buy).toBeEnabled();
  });
});

test.describe("Feature: harbours", () => {
  test("given a new game, nine harbours are drawn with their rates written on them", async ({ page }) => {
    await startPlay(page);

    await expect(page.locator("#play-board .harbour")).toHaveCount(9);
    await expect(page.locator("#play-board .harbour__rate", { hasText: "3:1" })).toHaveCount(4);
    await expect(page.locator("#play-board .harbour__rate", { hasText: /^2:1 (lumber|brick|wool|grain|ore)$/ })).toHaveCount(5);
    await expect(page.locator("#play-board-list li", { hasText: /harbour by / })).toHaveCount(9);
  });
});

test.describe("Feature: trading between players", () => {
  test("given an offer, the device passes to the other player, who can accept or decline", async ({ page }) => {
    await startPlay(page);
    await playOpening(page);
    await nextDice(page, 2, 1);
    await page.getByRole("button", { name: "Roll the dice" }).click();

    await page.locator("summary", { hasText: "Trade with a player" }).click();
    const offer = page.locator(".offer__form");
    await expect(offer.getByRole("button", { name: "Offer trade" })).toBeDisabled();
    await offer.getByRole("button", { name: "You give: one more lumber" }).click();
    await offer.getByRole("button", { name: "You get: one more ore" }).click();
    await offer.getByRole("button", { name: "Offer trade" }).click();

    await expect(turnTitle(page)).toHaveText("Ben, you have a trade offer");
    await expect(page.locator(".response__terms")).toHaveText("Ana offers 1 lumber for your 1 ore.");
    await expect(page.locator("#announcer")).toContainText("Ana offered Ben 1 lumber for 1 ore");

    await page.getByRole("button", { name: "Decline" }).click();
    await expect(turnTitle(page)).toHaveText("Ana's turn");
    await expect(page.locator("#announcer")).toContainText("Ben declined Ana's trade");
    await expect(page.getByRole("button", { name: "End turn" })).toBeVisible();
  });
});

test.describe("Feature: a damaged save", () => {
  test("given an unreadable move in the saved game, play resumes from the last good move and the problem is reported with the game", async ({
    page,
  }) => {
    const log = openingLog();
    const damaged = [...log.slice(0, log.length - 2), { type: "FromTheFuture" }, ...log.slice(log.length - 2)];
    await page.evaluate((events) => window.localStorage.setItem("catan-play:events:local", JSON.stringify(events)), damaged);

    const reported = page.waitForRequest(
      (request) => request.url().endsWith("/api/client-errors") && request.postData()?.includes("play:salvaged") === true,
    );
    await page.reload();
    const body = JSON.parse((await reported).postData() ?? "{}");

    await expect(page.locator("#failure")).toContainText("Part of your saved game could not be read");
    await expect(page.locator("#failure")).toContainText(`restored to move ${log.length - 2}`);
    await expect(page.locator("#play")).toBeVisible();
    expect(body.game).toMatchObject({ id: "local", version: 1, eventCount: damaged.length });
    expect(body.game.events).toHaveLength(damaged.length);
    expect(body.game.events[log.length - 2]).toEqual({ type: "FromTheFuture" });
  });
});
