import type { APIRoute } from "astro";
import { MAX_REPORT_BYTES, parseClientErrorReport } from "../../lib/observability/client-error";
import { stdoutLogger as logger } from "../../lib/observability/stdout-logger";

const refuse = (status: number, reason: string) =>
  new Response(JSON.stringify({ error: reason }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/**
 * Receives unexpected errors from visitors' browsers and writes them to the
 * same JSON log as server requests, at level "error". See docs/runbook.md.
 */
export const POST: APIRoute = async ({ request }) => {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_REPORT_BYTES) return refuse(400, "report too large");

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_REPORT_BYTES) return refuse(400, "report too large");

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse(400, "report must be valid JSON");
  }

  const report = parseClientErrorReport(body);
  if (!report.ok) return refuse(400, report.error);

  // "message" is reserved by the logger, so the browser's message is logged as errorMessage.
  const { context, name, message, page } = report.value;
  logger.log("error", "client error", {
    source: "browser",
    context,
    errorName: name,
    errorMessage: message,
    page,
  });
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
};
