import type { APIRoute } from "astro";
import { healthPayload } from "../../lib/observability/health";

// Captured once when the server process starts, so uptime is real.
const startedAt = new Date();

export const GET: APIRoute = () =>
  new Response(JSON.stringify(healthPayload(startedAt, new Date())), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
