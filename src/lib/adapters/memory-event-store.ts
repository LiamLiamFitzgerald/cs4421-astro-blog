import type { EventStore } from "../app/event-store";

/** Keeps event logs in memory. Useful for tests, demos and a first version. */
export class MemoryEventStore<E> implements EventStore<E> {
  private readonly logs = new Map<string, E[]>();

  async append(gameId: string, events: readonly E[]): Promise<void> {
    const log = this.logs.get(gameId) ?? [];
    this.logs.set(gameId, [...log, ...events]);
  }

  async load(gameId: string): Promise<readonly E[]> {
    return [...(this.logs.get(gameId) ?? [])];
  }
}
