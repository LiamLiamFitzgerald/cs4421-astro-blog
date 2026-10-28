import { defineMiddleware } from "astro:middleware";
import { drillFailsRequest } from "./lib/observability/drill";
import { stdoutLogger as logger } from "./lib/observability/stdout-logger";

export const onRequest = defineMiddleware(async (context, next) => {
  const started = performance.now();
  const route = new URL(context.request.url).pathname;
  const method = context.request.method;
  // ADR-016: a release deployed for the rollback drill fails on purpose.
  if (drillFailsRequest(route, process.env["ROLLBACK_DRILL"])) {
    logger.request({ route, method, statusCode: 500, latencyMs: performance.now() - started });
    logger.log("warn", "rollback drill: failing on purpose", { route });
    return new Response("This release fails on purpose for the rollback drill.", {
      status: 500,
      headers: { "content-type": "text/plain", "cache-control": "no-store" },
    });
  }
  try {
    const response = await next();
    logger.request({
      route,
      method,
      statusCode: response.status,
      latencyMs: performance.now() - started,
    });
    return response;
  } catch (error) {
    logger.request({
      route,
      method,
      statusCode: 500,
      latencyMs: performance.now() - started,
    });
    // The cause goes to the log; the visitor gets Astro's generic error page.
    logger.log("error", "unhandled server error", {
      route,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});
