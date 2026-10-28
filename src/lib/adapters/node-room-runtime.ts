import { createHash, randomBytes, randomInt } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { RoomDeps, RoomNotifier } from "../app/rooms";
import { apiGatewayNotifier, sdkPoster } from "./apigw-room-notifier";
import { DynamoDbRoomRepository, type Table } from "./dynamodb-room-repository";
import { sdkTable } from "./dynamodb-sdk-table";
import { type LocalPush, startLocalPush } from "./local-push-server";
import { MemoryRoomRepository } from "./memory-room-repository";

let localPush: LocalPush | null = null;

/**
 * The real world for the room service (ADR-019):
 *
 * - storage: DynamoDB when ROOMS_TABLE is set (the deployed stack sets it),
 *   otherwise rooms in memory for local development and e2e tests;
 * - push: API Gateway when WS_CALLBACK_URL and WS_URL are set, the local
 *   stand-in when ROOMS_PUSH_LOCAL_PORT is set, otherwise none (screens poll);
 * - randomness and tokens from node:crypto.
 */
export type RoomRuntime = RoomDeps & {
  readonly storage: "dynamodb" | "memory";
  /** Where screens connect for push notices, or null (polling only). */
  readonly pushUrl: (hostname: string) => string | null;
};

export function roomDepsFromEnvironment(env: Record<string, string | undefined> = process.env): RoomRuntime {
  const tableName = env["ROOMS_TABLE"];
  const table: Table | null = tableName
    ? sdkTable(DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } }), tableName)
    : null;
  const rooms = table ? new DynamoDbRoomRepository(table) : new MemoryRoomRepository();

  let notify: RoomNotifier | undefined;
  let pushUrl: (hostname: string) => string | null = () => null;
  const callback = env["WS_CALLBACK_URL"];
  const publicUrl = env["WS_URL"];
  const localPort = Number(env["ROOMS_PUSH_LOCAL_PORT"] ?? "");
  if (table && callback && publicUrl) {
    notify = apiGatewayNotifier(table, sdkPoster(callback));
    pushUrl = () => publicUrl;
  } else if (Number.isInteger(localPort) && localPort > 0) {
    localPush ??= startLocalPush(localPort);
    const push = localPush;
    notify = push.notify;
    pushUrl = (hostname) => `ws://${hostname}:${push.port}`;
  }

  return {
    storage: table ? "dynamodb" : "memory",
    pushUrl,
    ...(notify ? { notify } : {}),
    rooms,
    random: (n) => (n <= 1 ? 0 : randomInt(n)),
    now: () => new Date(),
    newToken: () => randomBytes(24).toString("base64url"),
    hashToken: (token) => createHash("sha256").update(token).digest("hex"),
  };
}

/**
 * The visitor's address, for rate limits. CloudFront appends the viewer's IP to
 * X-Forwarded-For and the Lambda function URL appends CloudFront's, so the
 * viewer is the second to last entry; anything before it was sent by the client
 * and cannot be trusted. Without the header (local runs), "local".
 */
export function clientAddress(forwardedFor: string | null): string {
  const hops = (forwardedFor ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  if (hops.length === 0) return "local";
  return hops.length >= 2 ? (hops[hops.length - 2] ?? "local") : (hops[0] ?? "local");
}
