import { describe, expect, it } from "vitest";
import { describeRoomRepositoryContract } from "../app/room-repository-contract";
import { MemoryRoomRepository } from "./memory-room-repository";

describeRoomRepositoryContract("MemoryRoomRepository", () => new MemoryRoomRepository());

describe("Feature: rooms in memory expire", () => {
  it("given a room past its expiry, it is gone", async () => {
    let now = new Date("2026-10-23T18:00:00Z");
    const repo = new MemoryRoomRepository(() => now);
    await repo.create({ code: "ABCD", seats: 2, hostTokenHash: "h", createdAt: now.toISOString(), expiresAt: now.getTime() / 1000 + 60 });
    expect(await repo.get("ABCD")).not.toBeNull();
    now = new Date(now.getTime() + 61_000);
    expect(await repo.get("ABCD")).toBeNull();
    expect(await repo.create({ code: "ABCD", seats: 2, hostTokenHash: "h", createdAt: now.toISOString(), expiresAt: now.getTime() / 1000 + 60 })).toBe(true);
  });
});
