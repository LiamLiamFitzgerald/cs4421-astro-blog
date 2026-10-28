import { describe, expect, it } from "vitest";
import { readinessReport } from "./readiness";
import { serverChecks } from "./readiness-checks";

describe("Feature: the server's readiness checks", () => {
  it("given a healthy build, all checks pass", async () => {
    const report = await readinessReport(serverChecks);
    expect(report.status).toBe("ready");
    expect(report.checks.map((c) => c.name)).toEqual(["rules-engine"]);
  });
});
