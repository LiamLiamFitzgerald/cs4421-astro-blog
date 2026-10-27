import type { APIRoute } from "astro";
import { clientAddress, roomDepsFromEnvironment } from "../../lib/adapters/node-room-runtime";
import { createRateLimiter } from "../../lib/app/rate-limit";
import { type ApiResponse, getRoom, MAX_ROOM_BODY_BYTES, postRoom, type RoomLimits } from "../../lib/app/room-api";

// One set per server instance (ADR-019). The rules live in src/lib/app/room-api.ts.
const deps = roomDepsFromEnvironment();
const minute = 60_000;
// ROOMS_LIMIT_MULTIPLIER raises every per-address limit for tests that run many
// rooms from one machine (the e2e suite, load tests: #151). Production leaves it unset.
const scale = Number(process.env["ROOMS_LIMIT_MULTIPLIER"] ?? "") || 1;
const limits: RoomLimits = {
  create: createRateLimiter(10 * scale, 10 * minute),
  join: createRateLimiter(30 * scale, 10 * minute),
  command: createRateLimiter(120 * scale, minute),
  // A household shares one address: a board and six phones polling every 1.5 s.
  view: createRateLimiter(400 * scale, minute),
};

const json = ({ status, body }: ApiResponse) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const token = (request: Request) => request.headers.get("x-room-token");
const client = (request: Request) => clientAddress(request.headers.get("x-forwarded-for"));

export const GET: APIRoute = async ({ request, url }) =>
  json(await getRoom(deps, limits, url.searchParams, token(request), client(request), deps.pushUrl(url.hostname)));

export const POST: APIRoute = async ({ request }) => {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_ROOM_BODY_BYTES) return json({ status: 413, body: { error: "request too large" } });
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_ROOM_BODY_BYTES) return json({ status: 413, body: { error: "request too large" } });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ status: 400, body: { error: "request must be valid JSON" } });
  }
  return json(await postRoom(deps, limits, body, token(request), client(request)));
};
