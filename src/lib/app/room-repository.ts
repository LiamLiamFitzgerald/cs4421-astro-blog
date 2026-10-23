import type { PlayEvent } from "../games/catan-play/events";

/** A room as stored (ADR-019). Seats are numbered from 0 in seating order. */
export interface RoomRecord {
  readonly code: string;
  readonly names: readonly string[];
  /** Number of events in the log; every append must name the version it builds on. */
  readonly version: number;
  readonly createdAt: string;
  /** When the store may delete the room (seconds since 1970, for DynamoDB TTL). */
  readonly expiresAt: number;
}

/**
 * Port: where rooms and their event logs are kept. Like `EventStore` (ADR-004),
 * but every append is conditional on the version, so two moves made at the same
 * instant cannot both be built on the same log.
 */
export interface RoomRepository {
  /** Creates a room with version 0. False if the code is already taken. */
  create(room: Omit<RoomRecord, "version">): Promise<boolean>;
  /** The room, or null if there is none (or it has expired). */
  get(code: string): Promise<RoomRecord | null>;
  /** Takes a seat for a token hash. False if the seat is already taken. */
  claimSeat(code: string, seat: number, tokenHash: string): Promise<boolean>;
  /** Token hashes of the taken seats. */
  seats(code: string): Promise<ReadonlyMap<number, string>>;
  /** Events after the first `after` (all of them by default), in order. */
  events(code: string, after?: number): Promise<readonly PlayEvent[]>;
  /** Appends if the room is still at `expected`; false (and nothing written) otherwise. */
  append(code: string, expected: number, events: readonly PlayEvent[]): Promise<boolean>;
}
