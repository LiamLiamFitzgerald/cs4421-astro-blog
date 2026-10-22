import type { APIRoute } from "astro";
import { readinessReport } from "../../lib/observability/readiness";
import { serverChecks } from "../../lib/observability/readiness-checks";

/** Readiness: 200 when every check passes, 503 naming the failures otherwise. */
export const GET: APIRoute = async () => {
  const report = await readinessReport(serverChecks);
  return new Response(JSON.stringify(report), {
    status: report.status === "ready" ? 200 : 503,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
