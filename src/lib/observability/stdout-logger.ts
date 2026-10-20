import { createLogger } from "./logger";

/** The server's logger: one JSON line per entry on stdout, which ECS ships to CloudWatch Logs. */
export const stdoutLogger = createLogger({
  write: (line) => console.log(line),
  clock: () => new Date(),
});
