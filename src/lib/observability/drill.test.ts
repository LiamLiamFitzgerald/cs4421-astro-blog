import { describe, expect, it } from "vitest";
import { DRILL_MODE, drillFailsRequest } from "./drill";

describe("Feature: rollback drill fault injection", () => {
  it("given no drill, nothing fails", () => {
    expect(drillFailsRequest("/catan", undefined)).toBe(false);
    expect(drillFailsRequest("/", "")).toBe(false);
  });

  it("given any other value, nothing fails", () => {
    expect(drillFailsRequest("/catan", "true")).toBe(false);
    expect(drillFailsRequest("/catan", "FAIL-REQUESTS")).toBe(false);
  });

  it("given the drill, pages and the API fail", () => {
    expect(DRILL_MODE).toBe("fail-requests");
    for (const path of ["/", "/catan", "/about", "/api/client-errors"]) {
      expect(drillFailsRequest(path, DRILL_MODE)).toBe(true);
    }
  });

  it("given the drill, the probes stay healthy so the release still takes canary traffic", () => {
    for (const path of ["/api/live", "/api/ready", "/api/health"]) {
      expect(drillFailsRequest(path, DRILL_MODE)).toBe(false);
    }
  });
});
