import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { RoomNotifier } from "../app/rooms";
import { CHANGED_MESSAGE } from "./apigw-room-notifier";

/**
 * A local stand-in for the API Gateway WebSocket (ADR-019), for development and
 * browser tests. Same contract: connect with `?code=ABCD`, receive
 * `{"type":"changed"}` when that room changes.
 */
export interface LocalPush {
  readonly notify: RoomNotifier;
  readonly port: number;
  close(): Promise<void>;
}

export function startLocalPush(port: number): LocalPush {
  const server = new WebSocketServer({ port, host: "0.0.0.0" });
  const rooms = new Map<string, Set<WebSocket>>();
  server.on("connection", (socket: WebSocket, request: IncomingMessage) => {
    const code = new URL(request.url ?? "/", "http://local").searchParams.get("code") ?? "";
    if (!/^[A-Z]{4}$/.test(code)) {
      socket.close(1008, "code required");
      return;
    }
    const screens = rooms.get(code) ?? new Set<WebSocket>();
    screens.add(socket);
    rooms.set(code, screens);
    socket.on("close", () => screens.delete(socket));
  });
  return {
    port,
    async notify(code) {
      for (const socket of rooms.get(code) ?? []) {
        if (socket.readyState === WebSocket.OPEN) socket.send(CHANGED_MESSAGE);
      }
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
