import type { PlayEvent } from "../games/catan-play/events";
import { type LogProblem, replayChecked } from "../games/catan-play/integrity";
import type { EventStore } from "./event-store";

/** A store that can also delete a game, as the browser adapter does. */
export type ClearableStore = EventStore<PlayEvent> & { clear?(gameId: string): void };

export interface SalvageReport {
  readonly gameId: string;
  readonly problems: readonly LogProblem[];
  /** True when events were dropped and the stored game was cut back. */
  readonly salvaged: boolean;
  /** Everything that was stored, before any events were dropped. */
  readonly stored: readonly unknown[];
  /** Events kept. */
  readonly kept: number;
}

/**
 * Wraps the played-game store so a damaged save does not lose the whole game
 * (ADR-014). On load the log is replayed defensively: events up to the first
 * unreadable one are kept and the store is cut back to them; broken invariants
 * are reported but change nothing. Each distinct problem is reported once per
 * page, because the page loads the log on every render.
 */
export class SalvagingPlayStore implements ClearableStore {
  private readonly seen = new Set<string>();
  private last: { gameId: string; events: readonly PlayEvent[] } | null = null;

  constructor(
    private readonly inner: ClearableStore,
    private readonly onProblem: (report: SalvageReport) => void,
  ) {}

  async append(gameId: string, events: readonly PlayEvent[]): Promise<void> {
    await this.inner.append(gameId, events);
    this.last = null;
  }

  async load(gameId: string): Promise<readonly PlayEvent[]> {
    const stored = await this.inner.load(gameId);
    const outcome = replayChecked(stored);
    if (outcome.salvaged) {
      // Cut the stored game back so the next load is clean. Without a way to
      // delete, the damage is reported each time instead.
      if (this.inner.clear) {
        this.inner.clear(gameId);
        await this.inner.append(gameId, outcome.events);
      }
    }
    const fresh = outcome.problems.filter((p) => {
      const key = `${gameId}:${p.kind}:${p.index}:${p.detail}`;
      if (this.seen.has(key)) return false;
      this.seen.add(key);
      return true;
    });
    if (fresh.length > 0) {
      this.onProblem({ gameId, problems: fresh, salvaged: outcome.salvaged, stored, kept: outcome.events.length });
    }
    this.last = { gameId, events: outcome.events };
    return outcome.events;
  }

  clear(gameId: string): void {
    this.inner.clear?.(gameId);
    this.last = null;
  }

  /** The most recently loaded log, for attaching to an error report. */
  snapshot(): { gameId: string; events: readonly PlayEvent[] } | null {
    return this.last;
  }
}
