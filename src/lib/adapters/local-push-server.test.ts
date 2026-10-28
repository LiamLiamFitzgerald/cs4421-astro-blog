import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { type LocalPush, startLocalPush } from "./local-push-server";

let push: LocalPush | null = null;
afterEach(async () => {
  await push?.close();
  push = null;
});

const open = (url: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
const nextMessage = (socket: WebSocket) => new Promise<string>((resolve) => socket.once("message", (data) => resolve(String(data))));

describe("Feature: the local push stand-in", () => {
  it("given a screen in a room, tells it when that room changes and not others", async () => {
    push = startLocalPush(4711);
    const a = await open("ws://127.0.0.1:4711/?code=ABCD");
    const b = await open("ws://127.0.0.1:4711/?code=WXYZ");
    let bHeard = false;
    b.on("message", () => (bHeard = true));
    const heard = nextMessage(a);
    await push.notify("ABCD");
    expect(JSON.parse(await heard)).toEqual({ type: "changed" });
    await new Promise((r) => setTimeout(r, 50));
    expect(bHeard).toBe(false);
    a.close();
    b.close();
  });

  it("given no room code, closes the connection", async () => {
    push = startLocalPush(4712);
    const socket = new WebSocket("ws://127.0.0.1:4712/");
    const code = await new Promise<number>((resolve) => socket.once("close", (c) => resolve(c)));
    expect(code).toBe(1008);
  });
});
