import { defineMiddleware } from "astro:middleware";
import { stdoutLogger as logger } from "./lib/observability/stdout-logger";

export const onRequest = defineMiddleware(async (context, next) => {
  const started = performance.now();
  const route = new URL(context.request.url).pathname;
  const method = context.request.method;
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
