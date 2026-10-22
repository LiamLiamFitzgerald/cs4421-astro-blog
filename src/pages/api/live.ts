import type { APIRoute } from "astro";
import { livenessPayload } from "../../lib/observability/readiness";

/** Liveness: the process is up. Deliberately checks nothing else. */
export const GET: APIRoute = () =>
  new Response(JSON.stringify(livenessPayload()), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
