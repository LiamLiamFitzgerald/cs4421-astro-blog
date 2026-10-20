import type { EventStore } from "../app/event-store";

/** The part of the Web Storage API this adapter needs. `window.localStorage` fits. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Keeps each game's event log as JSON in browser storage, so a game survives a
 * reload. Storage is injected, so tests use a fake and the page passes
 * `window.localStorage`. See ADR-006.
 */
export class LocalStorageEventStore<E> implements EventStore<E> {
  constructor(
    private readonly storage: KeyValueStorage,
    private readonly prefix = "catan:events:",
  ) {}

  async append(gameId: string, events: readonly E[]): Promise<void> {
    if (events.length === 0) return;
    const log = await this.load(gameId);
    this.storage.setItem(this.key(gameId), JSON.stringify([...log, ...events]));
  }

  /** Unreadable or non-list data is treated as an empty log rather than a crash. */
  async load(gameId: string): Promise<readonly E[]> {
    const raw = this.storage.getItem(this.key(gameId));
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as E[]) : [];
    } catch {
      return [];
    }
  }

  /** Removes a game's log. Not part of the port: only the page's "New game" uses it. */
  clear(gameId: string): void {
    this.storage.removeItem(this.key(gameId));
  }

  private key(gameId: string): string {
    return this.prefix + gameId;
  }
}
