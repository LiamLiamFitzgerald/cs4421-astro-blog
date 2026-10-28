/**
 * Port: where a match's events are kept. The application layer depends on this
 * interface only; adapters (in-memory, browser storage, a database) implement it.
 * See ADR-004.
 *
 * The store is append-only: events are added at the end and never edited.
 */
export interface EventStore<E> {
  /** Adds events to the end of a game's log. */
  append(gameId: string, events: readonly E[]): Promise<void>;
  /** Returns a game's events in append order (empty if the game is unknown). */
  load(gameId: string): Promise<readonly E[]>;
}
