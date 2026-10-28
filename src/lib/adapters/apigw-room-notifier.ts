import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import type { RoomNotifier } from "../app/rooms";
import type { Table } from "./dynamodb-room-repository";

/**
 * Push over API Gateway WebSockets (ADR-019). The socket handler records each
 * open connection in the rooms table:
 *
 *   pk = ROOM#<code>   sk = CONN#<id>     so a room can list its screens
 *   pk = CONN#<id>     sk = CONN          code, so a disconnect can tidy up
 *
 * A notice says only that the room changed; each screen fetches its own view,
 * so no private cards travel over the broadcast.
 */
export const CHANGED_MESSAGE = JSON.stringify({ type: "changed" });

/** Sends one message to one connection. "gone" means the connection has closed. */
export type Poster = (connectionId: string, message: string) => Promise<"sent" | "gone">;

export function apiGatewayNotifier(table: Table, post: Poster): RoomNotifier {
  return async (code) => {
    const room = `ROOM#${code}`;
    const connections = await table.query(room, "CONN#");
    await Promise.all(
      connections.map(async (item) => {
        const id = item.sk.slice("CONN#".length);
        if ((await post(id, CHANGED_MESSAGE)) === "gone") {
          await Promise.all([table.delete(room, item.sk), table.delete(`CONN#${id}`, "CONN")]);
        }
      }),
    );
  };
}

/** A Poster on the real management API at `endpoint` (the stage's callback URL). */
export function sdkPoster(endpoint: string, client = new ApiGatewayManagementApiClient({ endpoint })): Poster {
  return async (connectionId, message) => {
    try {
      await client.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: new TextEncoder().encode(message) }));
      return "sent";
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if ((error instanceof Error && error.name === "GoneException") || status === 410) return "gone";
      throw error;
    }
  };
}
