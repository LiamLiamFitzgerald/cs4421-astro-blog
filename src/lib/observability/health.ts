export interface HealthPayload {
  readonly status: "ok";
  /** Whole seconds since the process started; never negative. */
  readonly uptime: number;
  /** ISO 8601 time the payload was produced. */
  readonly timestamp: string;
}

/** Pure: the caller supplies both clocks, so this is trivially testable. */
export function healthPayload(startedAt: Date, now: Date): HealthPayload {
  const seconds = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
  return {
    status: "ok",
    uptime: Math.max(0, seconds),
    timestamp: now.toISOString(),
  };
}
