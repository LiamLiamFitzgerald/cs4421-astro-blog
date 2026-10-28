/**
 * Fault injection for the rollback drill (ADR-016). A release deployed with
 * ROLLBACK_DRILL=fail-requests answers pages and the API with 500, so the
 * canary's alarm should fire and CodeDeploy should roll it back. The probes stay
 * healthy on purpose: the broken release must pass readiness and take canary
 * traffic, or the drill would only test the readiness check.
 *
 * Off unless that exact value is set; only `cdk deploy -c rollbackDrill=true`
 * sets it.
 */
export const DRILL_MODE = "fail-requests";

const PROBES = new Set(["/api/live", "/api/ready", "/api/health"]);

export function drillFailsRequest(path: string, mode: string | undefined): boolean {
  return mode === DRILL_MODE && !PROBES.has(path);
}
