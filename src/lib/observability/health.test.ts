import { describe, expect, it } from "vitest";
import { healthPayload } from "./health";

describe("Feature: health payload", () => {
  describe("Scenario: reporting health", () => {
    it("given a start time and now, reports ok with uptime in seconds and an ISO timestamp", () => {
      const startedAt = new Date("2026-10-12T14:00:00.000Z");
      const now = new Date("2026-10-12T14:01:30.000Z");
      expect(healthPayload(startedAt, now)).toEqual({
        status: "ok",
        uptime: 90,
        timestamp: "2026-10-12T14:01:30.000Z",
      });
    });
    it("given less than a second of uptime, reports 0", () => {
      const startedAt = new Date("2026-10-12T14:00:00.000Z");
      const now = new Date("2026-10-12T14:00:00.900Z");
      expect(healthPayload(startedAt, now).uptime).toBe(0);
    });
    it("given a clock that went backwards, never reports negative uptime", () => {
      const startedAt = new Date("2026-10-12T14:00:10.000Z");
      const now = new Date("2026-10-12T14:00:00.000Z");
      expect(healthPayload(startedAt, now).uptime).toBe(0);
    });
  });
});
