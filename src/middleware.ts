import { defineMiddleware } from "astro:middleware";
import { createLogger } from "./lib/observability/logger";

// One JSON line per request on stdout; ECS ships stdout to CloudWatch Logs.
const logger = createLogger({
  write: (line) => console.log(line),
  clock: () => new Date(),
});

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
    throw error;
  }
});
