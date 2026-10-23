import { describe, expect, it } from "vitest";
import { describeRoomRepositoryContract } from "../app/room-repository-contract";
import { DynamoDbRoomRepository, MemoryTable } from "./dynamodb-room-repository";

describeRoomRepositoryContract("DynamoDbRoomRepository", () => new DynamoDbRoomRepository(new MemoryTable()));

const base = { code: "ABCD", names: ["Ana", "Ben"], createdAt: "2026-10-23T18:00:00.000Z" };

describe("Feature: the table layout", () => {
  it("stores the room, seats and events under one partition, events in log order", async () => {
    const table = new MemoryTable();
    const repo = new DynamoDbRoomRepository(table);
    await repo.create({ ...base, expiresAt: 4102444800 });
    await repo.claimSeat("ABCD", 1, "h");
    await repo.append("ABCD", 0, [{ type: "TurnEnded", player: "a" }]);
    expect(await table.get("ROOM#ABCD", "META")).toMatchObject({ names: ["Ana", "Ben"], version: 1, expiresAt: 4102444800 });
    expect(await table.get("ROOM#ABCD", "SEAT#1")).toMatchObject({ tokenHash: "h", expiresAt: 4102444800 });
    expect(await table.get("ROOM#ABCD", "EVT#000001")).toMatchObject({ event: { type: "TurnEnded", player: "a" }, expiresAt: 4102444800 });
  });

  it("keeps log order past nine events (zero-padded keys)", async () => {
    const repo = new DynamoDbRoomRepository(new MemoryTable());
    await repo.create({ ...base, expiresAt: 4102444800 });
    const events = Array.from({ length: 12 }, (_, i) => ({ type: "TurnEnded" as const, player: String(i) }));
    await repo.append("ABCD", 0, events);
    expect((await repo.events("ABCD")).map((e) => (e as { player: string }).player)).toEqual(events.map((e) => e.player));
    expect(await repo.events("ABCD", 10)).toEqual(events.slice(10));
  });

  it("given a room past its expiry but not yet deleted by TTL, treats it as gone and does not reuse the code", async () => {
    let now = new Date("2026-10-23T18:00:00Z");
    const repo = new DynamoDbRoomRepository(new MemoryTable(), () => now);
    await repo.create({ ...base, expiresAt: now.getTime() / 1000 + 60 });
    now = new Date(now.getTime() + 61_000);
    expect(await repo.get("ABCD")).toBeNull();
    expect(await repo.events("ABCD")).toEqual([]);
    expect((await repo.seats("ABCD")).size).toBe(0);
    expect(await repo.claimSeat("ABCD", 0, "h")).toBe(false);
    expect(await repo.append("ABCD", 0, [{ type: "TurnEnded", player: "a" }])).toBe(false);
    expect(await repo.create({ ...base, expiresAt: now.getTime() / 1000 + 60 })).toBe(false);
  });
});

describe("Feature: the in-memory table follows DynamoDB's rules", () => {
  it("refuses a conditional append when one of the items already exists", async () => {
    const table = new MemoryTable();
    await table.putIfAbsent({ pk: "p", sk: "META", version: 0 });
    await table.putIfAbsent({ pk: "p", sk: "EVT#000001" });
    expect(await table.appendAt("p", 0, 1, [{ pk: "p", sk: "EVT#000001" }])).toBe(false);
    expect((await table.get("p", "META"))?.["version"]).toBe(0);
  });

  it("deletes items, and deleting a missing one is fine", async () => {
    const table = new MemoryTable();
    await table.putIfAbsent({ pk: "p", sk: "a" });
    await table.delete("p", "a");
    await table.delete("p", "missing");
    expect(await table.get("p", "a")).toBeNull();
  });

  it("refuses an append to a partition with no META", async () => {
    expect(await new MemoryTable().appendAt("p", 0, 1, [])).toBe(false);
  });

  it("returns copies, so callers cannot change stored items", async () => {
    const table = new MemoryTable();
    await table.putIfAbsent({ pk: "p", sk: "a", list: [1] });
    const got = await table.get("p", "a");
    (got?.["list"] as number[]).push(2);
    expect((await table.get("p", "a"))?.["list"]).toEqual([1]);
  });
});
