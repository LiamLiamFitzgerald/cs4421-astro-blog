/**
 * Liveness answers "is the process up?" and checks nothing else. Readiness
 * answers "can it serve traffic right now?" by running named checks. Today the
 * checks are in-process; a database check joins them when rooms arrive.
 */
export interface ReadinessCheck {
  readonly name: string;
  /** Returns true when healthy. A throw or a false both count as failing. */
  readonly run: () => boolean | Promise<boolean>;
}

export interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
}

export interface ReadinessReport {
  readonly status: "ready" | "not-ready";
  readonly checks: readonly CheckResult[];
}

export interface LivenessPayload {
  readonly status: "ok";
}

export const livenessPayload = (): LivenessPayload => ({ status: "ok" });

async function runOne(check: ReadinessCheck): Promise<CheckResult> {
  try {
    return { name: check.name, ok: (await check.run()) === true };
  } catch {
    return { name: check.name, ok: false };
  }
}

/** Runs every check (never short-circuits, so the report names all failures). */
export async function readinessReport(checks: readonly ReadinessCheck[]): Promise<ReadinessReport> {
  const results = await Promise.all(checks.map(runOne));
  return { status: results.every((r) => r.ok) ? "ready" : "not-ready", checks: results };
}
