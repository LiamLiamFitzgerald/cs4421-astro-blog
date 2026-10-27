import type { RoomRecord, RoomRepository, SeatRecord } from "../app/room-repository";
import type { PlayEvent } from "../games/catan-play/events";

interface Room {
  record: RoomRecord;
  seats: Map<number, SeatRecord>;
  events: PlayEvent[];
}

/**
 * Rooms in memory, for local development and tests (ADR-019). One process
 * only: on Lambda each instance would have its own rooms, which is why
 * production uses DynamoDB.
 */
export class MemoryRoomRepository implements RoomRepository {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async create(room: Omit<RoomRecord, "version">): Promise<boolean> {
    if (this.live(room.code)) return false;
    this.rooms.set(room.code, { record: { ...room, version: 0 }, seats: new Map(), events: [] });
    return true;
  }

  async get(code: string): Promise<RoomRecord | null> {
    return this.live(code)?.record ?? null;
  }

  async resize(code: string, from: number, to: number): Promise<boolean> {
    const room = this.live(code);
    if (!room || room.record.version !== 0 || room.record.seats !== from) return false;
    room.record = { ...room.record, seats: to };
    return true;
  }

  async claimSeat(code: string, seat: number, seated: SeatRecord): Promise<boolean> {
    const room = this.live(code);
    if (!room || room.seats.has(seat)) return false;
    room.seats.set(seat, { ...seated });
    return true;
  }

  async seats(code: string): Promise<ReadonlyMap<number, SeatRecord>> {
    return new Map(this.live(code)?.seats ?? []);
  }

  async events(code: string, after = 0): Promise<readonly PlayEvent[]> {
    return this.live(code)?.events.slice(after) ?? [];
  }

  async append(code: string, expected: number, events: readonly PlayEvent[]): Promise<boolean> {
    const room = this.live(code);
    if (!room || room.record.version !== expected) return false;
    room.events.push(...events);
    room.record = { ...room.record, version: room.events.length };
    return true;
  }

  private live(code: string): Room | undefined {
    const room = this.rooms.get(code);
    if (room && room.record.expiresAt * 1000 <= this.now().getTime()) {
      this.rooms.delete(code);
      return undefined;
    }
    return room;
  }
}
