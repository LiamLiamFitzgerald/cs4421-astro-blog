import type { PlayEvent } from "../games/catan-play/events";

/** A room as stored (ADR-019, ADR-021). Seats are numbered from 0 in seating order. */
export interface RoomRecord {
  readonly code: string;
  /** How many seats the lobby offers (2 to 6). Fixed once the game starts. */
  readonly seats: number;
  /** Hash of the host's token; only the host may resize or start. */
  readonly hostTokenHash: string;
  /** Number of events in the log; 0 while in the lobby. Every append names the version it builds on. */
  readonly version: number;
  readonly createdAt: string;
  /** When the store may delete the room (seconds since 1970, for DynamoDB TTL). */
  readonly expiresAt: number;
}

/** A taken seat: who sits there, and the hash of their token. */
export interface SeatRecord {
  readonly name: string;
  readonly tokenHash: string;
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
  /** Changes the seat count from `from` to `to`, only while in the lobby (version 0). False otherwise. */
  resize(code: string, from: number, to: number): Promise<boolean>;
  /** Takes a seat. False if it is already taken or the room does not exist. */
  claimSeat(code: string, seat: number, seated: SeatRecord): Promise<boolean>;
  /** The taken seats. */
  seats(code: string): Promise<ReadonlyMap<number, SeatRecord>>;
  /** Events after the first `after` (all of them by default), in order. */
  events(code: string, after?: number): Promise<readonly PlayEvent[]>;
  /** Appends if the room is still at `expected`; false (and nothing written) otherwise. */
  append(code: string, expected: number, events: readonly PlayEvent[]): Promise<boolean>;
}
