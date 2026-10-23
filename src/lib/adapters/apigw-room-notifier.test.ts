import { describe, expect, it } from "vitest";
import { apiGatewayNotifier, CHANGED_MESSAGE, type Poster, sdkPoster } from "./apigw-room-notifier";
import { MemoryTable } from "./dynamodb-room-repository";

async function tableWith(connections: string[]) {
  const table = new MemoryTable();
  for (const id of connections) {
    await table.putIfAbsent({ pk: "ROOM#ABCD", sk: `CONN#${id}` });
    await table.putIfAbsent({ pk: `CONN#${id}`, sk: "CONN", code: "ABCD" });
  }
  return table;
}

describe("Feature: pushing room changes over API Gateway", () => {
  it("given connected screens, sends each a 'changed' notice and nothing else", async () => {
    const table = await tableWith(["a", "b"]);
    const sent: [string, string][] = [];
    await apiGatewayNotifier(table, async (id, m) => (sent.push([id, m]), "sent"))("ABCD");
    expect(sent.sort()).toEqual([
      ["a", CHANGED_MESSAGE],
      ["b", CHANGED_MESSAGE],
    ]);
    expect(JSON.parse(CHANGED_MESSAGE)).toEqual({ type: "changed" });
  });

  it("given a connection that has gone, forgets both of its records", async () => {
    const table = await tableWith(["live", "gone"]);
    const post: Poster = async (id) => (id === "gone" ? "gone" : "sent");
    await apiGatewayNotifier(table, post)("ABCD");
    expect((await table.query("ROOM#ABCD", "CONN#")).map((i) => i.sk)).toEqual(["CONN#live"]);
    expect(await table.get("CONN#gone", "CONN")).toBeNull();
    expect(await table.get("CONN#live", "CONN")).not.toBeNull();
  });

  it("given a room with no screens, sends nothing", async () => {
    const sent: string[] = [];
    await apiGatewayNotifier(new MemoryTable(), async (id) => (sent.push(id), "sent"))("ABCD");
    expect(sent).toEqual([]);
  });
});

describe("Feature: posting to one connection", () => {
  const client = (error?: unknown) => {
    const sent: { ConnectionId?: string; Data?: Uint8Array }[] = [];
    return {
      sent,
      send: async (command: { input: { ConnectionId?: string; Data?: Uint8Array } }) => {
        sent.push(command.input);
        if (error) throw error;
        return {};
      },
    };
  };

  it("sends the message to the connection", async () => {
    const fake = client();
    expect(await sdkPoster("https://x", fake as never)("c1", "hello")).toBe("sent");
    expect(fake.sent[0]?.ConnectionId).toBe("c1");
    expect(new TextDecoder().decode(fake.sent[0]?.Data)).toBe("hello");
  });

  it("reports a closed connection as gone", async () => {
    expect(await sdkPoster("https://x", client(Object.assign(new Error("gone"), { name: "GoneException" })) as never)("c", "m")).toBe("gone");
    expect(await sdkPoster("https://x", client({ $metadata: { httpStatusCode: 410 } }) as never)("c", "m")).toBe("gone");
  });

  it("passes on other failures", async () => {
    await expect(sdkPoster("https://x", client(new Error("throttled")) as never)("c", "m")).rejects.toThrow("throttled");
  });
});
