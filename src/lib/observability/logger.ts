export type LogLevel = "debug" | "info" | "warn" | "error";

export interface RequestLog {
  readonly route: string;
  readonly method: string;
  readonly statusCode: number;
  readonly latencyMs: number;
}

export interface Logger {
  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void;
  request(entry: RequestLog): void;
}

export interface LoggerOptions {
  /** Where a finished JSON line goes (stdout in production, an array in tests). */
  readonly write: (line: string) => void;
  readonly clock: () => Date;
}

export function levelForStatus(statusCode: number): LogLevel {
  if (statusCode >= 500) return "error";
  if (statusCode >= 400) return "warn";
  return "info";
}

/**
 * One JSON object per line, so CloudWatch and similar tools can index the
 * fields. Time and output are injected, which keeps this pure and testable.
 */
export function createLogger({ write, clock }: LoggerOptions): Logger {
  const emit = (entry: Record<string, unknown>) => write(JSON.stringify(entry));

  return {
    log(level, message, fields = {}) {
      // Reserved keys are spread last so callers cannot overwrite them.
      emit({ ...fields, timestamp: clock().toISOString(), level, message });
    },
    request({ route, method, statusCode, latencyMs }) {
      emit({
        timestamp: clock().toISOString(),
        level: levelForStatus(statusCode),
        route,
        method,
        statusCode,
        latencyMs: Math.round(latencyMs),
      });
    },
  };
}
