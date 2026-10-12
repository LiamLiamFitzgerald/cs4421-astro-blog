import { describe, expect, it } from "vitest";
import { createLogger, levelForStatus } from "./logger";

const NOW = new Date("2026-10-12T14:00:00.000Z");

function setup() {
  const lines: string[] = [];
  const logger = createLogger({ write: (line) => lines.push(line), clock: () => NOW });
  return { lines, logger };
}

describe("Feature: log level from HTTP status", () => {
  describe("Scenario: choosing a level", () => {
    it("given a 2xx or 3xx status, uses info", () => {
      expect(levelForStatus(200)).toBe("info");
      expect(levelForStatus(304)).toBe("info");
    });
    it("given a 4xx status, uses warn", () => {
      expect(levelForStatus(400)).toBe("warn");
      expect(levelForStatus(404)).toBe("warn");
    });
    it("given a 5xx status, uses error", () => {
      expect(levelForStatus(500)).toBe("error");
      expect(levelForStatus(503)).toBe("error");
    });
    it("given the boundaries 399 and 499, stays on the lower level", () => {
      expect(levelForStatus(399)).toBe("info");
      expect(levelForStatus(499)).toBe("warn");
    });
  });
});

describe("Feature: structured request logging", () => {
  describe("Scenario: logging a request", () => {
    it("given a completed request, writes one JSON line with all required fields", () => {
      const { lines, logger } = setup();
      logger.request({ route: "/api/health", method: "GET", statusCode: 200, latencyMs: 3 });
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] as string)).toEqual({
        timestamp: "2026-10-12T14:00:00.000Z",
        level: "info",
        route: "/api/health",
        method: "GET",
        statusCode: 200,
        latencyMs: 3,
      });
    });
    it("given a failing request, logs at error level", () => {
      const { lines, logger } = setup();
      logger.request({ route: "/x", method: "POST", statusCode: 500, latencyMs: 12 });
      expect(JSON.parse(lines[0] as string).level).toBe("error");
    });
    it("given a fractional latency, rounds it to whole milliseconds", () => {
      const { lines, logger } = setup();
      logger.request({ route: "/", method: "GET", statusCode: 200, latencyMs: 2.6 });
      expect(JSON.parse(lines[0] as string).latencyMs).toBe(3);
    });
  });

  describe("Scenario: logging a message", () => {
    it("given a level, message and fields, writes them with a timestamp", () => {
      const { lines, logger } = setup();
      logger.log("warn", "slow query", { gameId: "g1" });
      expect(JSON.parse(lines[0] as string)).toEqual({
        timestamp: "2026-10-12T14:00:00.000Z",
        level: "warn",
        message: "slow query",
        gameId: "g1",
      });
    });
    it("given fields that clash with reserved keys, the reserved keys win", () => {
      const { lines, logger } = setup();
      logger.log("info", "real", { message: "fake", level: "error", timestamp: "x" });
      const entry = JSON.parse(lines[0] as string);
      expect(entry.message).toBe("real");
      expect(entry.level).toBe("info");
      expect(entry.timestamp).toBe("2026-10-12T14:00:00.000Z");
    });
  });
});
