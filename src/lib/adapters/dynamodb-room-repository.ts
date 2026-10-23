import type { RoomRecord, RoomRepository } from "../app/room-repository";
import type { PlayEvent } from "../games/catan-play/events";

/**
 * One DynamoDB table for every room (ADR-019):
 *
 *   pk = ROOM#<code>   sk = META        names, version, createdAt, expiresAt
 *                      sk = SEAT#<n>    tokenHash
 *                      sk = EVT#<seq>   event (seq zero-padded, so sk order is log order)
 *
 * Every item carries expiresAt, so TTL removes the whole room. An append is one
 * transaction: bump META.version only if it still equals the expected version,
 * and write the new events. Either all of it lands or none of it does.
 */
export type Item = Record<string, unknown> & { pk: string; sk: string };

/**
 * The few table operations the repository needs. The AWS SDK implements it in
 * production (`sdkTable`); tests use an in-memory version with the same rules.
 */
export interface Table {
  /** Writes the item unless one with the same key exists. False if it did. */
  putIfAbsent(item: Item): Promise<boolean>;
  get(pk: string, sk: string): Promise<Item | null>;
  /** Removes an item if it exists. */
  delete(pk: string, sk: string): Promise<void>;
  /** Items under `pk` whose sort key starts with `prefix` and is greater than `after`, in key order. */
  query(pk: string, prefix: string, after?: string): Promise<Item[]>;
  /**
   * Atomically sets META.version from `expected` to `next` and writes `items`.
   * False, with nothing written, if META is missing or its version is not `expected`.
   */
  appendAt(pk: string, expected: number, next: number, items: Item[]): Promise<boolean>;
}

const SEQ_DIGITS = 6;
const roomKey = (code: string) => `ROOM#${code}`;
const eventKey = (seq: number) => `EVT#${String(seq).padStart(SEQ_DIGITS, "0")}`;
const seatKey = (seat: number) => `SEAT#${seat}`;

export class DynamoDbRoomRepository implements RoomRepository {
  constructor(
    private readonly table: Table,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Refused while any META exists for the code, even an expired one that TTL has
   * not deleted yet: overwriting it would leave its old seats and events behind.
   * The caller simply picks another code.
   */
  async create(room: Omit<RoomRecord, "version">): Promise<boolean> {
    return this.table.putIfAbsent({
      pk: roomKey(room.code),
      sk: "META",
      names: [...room.names],
      version: 0,
      createdAt: room.createdAt,
      expiresAt: room.expiresAt,
    });
  }

  async get(code: string): Promise<RoomRecord | null> {
    const meta = await this.table.get(roomKey(code), "META");
    if (!meta || this.expired(meta)) return null;
    return {
      code,
      names: meta["names"] as string[],
      version: meta["version"] as number,
      createdAt: meta["createdAt"] as string,
      expiresAt: meta["expiresAt"] as number,
    };
  }

  async claimSeat(code: string, seat: number, tokenHash: string): Promise<boolean> {
    const room = await this.get(code);
    if (!room) return false;
    return this.table.putIfAbsent({ pk: roomKey(code), sk: seatKey(seat), tokenHash, expiresAt: room.expiresAt });
  }

  async seats(code: string): Promise<ReadonlyMap<number, string>> {
    if (!(await this.get(code))) return new Map();
    const items = await this.table.query(roomKey(code), "SEAT#");
    return new Map(items.map((i) => [Number(i.sk.slice("SEAT#".length)), i["tokenHash"] as string]));
  }

  async events(code: string, after = 0): Promise<readonly PlayEvent[]> {
    if (!(await this.get(code))) return [];
    const items = await this.table.query(roomKey(code), "EVT#", after > 0 ? eventKey(after) : undefined);
    return items.map((i) => i["event"] as PlayEvent);
  }

  async append(code: string, expected: number, events: readonly PlayEvent[]): Promise<boolean> {
    const room = await this.get(code);
    if (!room) return false;
    const items = events.map((event, i) => ({
      pk: roomKey(code),
      sk: eventKey(expected + i + 1),
      event,
      expiresAt: room.expiresAt,
    }));
    return this.table.appendAt(roomKey(code), expected, expected + events.length, items);
  }

  private expired(item: Item): boolean {
    return typeof item["expiresAt"] === "number" && item["expiresAt"] * 1000 <= this.now().getTime();
  }
}

/** An in-memory Table with DynamoDB's conditional-write rules, for tests and local runs. */
export class MemoryTable implements Table {
  private readonly items = new Map<string, Item>();
  private key = (pk: string, sk: string) => `${pk}\u0000${sk}`;

  async putIfAbsent(item: Item): Promise<boolean> {
    const k = this.key(item.pk, item.sk);
    if (this.items.has(k)) return false;
    this.items.set(k, structuredClone(item));
    return true;
  }

  async get(pk: string, sk: string): Promise<Item | null> {
    const item = this.items.get(this.key(pk, sk));
    return item ? structuredClone(item) : null;
  }

  async delete(pk: string, sk: string): Promise<void> {
    this.items.delete(this.key(pk, sk));
  }

  async query(pk: string, prefix: string, after?: string): Promise<Item[]> {
    return [...this.items.values()]
      .filter((i) => i.pk === pk && i.sk.startsWith(prefix) && (after === undefined || i.sk > after))
      .sort((a, b) => (a.sk < b.sk ? -1 : 1))
      .map((i) => structuredClone(i));
  }

  async appendAt(pk: string, expected: number, next: number, items: Item[]): Promise<boolean> {
    const meta = this.items.get(this.key(pk, "META"));
    if (!meta || meta["version"] !== expected) return false;
    if (items.some((i) => this.items.has(this.key(i.pk, i.sk)))) return false;
    meta["version"] = next;
    for (const item of items) this.items.set(this.key(item.pk, item.sk), structuredClone(item));
    return true;
  }
}
