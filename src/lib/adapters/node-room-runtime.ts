import { createHash, randomBytes, randomInt } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { RoomDeps } from "../app/rooms";
import { DynamoDbRoomRepository } from "./dynamodb-room-repository";
import { sdkTable } from "./dynamodb-sdk-table";
import { MemoryRoomRepository } from "./memory-room-repository";

/**
 * The real world for the room service (ADR-019): DynamoDB when ROOMS_TABLE is
 * set (the deployed stack sets it), otherwise rooms in memory for local
 * development and e2e tests. Randomness and tokens come from node:crypto.
 */
export function roomDepsFromEnvironment(env: Record<string, string | undefined> = process.env): RoomDeps & { storage: "dynamodb" | "memory" } {
  const table = env["ROOMS_TABLE"];
  const rooms = table
    ? new DynamoDbRoomRepository(
        sdkTable(DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } }), table),
      )
    : new MemoryRoomRepository();
  return {
    storage: table ? "dynamodb" : "memory",
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
