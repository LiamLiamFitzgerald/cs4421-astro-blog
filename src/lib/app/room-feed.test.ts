import { describe, expect, it } from "vitest";
import { createRoomFeed, FEED_FAST_MS, FEED_QUIET_AFTER_MS, FEED_SLOW_MS, type FeedAnswer } from "./room-feed";

type View = { name: string };

/** A fake clock and timer queue, and a server whose answers the test controls. */
function harness(answers: (FeedAnswer<View> | Error)[]) {
  let t = 0;
  let hidden = false;
  const timers: { run: () => void; at: number; id: number }[] = [];
  let id = 0;
  const asked: (number | null)[] = [];
  const views: (View & { version: number })[] = [];
  const errors: unknown[] = [];
  const feed = createRoomFeed<View>({
    fetch: async (since) => {
      asked.push(since);
      const next = answers.shift() ?? { unchanged: true, version: since ?? 0 };
      if (next instanceof Error) throw next;
      return next;
    },
    onView: (v) => views.push(v),
    onError: (e) => errors.push(e),
    isHidden: () => hidden,
    now: () => t,
    setTimer: (run, ms) => {
      const handle = ++id;
      timers.push({ run, at: t + ms, id: handle });
      return handle;
    },
    clearTimer: (handle) => {
      const i = timers.findIndex((x) => x.id === handle);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  /** Moves the clock to the next timer and runs it. */
  const tick = async () => {
    const next = timers.sort((a, b) => a.at - b.at).shift();
    if (!next) return null;
    const waited = next.at - t;
    t = next.at;
    next.run();
    await new Promise((r) => setTimeout(r, 0));
    return waited;
  };
  return { feed, asked, views, errors, timers, tick, setTime: (ms: number) => (t = ms), hide: (h: boolean) => (hidden = h) };
}

const view = (version: number, name = `v${version}`) => ({ version, name });

describe("Feature: keeping a room screen up to date", () => {
  it("given a start, fetches the whole view, shows it, then polls quickly with its version", async () => {
    const h = harness([view(3), { unchanged: true, version: 3 }]);
    await h.feed.start();
    expect(h.asked).toEqual([null]);
    expect(h.views).toEqual([view(3)]);
    expect(h.feed.version()).toBe(3);
    expect(await h.tick()).toBe(FEED_FAST_MS);
    expect(h.asked).toEqual([null, 3]);
    expect(h.views).toHaveLength(1);
  });

  it("given a new version, shows it and keeps polling quickly", async () => {
    const h = harness([view(1), view(2)]);
    await h.feed.start();
    await h.tick();
    expect(h.views.map((v) => v.version)).toEqual([1, 2]);
    expect(h.feed.nextDelay()).toBe(FEED_FAST_MS);
  });

  it("given a quiet game, slows down after a minute and speeds up when a move arrives", async () => {
    const h = harness([view(1)]);
    await h.feed.start();
    h.setTime(FEED_QUIET_AFTER_MS - 1);
    expect(h.feed.nextDelay()).toBe(FEED_FAST_MS);
    h.setTime(FEED_QUIET_AFTER_MS);
    expect(h.feed.nextDelay()).toBe(FEED_SLOW_MS);
    await h.feed.refresh(); // unchanged: still slow
    expect(h.feed.nextDelay()).toBe(FEED_SLOW_MS);
  });

  it("given a move after a quiet spell, polls quickly again", async () => {
    const h = harness([view(1), view(2)]);
    await h.feed.start();
    h.setTime(FEED_QUIET_AFTER_MS + 5);
    await h.feed.refresh();
    expect(h.feed.nextDelay()).toBe(FEED_FAST_MS);
  });

  it("given an error, reports it, backs off and recovers on the next answer", async () => {
    const boom = new Error("offline");
    const h = harness([boom, view(4)]);
    await h.feed.start();
    expect(h.errors).toEqual([boom]);
    expect(await h.tick()).toBe(FEED_SLOW_MS);
    expect(h.views).toEqual([view(4)]);
    expect(h.feed.nextDelay()).toBe(FEED_FAST_MS);
  });

  it("given a hidden tab, stops polling until refreshed", async () => {
    const h = harness([view(1)]);
    h.hide(true);
    await h.feed.start();
    expect(h.timers).toHaveLength(0);
    h.hide(false);
    await h.feed.refresh();
    expect(h.timers).toHaveLength(1);
  });

  it("given stop, no more polls are scheduled", async () => {
    const h = harness([view(1)]);
    await h.feed.start();
    h.feed.stop();
    expect(h.timers).toHaveLength(0);
    await h.feed.refresh();
    expect(h.timers).toHaveLength(0);
  });

  it("given a refresh while a fetch is under way, does not fetch twice", async () => {
    const h = harness([view(1)]);
    const first = h.feed.start();
    const second = h.feed.refresh();
    await Promise.all([first, second]);
    expect(h.asked).toEqual([null]);
  });

  it("keeps only one poll scheduled however often it is refreshed", async () => {
    const h = harness([view(1)]);
    await h.feed.start();
    await h.feed.refresh();
    await h.feed.refresh();
    expect(h.timers).toHaveLength(1);
  });

  it("before any view, reports no version", () => {
    expect(harness([]).feed.version()).toBeNull();
  });
});
