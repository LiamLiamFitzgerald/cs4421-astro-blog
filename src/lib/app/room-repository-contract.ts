import { describe, expect, it } from "vitest";
import type { PlayEvent } from "../games/catan-play/events";
import type { RoomRepository } from "./room-repository";

const room = (code = "ABCD") => ({
  code,
  seats: 4,
  hostTokenHash: "host-hash",
  createdAt: "2026-10-23T18:00:00.000Z",
  expiresAt: 4102444800, // 2100
});
const sit = (name: string, tokenHash = `hash-${name}`) => ({ name, tokenHash });
const e = (player: string): PlayEvent => ({ type: "TurnEnded", player });

/**
 * Behaviour every RoomRepository adapter must have (ADR-019). Call it from an
 * adapter's test file with a factory that returns a fresh, empty repository.
 */
export function describeRoomRepositoryContract(name: string, create: () => RoomRepository): void {
  describe(`Feature: ${name} behaves as a RoomRepository`, () => {
    it("given a new room, it is found at version 0 with no events or seats", async () => {
      const repo = create();
      expect(await repo.create(room())).toBe(true);
      expect(await repo.get("ABCD")).toEqual({ ...room(), version: 0 });
      expect(await repo.events("ABCD")).toEqual([]);
      expect((await repo.seats("ABCD")).size).toBe(0);
    });

    it("given a code already in use, creating it again is refused and the room is unchanged", async () => {
      const repo = create();
      await repo.create(room());
      expect(await repo.create({ ...room(), seats: 6 })).toBe(false);
      expect((await repo.get("ABCD"))?.seats).toBe(4);
    });

    it("given an unknown room, nothing is found", async () => {
      const repo = create();
      expect(await repo.get("ZZZZ")).toBeNull();
      expect(await repo.events("ZZZZ")).toEqual([]);
    });

    it("given appends at the right version, events come back in order and the version moves on", async () => {
      const repo = create();
      await repo.create(room());
      expect(await repo.append("ABCD", 0, [e("a"), e("b")])).toBe(true);
      expect(await repo.append("ABCD", 2, [e("c")])).toBe(true);
      expect(await repo.events("ABCD")).toEqual([e("a"), e("b"), e("c")]);
      expect((await repo.get("ABCD"))?.version).toBe(3);
    });

    it("given events after a point, only the later ones come back", async () => {
      const repo = create();
      await repo.create(room());
      await repo.append("ABCD", 0, [e("a"), e("b"), e("c")]);
      expect(await repo.events("ABCD", 2)).toEqual([e("c")]);
      expect(await repo.events("ABCD", 3)).toEqual([]);
    });

    it("given two appends built on the same version, only the first is kept", async () => {
      const repo = create();
      await repo.create(room());
      expect(await repo.append("ABCD", 0, [e("first")])).toBe(true);
      expect(await repo.append("ABCD", 0, [e("second")])).toBe(false);
      expect(await repo.events("ABCD")).toEqual([e("first")]);
      expect((await repo.get("ABCD"))?.version).toBe(1);
    });

    it("given an append to a room that does not exist, it is refused", async () => {
      const repo = create();
      expect(await repo.append("NONE", 0, [e("a")])).toBe(false);
    });

    it("given a free seat, it can be claimed once, keeping the name", async () => {
      const repo = create();
      await repo.create(room());
      expect(await repo.claimSeat("ABCD", 1, sit("Ana"))).toBe(true);
      expect(await repo.claimSeat("ABCD", 1, sit("Ben"))).toBe(false);
      expect(await repo.seats("ABCD")).toEqual(new Map([[1, sit("Ana")]]));
    });

    it("given a seat in a room that does not exist, it cannot be claimed", async () => {
      const repo = create();
      expect(await repo.claimSeat("NONE", 0, sit("Ana"))).toBe(false);
    });

    it("given the lobby, the seat count changes only from the count it has now", async () => {
      const repo = create();
      await repo.create(room());
      expect(await repo.resize("ABCD", 4, 5)).toBe(true);
      expect(await repo.resize("ABCD", 4, 3)).toBe(false); // someone else already changed it
      expect((await repo.get("ABCD"))?.seats).toBe(5);
    });

    it("given a game has started, the seat count can no longer change", async () => {
      const repo = create();
      await repo.create(room());
      await repo.append("ABCD", 0, [e("start")]);
      expect(await repo.resize("ABCD", 4, 5)).toBe(false);
      expect((await repo.get("ABCD"))?.seats).toBe(4);
    });

    it("given an unknown room, it cannot be resized", async () => {
      expect(await create().resize("NONE", 4, 5)).toBe(false);
    });

    it("keeps rooms apart", async () => {
      const repo = create();
      await repo.create(room("AAAA"));
      await repo.create(room("BBBB"));
      await repo.append("AAAA", 0, [e("a")]);
      await repo.claimSeat("AAAA", 0, sit("Ana"));
      expect(await repo.events("BBBB")).toEqual([]);
      expect((await repo.seats("BBBB")).size).toBe(0);
    });
  });
}
