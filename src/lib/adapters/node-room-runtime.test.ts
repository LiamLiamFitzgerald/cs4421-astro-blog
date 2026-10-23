import { describe, expect, it } from "vitest";
import { DynamoDbRoomRepository } from "./dynamodb-room-repository";
import { MemoryRoomRepository } from "./memory-room-repository";
import { clientAddress, roomDepsFromEnvironment } from "./node-room-runtime";

describe("Feature: choosing where rooms live", () => {
  it("given ROOMS_TABLE, uses DynamoDB", () => {
    const deps = roomDepsFromEnvironment({ ROOMS_TABLE: "rooms" });
    expect(deps.storage).toBe("dynamodb");
    expect(deps.rooms).toBeInstanceOf(DynamoDbRoomRepository);
  });

  it("given the WebSocket settings and a table, pushes through API Gateway", () => {
    const deps = roomDepsFromEnvironment({ ROOMS_TABLE: "rooms", WS_CALLBACK_URL: "https://cb", WS_URL: "wss://ws" });
    expect(deps.notify).toBeTypeOf("function");
    expect(deps.pushUrl("example.org")).toBe("wss://ws");
  });

  it("given no push settings, has no notifier and screens poll", () => {
    const deps = roomDepsFromEnvironment({ ROOMS_TABLE: "rooms", WS_URL: "wss://ws" });
    expect(deps.notify).toBeUndefined();
    expect(deps.pushUrl("example.org")).toBeNull();
  });

  it("given a local push port, uses the stand-in on the page's host", async () => {
    const deps = roomDepsFromEnvironment({ ROOMS_PUSH_LOCAL_PORT: "4713" });
    expect(deps.pushUrl("192.168.1.20")).toBe("ws://192.168.1.20:4713");
    await deps.notify?.("ABCD");
  });

  it("given no table, keeps rooms in memory", () => {
    const deps = roomDepsFromEnvironment({});
    expect(deps.storage).toBe("memory");
    expect(deps.rooms).toBeInstanceOf(MemoryRoomRepository);
  });

  it("makes long random tokens and hashes them one way", () => {
    const deps = roomDepsFromEnvironment({});
    const a = deps.newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(deps.newToken()).not.toBe(a);
    expect(deps.hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(deps.hashToken(a)).toBe(deps.hashToken(a));
  });

  it("draws fair numbers in range", () => {
    const deps = roomDepsFromEnvironment({});
    for (let i = 0; i < 200; i++) {
      const v = deps.random(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
    expect(deps.random(1)).toBe(0);
  });
});

describe("Feature: finding the visitor's address", () => {
  it.each([
    [null, "local"],
    ["", "local"],
    ["203.0.113.5", "203.0.113.5"],
    ["203.0.113.5, 130.176.1.1", "203.0.113.5"],
    ["6.6.6.6, 203.0.113.5, 130.176.1.1", "203.0.113.5"],
  ])("given X-Forwarded-For %j, uses %s", (header, address) => {
    expect(clientAddress(header)).toBe(address);
  });
});
