import type { RateLimiter } from "./rate-limit";
import { parsePlayCommand } from "./room-commands";
import {
  createRoom,
  describeRoomError,
  getRoomView,
  joinRoom,
  parseRoomCode,
  resizeRoom,
  type RoomDeps,
  type RoomError,
  runRoomCommand,
  startRoom,
} from "./rooms";

/**
 * The rooms HTTP API (ADR-019) as plain functions from request parts to a
 * status and body, so every rule is unit tested and the Astro route stays thin.
 *
 *   GET  /api/rooms?code=ABCD&since=7                 the view (token header: a seat's or the host's)
 *   POST /api/rooms {action: "create", seats}          a new lobby; returns the host token
 *   POST /api/rooms {action: "join", code, name}       take the next free seat
 *   POST /api/rooms {action: "resize", code, seats}    host token: change the lobby's size
 *   POST /api/rooms {action: "start", code}            host token: deal the board
 *   POST /api/rooms {action: "command", code, command} seat token: a move
 */
export interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface RoomLimits {
  readonly create: RateLimiter;
  readonly join: RateLimiter;
  readonly command: RateLimiter;
  readonly view: RateLimiter;
}

/** Largest request body accepted, in bytes. */
export const MAX_ROOM_BODY_BYTES = 8192;

const STATUS: Readonly<Record<RoomError["code"], number>> = {
  NO_SUCH_ROOM: 404,
  BAD_SEAT_COUNT: 400,
  SEATS_TAKEN: 409,
  BAD_NAME: 400,
  NAME_TAKEN: 409,
  ROOM_FULL: 409,
  NOT_HOST: 403,
  ALREADY_STARTED: 409,
  NOT_STARTED: 409,
  TOO_FEW_PLAYERS: 409,
  NOT_A_PLAYER: 403,
  BAD_TOKEN: 403,
  NOT_YOUR_SEAT: 403,
  NOT_ALLOWED: 400,
  BUSY: 503,
  RULES: 422,
};

const refuse = (status: number, error: string, extra: Record<string, unknown> = {}): ApiResponse => ({
  status,
  body: { error, ...extra },
});
const fromRoomError = (error: RoomError): ApiResponse =>
  refuse(STATUS[error.code], describeRoomError(error), error.code === "RULES" ? { violation: error.violation } : { code: error.code });
const tooMany = refuse(429, "Too many requests. Wait a minute and try again.");

export async function getRoom(
  deps: RoomDeps,
  limits: RoomLimits,
  query: URLSearchParams,
  token: string | null,
  client: string,
  /** Where screens connect for push notices (ADR-019), or null to poll only. */
  push: string | null = null,
): Promise<ApiResponse> {
  if (!limits.view.allow(client)) return tooMany;
  const code = parseRoomCode(query.get("code") ?? "");
  if (!code) return refuse(400, "code must be a 4-letter room code");
  const rawSince = query.get("since");
  const since = rawSince === null ? null : Number(rawSince);
  if (since !== null && !(Number.isInteger(since) && since >= 0)) return refuse(400, "since must be a version number");
  const result = await getRoomView(deps, code, token, since);
  if (!result.ok) return fromRoomError(result.error);
  const full = !("unchanged" in result.value);
  return { status: 200, body: full && push ? { ...result.value, push } : result.value };
}

export async function postRoom(
  deps: RoomDeps,
  limits: RoomLimits,
  body: unknown,
  token: string | null,
  client: string,
): Promise<ApiResponse> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return refuse(400, "request must be a JSON object");
  const fields = body as Record<string, unknown>;

  switch (fields["action"]) {
    case "create": {
      if (!limits.create.allow(client)) return tooMany;
      const seats = fields["seats"];
      if (typeof seats !== "number") return refuse(400, "seats must be a number of players");
      const result = await createRoom(deps, seats);
      return result.ok ? { status: 201, body: result.value } : fromRoomError(result.error);
    }
    case "join": {
      if (!limits.join.allow(client)) return tooMany;
      const code = parseRoomCode(typeof fields["code"] === "string" ? fields["code"] : "");
      if (!code) return refuse(400, "code must be a 4-letter room code");
      const name = fields["name"];
      if (typeof name !== "string") return refuse(400, "name must be text");
      const result = await joinRoom(deps, code, name);
      return result.ok ? { status: 201, body: result.value } : fromRoomError(result.error);
    }
    case "resize":
    case "start": {
      if (!limits.command.allow(client)) return tooMany;
      if (!token) return refuse(401, "the host token is required");
      const code = parseRoomCode(typeof fields["code"] === "string" ? fields["code"] : "");
      if (!code) return refuse(400, "code must be a 4-letter room code");
      if (fields["action"] === "start") {
        const result = await startRoom(deps, code, token);
        return result.ok ? { status: 200, body: result.value } : fromRoomError(result.error);
      }
      const seats = fields["seats"];
      if (typeof seats !== "number") return refuse(400, "seats must be a number of players");
      const result = await resizeRoom(deps, code, token, seats);
      return result.ok ? { status: 200, body: result.value } : fromRoomError(result.error);
    }
    case "command": {
      if (!limits.command.allow(client)) return tooMany;
      if (!token) return refuse(401, "a seat token is required");
      const code = parseRoomCode(typeof fields["code"] === "string" ? fields["code"] : "");
      if (!code) return refuse(400, "code must be a 4-letter room code");
      const command = parsePlayCommand(fields["command"]);
      if (!command.ok) return refuse(400, command.error);
      const result = await runRoomCommand(deps, code, token, command.value);
      return result.ok ? { status: 200, body: result.value } : fromRoomError(result.error);
    }
    default:
      return refuse(400, "action must be create, join, resize, start or command");
  }
}
