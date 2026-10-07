import { describe, expect, it } from "vitest";
import type { CatanEvent } from "./events";
import { replay } from "./evolve";
import { handle, undo } from "./history";

const started: CatanEvent = { type: "GameStarted", players: ["ana", "ben"] };

describe("Feature: undo", () => {
  describe("Scenario: dropping the last event", () => {
    it("given a log, undo returns the state before the last event", () => {
      const log: CatanEvent[] = [
        started,
        { type: "SettlementBuilt", player: "ana" },
        { type: "SettlementBuilt", player: "ana" },
      ];

      const undone = replay(undo(log));

      expect(undone).toEqual(replay(log.slice(0, 2)));
      expect(undone.players.ana?.settlements).toBe(1);
      expect(undo(log)).toHaveLength(2);
    });

    it("given an empty log, undo returns an empty log", () => {
      expect(undo([])).toEqual([]);
    });

    it("given a log, undo does not mutate it", () => {
      const log: CatanEvent[] = [started];

      undo(log);

      expect(log).toHaveLength(1);
    });
  });
});

describe("Feature: handling a command against a log", () => {
  describe("Scenario: a valid command", () => {
    it("given a log, appends the resulting events", () => {
      const result = handle([started], { type: "BuildSettlement", player: "ben" });

      expect(result).toEqual({
        ok: true,
        value: [started, { type: "SettlementBuilt", player: "ben" }],
      });
    });
  });

  describe("Scenario: an invalid command", () => {
    it("given a rule violation, returns the error and leaves the log alone", () => {
      const log: CatanEvent[] = [started];

      const result = handle(log, { type: "UpgradeSettlement", player: "ben" });

      expect(result).toMatchObject({ ok: false, error: { code: "NO_SETTLEMENT_TO_UPGRADE" } });
      expect(log).toEqual([started]);
    });
  });
});
