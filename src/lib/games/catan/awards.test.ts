import { describe, expect, it } from "vitest";
import { resolveExclusiveAward } from "./awards";
import type { CatanEvent } from "./events";
import { replay } from "./evolve";
import { awardPoints } from "./score";

const started: CatanEvent = { type: "GameStarted", players: ["ana", "ben", "cy"] };
const knight = (player: string): CatanEvent => ({ type: "KnightPlayed", player });
const road = (player: string, length: number): CatanEvent => ({
  type: "RoadLengthRecorded",
  player,
  length,
});

describe("Feature: exclusive award resolution", () => {
  describe("Scenario: nobody qualifies", () => {
    it("given nobody meets the threshold, nobody holds the award", () => {
      const holder = resolveExclusiveAward({
        incumbent: null,
        counts: { ana: 2, ben: 2 },
        threshold: 3,
      });

      expect(holder).toBeNull();
    });

    it("given no players, nobody holds the award", () => {
      expect(
        resolveExclusiveAward({ incumbent: null, counts: {}, threshold: 3 }),
      ).toBeNull();
    });
  });

  describe("Scenario: first to qualify", () => {
    it("given one player reaches the threshold, they take the award", () => {
      const holder = resolveExclusiveAward({
        incumbent: null,
        counts: { ana: 3, ben: 1 },
        threshold: 3,
      });

      expect(holder).toBe("ana");
    });

    it("given two players tie at the threshold with no incumbent, nobody holds it", () => {
      const holder = resolveExclusiveAward({
        incumbent: null,
        counts: { ana: 3, ben: 3 },
        threshold: 3,
      });

      expect(holder).toBeNull();
    });
  });

  describe("Scenario: transfers", () => {
    it("given a challenger strictly exceeds the incumbent, the award transfers", () => {
      const holder = resolveExclusiveAward({
        incumbent: "ana",
        counts: { ana: 3, ben: 4 },
        threshold: 3,
      });

      expect(holder).toBe("ben");
    });

    it("given a tie with the incumbent, the incumbent keeps the award", () => {
      const holder = resolveExclusiveAward({
        incumbent: "ana",
        counts: { ana: 3, ben: 3 },
        threshold: 3,
      });

      expect(holder).toBe("ana");
    });

    it("given two challengers tie above the incumbent, nobody holds it", () => {
      const holder = resolveExclusiveAward({
        incumbent: "ana",
        counts: { ana: 3, ben: 4, cy: 4 },
        threshold: 3,
      });

      expect(holder).toBeNull();
    });
  });

  describe("Scenario: losing the award", () => {
    it("given the incumbent falls below the threshold and nobody else qualifies, it is vacant", () => {
      const holder = resolveExclusiveAward({
        incumbent: "ana",
        counts: { ana: 4, ben: 3 },
        threshold: 5,
      });

      expect(holder).toBeNull();
    });

    it("given the incumbent falls below the threshold and another player qualifies, that player takes it", () => {
      const holder = resolveExclusiveAward({
        incumbent: "ana",
        counts: { ana: 4, ben: 5 },
        threshold: 5,
      });

      expect(holder).toBe("ben");
    });
  });
});

describe("Feature: awards inside the match state", () => {
  describe("Scenario: Largest Army", () => {
    it("given 3 knights, the player holds Largest Army", () => {
      const state = replay([started, knight("ana"), knight("ana"), knight("ana")]);

      expect(state.largestArmy).toBe("ana");
    });

    it("given 2 knights, nobody holds Largest Army", () => {
      const state = replay([started, knight("ana"), knight("ana")]);

      expect(state.largestArmy).toBeNull();
    });

    it("given another player plays a fourth knight, Largest Army transfers", () => {
      const state = replay([
        started,
        knight("ana"),
        knight("ana"),
        knight("ana"),
        knight("ben"),
        knight("ben"),
        knight("ben"),
        knight("ben"),
      ]);

      expect(state.largestArmy).toBe("ben");
    });

    it("given another player only ties, the incumbent keeps Largest Army", () => {
      const state = replay([
        started,
        knight("ana"),
        knight("ana"),
        knight("ana"),
        knight("ben"),
        knight("ben"),
        knight("ben"),
      ]);

      expect(state.largestArmy).toBe("ana");
    });
  });

  describe("Scenario: Longest Road", () => {
    it("given a road of 5, the player holds Longest Road", () => {
      const state = replay([started, road("ana", 5)]);

      expect(state.longestRoad).toBe("ana");
    });

    it("given a road of 4, nobody holds Longest Road", () => {
      const state = replay([started, road("ana", 4)]);

      expect(state.longestRoad).toBeNull();
    });

    it("given a longer road, Longest Road transfers", () => {
      const state = replay([started, road("ana", 5), road("ben", 6)]);

      expect(state.longestRoad).toBe("ben");
    });

    it("given the holder's road is split below 5, the next qualifying player takes it", () => {
      const state = replay([
        started,
        road("ana", 5),
        road("ben", 6),
        road("ben", 4),
      ]);

      expect(state.longestRoad).toBe("ana");
    });

    it("given the holder's road is split and nobody else qualifies, it is vacant", () => {
      const state = replay([started, road("ana", 5), road("ana", 3)]);

      expect(state.longestRoad).toBeNull();
    });
  });

  describe("Scenario: award points", () => {
    it("given a player holds both awards, they earn 2 + 2 bonus points", () => {
      const state = replay([
        started,
        knight("ana"),
        knight("ana"),
        knight("ana"),
        road("ana", 5),
      ]);

      expect(awardPoints(state, "ana")).toBe(4);
      expect(awardPoints(state, "ben")).toBe(0);
    });

    it("given an award transfers, the bonus points move with it", () => {
      const state = replay([started, road("ana", 5), road("ben", 6)]);

      expect(awardPoints(state, "ana")).toBe(0);
      expect(awardPoints(state, "ben")).toBe(2);
    });
  });
});
