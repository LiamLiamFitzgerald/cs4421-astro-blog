/**
 * Keeps a room screen up to date (ADR-019). This is the `RoomFeed` port's
 * polling side: it asks for the view "since" the version it has, often while
 * the game is moving, rarely once it goes quiet, and not at all while the tab is
 * hidden. A push channel (WebSocket) calls `refresh()` when it hears of a move,
 * and polling then only matters while the socket is down.
 *
 * Time, timers and visibility are passed in, so the schedule is unit tested.
 */
export type FeedAnswer<V> = { readonly unchanged: true; readonly version: number } | (V & { readonly version: number });

export interface FeedOptions<V> {
  /** Fetches the view, or "unchanged" when `since` is current. */
  readonly fetch: (since: number | null) => Promise<FeedAnswer<V>>;
  readonly onView: (view: V & { readonly version: number }) => void;
  readonly onError: (error: unknown) => void;
  readonly isHidden: () => boolean;
  readonly now: () => number;
  readonly setTimer: (run: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
  /** Between polls while moves are happening. */
  readonly fastMs?: number;
  /** Between polls once nothing has changed for `quietAfterMs`, and after an error. */
  readonly slowMs?: number;
  readonly quietAfterMs?: number;
}

export interface RoomFeed {
  /** Fetches now and keeps polling. */
  start(): Promise<void>;
  /** Fetches now (a push said something changed, or the tab came back). */
  refresh(): Promise<void>;
  stop(): void;
  /** The version last seen, or null before the first view. */
  version(): number | null;
  /** How long until the next poll, given what has happened so far. */
  nextDelay(): number;
  /** Push is (or is no longer) delivering notices; while it is, polling is only a safety net. */
  setPushConnected(connected: boolean): void;
}

export const FEED_FAST_MS = 1500;
export const FEED_SLOW_MS = 10_000;
export const FEED_QUIET_AFTER_MS = 60_000;
/** Between safety-net polls while push notices are arriving. */
export const FEED_PUSH_MS = 30_000;

export function createRoomFeed<V>(options: FeedOptions<V>): RoomFeed {
  const fast = options.fastMs ?? FEED_FAST_MS;
  const slow = options.slowMs ?? FEED_SLOW_MS;
  const quietAfter = options.quietAfterMs ?? FEED_QUIET_AFTER_MS;
  let version: number | null = null;
  let lastChange = options.now();
  let failed = false;
  let running = false;
  let timer: unknown = null;
  let inFlight: Promise<void> | null = null;
  let pushed = false;

  const nextDelay = () => {
    if (pushed && !failed) return FEED_PUSH_MS;
    return failed || options.now() - lastChange >= quietAfter ? slow : fast;
  };

  function schedule() {
    if (timer !== null) options.clearTimer(timer);
    timer = null;
    // A hidden tab does not poll; refresh() is called when it is shown again.
    if (!running || options.isHidden()) return;
    timer = options.setTimer(() => {
      timer = null;
      void poll();
    }, nextDelay());
  }

  async function poll(): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const answer = await options.fetch(version);
        failed = false;
        if (!("unchanged" in answer)) {
          version = answer.version;
          lastChange = options.now();
          options.onView(answer);
        }
      } catch (error) {
        failed = true;
        options.onError(error);
      } finally {
        inFlight = null;
        schedule();
      }
    })();
    return inFlight;
  }

  return {
    async start() {
      running = true;
      lastChange = options.now();
      await poll();
    },
    refresh: poll,
    stop() {
      running = false;
      if (timer !== null) options.clearTimer(timer);
      timer = null;
    },
    version: () => version,
    nextDelay,
    setPushConnected(connected) {
      pushed = connected;
      schedule();
    },
  };
}
