import { describe, expect, it } from "vitest";
import { livenessPayload, readinessReport } from "./readiness";

describe("Feature: liveness", () => {
  it("given a running process, reports ok and nothing else", () => {
    expect(livenessPayload()).toEqual({ status: "ok" });
  });
});

describe("Feature: readiness", () => {
  describe("Scenario: every check passes", () => {
    it("reports ready and lists each check as ok", async () => {
      const report = await readinessReport([
        { name: "a", run: () => true },
        { name: "b", run: async () => true },
      ]);
      expect(report).toEqual({
        status: "ready",
        checks: [
          { name: "a", ok: true },
          { name: "b", ok: true },
        ],
      });
    });
    it("given no checks, is ready", async () => {
      expect(await readinessReport([])).toEqual({ status: "ready", checks: [] });
    });
  });

  describe("Scenario: a check fails", () => {
    it("given a check returning false, reports not-ready and names it", async () => {
      const report = await readinessReport([
        { name: "a", run: () => true },
        { name: "b", run: () => false },
      ]);
      expect(report.status).toBe("not-ready");
      expect(report.checks).toEqual([
        { name: "a", ok: true },
        { name: "b", ok: false },
      ]);
    });
    it("given a check that throws, counts it as failing instead of crashing", async () => {
      const report = await readinessReport([
        {
          name: "boom",
          run: () => {
            throw new Error("nope");
          },
        },
      ]);
      expect(report).toEqual({ status: "not-ready", checks: [{ name: "boom", ok: false }] });
    });
    it("given a check that rejects, counts it as failing", async () => {
      const report = await readinessReport([
        { name: "late", run: () => Promise.reject(new Error("x")) },
      ]);
      expect(report.status).toBe("not-ready");
    });
    it("given a check returning something other than true, counts it as failing", async () => {
      const report = await readinessReport([
        { name: "odd", run: () => "yes" as unknown as boolean },
      ]);
      expect(report.checks[0]?.ok).toBe(false);
    });
    it("runs every check even after one fails", async () => {
      let ran = 0;
      await readinessReport([
        { name: "a", run: () => false },
        {
          name: "b",
          run: () => {
            ran += 1;
            return true;
          },
        },
      ]);
      expect(ran).toBe(1);
    });
  });
});
