import { describe, expect, it } from "vitest";
import { describeEventStoreContract } from "../app/event-store-contract";
import { type KeyValueStorage, LocalStorageEventStore } from "./local-storage-event-store";

/** In-memory stand-in for window.localStorage. */
class FakeStorage implements KeyValueStorage {
  readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

describeEventStoreContract(
  "LocalStorageEventStore",
  () => new LocalStorageEventStore(new FakeStorage()),
);

describe("Feature: browser storage specifics", () => {
  it("given a new store over the same storage, it sees earlier games (survives a reload)", async () => {
    const storage = new FakeStorage();
    await new LocalStorageEventStore(storage).append("g1", [{ type: "a" }]);

    expect(await new LocalStorageEventStore(storage).load("g1")).toEqual([{ type: "a" }]);
  });

  it("given corrupt JSON, load returns an empty log", async () => {
    const storage = new FakeStorage();
    storage.setItem("catan:events:g1", "{not json");

    expect(await new LocalStorageEventStore(storage).load("g1")).toEqual([]);
  });

  it("given JSON that is not a list, load returns an empty log", async () => {
    const storage = new FakeStorage();
    storage.setItem("catan:events:g1", '{"type":"a"}');

    expect(await new LocalStorageEventStore(storage).load("g1")).toEqual([]);
  });

  it("given clear, the game's log is removed and other games are kept", async () => {
    const storage = new FakeStorage();
    const store = new LocalStorageEventStore(storage);
    await store.append("g1", [{ type: "a" }]);
    await store.append("g2", [{ type: "b" }]);

    store.clear("g1");

    expect(await store.load("g1")).toEqual([]);
    expect(await store.load("g2")).toEqual([{ type: "b" }]);
  });

  it("given an empty append, nothing is written", async () => {
    const storage = new FakeStorage();

    await new LocalStorageEventStore(storage).append("g1", []);

    expect(storage.items.size).toBe(0);
  });

  it("uses the prefix so other keys in storage are untouched", async () => {
    const storage = new FakeStorage();
    await new LocalStorageEventStore(storage, "x:").append("g1", [{ type: "a" }]);

    expect([...storage.items.keys()]).toEqual(["x:g1"]);
  });
});
