import { describe, expect, it } from "vitest";
import { replayPlay } from "../games/catan-play/evolve";
import type { PlayState } from "../games/catan-play/state";
import { completeSetup, play } from "../games/catan-play/test-helpers";
import { describeEffect, detectEffects, type PlayEffect, ranking } from "./play-effects";

const base = (): PlayState => replayPlay(completeSetup(play([{ type: "StartGame", players: ["Ana", "Ben", "Cy"], seed: 4 }])));
const seen = (state: PlayState, history: string[] = []) => ({ state, history });

describe("Feature: spotting the big moments", () => {
  it("given the first view of a game, celebrates nothing", () => {
    expect(detectEffects(null, seen(base()))).toEqual([]);
    expect(detectEffects(seen(replayPlay([])), seen(base()))).toEqual([]);
  });

  it("given nothing changed, celebrates nothing", () => {
    const s = base();
    expect(detectEffects(seen(s), seen(s))).toEqual([]);
  });

  it("given a win, says who won first", () => {
    const s = base();
    expect(detectEffects(seen(s), seen({ ...s, winner: "Ben" }))[0]).toEqual({ kind: "win", player: "Ben" });
  });

  it("given a new steal in the log, names the thief and the victim", () => {
    const s = base();
    expect(detectEffects(seen(s, ["a"]), seen(s, ["a", "Ana stole a card from Ben"]))).toEqual([{ kind: "stolen", thief: "Ana", victim: "Ben" }]);
  });

  it("given an old steal already shown, does not repeat it", () => {
    const s = base();
    expect(detectEffects(seen(s, ["Ana stole a card from Ben"]), seen(s, ["Ana stole a card from Ben", "Ben ended their turn"]))).toEqual([]);
  });

  it("given the robber moved after setup, shakes things up", () => {
    const s = base();
    expect(detectEffects(seen(s), seen({ ...s, robber: "9,9" }))).toContainEqual({ kind: "robber" });
  });

  it("given a 7 rolled, says so; a 7 already shown does not repeat", () => {
    const s = base();
    const seven = { ...s, lastRoll: { player: "Ana", dice: [3, 4] as const, total: 7, produced: {}, shortages: [] } };
    expect(detectEffects(seen(s), seen(seven))).toContainEqual({ kind: "seven" });
    expect(detectEffects(seen(seven), seen(seven))).toEqual([]);
    const eight = { ...s, lastRoll: { ...seven.lastRoll, dice: [4, 4] as const, total: 8 } };
    expect(detectEffects(seen(s), seen(eight))).toEqual([]);
  });

  it("given a new settlement or a city, celebrates the build", () => {
    const s = base();
    const settled = { ...s, buildings: { ...s.buildings, 99: { player: "Cy", kind: "settlement" as const } } };
    // A settlement is a point, so Cy also takes the lead; the build comes last.
    expect(detectEffects(seen(s), seen(settled))).toEqual([
      { kind: "lead", player: "Cy" },
      { kind: "settlement", player: "Cy", vertex: 99 },
    ]);
    const upgraded = { ...settled, buildings: { ...settled.buildings, 99: { player: "Cy", kind: "city" as const } } };
    expect(detectEffects(seen(settled), seen(upgraded))).toContainEqual({ kind: "city", player: "Cy", vertex: 99 });
  });

  it("given an award changing hands, names the new holder", () => {
    const s = base();
    expect(detectEffects(seen(s), seen({ ...s, longestRoad: "Ben" }))).toContainEqual({ kind: "award", award: "longest-road", player: "Ben" });
    expect(detectEffects(seen(s), seen({ ...s, largestArmy: "Cy" }))).toContainEqual({ kind: "award", award: "largest-army", player: "Cy" });
    expect(detectEffects(seen({ ...s, largestArmy: "Cy" }), seen({ ...s, largestArmy: "Cy" }))).toEqual([]);
  });

  it("given a new outright leader after setup, says who leads; a tie leads nobody", () => {
    const s = base(); // everyone has 2 points: tied
    const ahead = { ...s, longestRoad: "Ben" }; // +2 for Ben
    expect(detectEffects(seen(s), seen(ahead))).toContainEqual({ kind: "lead", player: "Ben" });
    expect(detectEffects(seen(ahead), seen({ ...ahead }))).toEqual([]);
  });

  it("orders the moments so the most important comes first, builds last", () => {
    const s = base();
    const after = {
      ...s,
      robber: "9,9",
      winner: "Ana",
      buildings: { ...s.buildings, 99: { player: "Ana", kind: "settlement" as const } },
    };
    const kinds = detectEffects(seen(s), seen(after)).map((e) => e.kind);
    expect(kinds[0]).toBe("win");
    expect(kinds.at(-1)).toBe("settlement");
  });
});

describe("Feature: words for the banners", () => {
  it.each([
    [{ kind: "win", player: "Ana" }, "Ana wins!", "crown"],
    [{ kind: "stolen", thief: "Ana", victim: "Ben" }, "Ana robbed Ben!", "knight"],
    [{ kind: "robber" }, "The robber moves!", "knight"],
    [{ kind: "seven" }, "Seven! Robber time", "dice"],
    [{ kind: "city", player: "Cy", vertex: 1 }, "Cy built a city!", "city"],
    [{ kind: "award", award: "longest-road", player: "Ben" }, "Longest Road: Ben", "trophy"],
    [{ kind: "award", award: "largest-army", player: "Ben" }, "Largest Army: Ben", "army"],
    [{ kind: "lead", player: "Ana" }, "Ana takes the lead!", "crown"],
    [{ kind: "settlement", player: "Ana", vertex: 1 }, "Ana settled", "settlement"],
  ] as [PlayEffect, string, string][])("describes %j", (effect, text, icon) => {
    expect(describeEffect(effect)).toEqual({ text, icon });
  });
});

describe("Feature: the leaderboard order", () => {
  it("ranks by points, keeping seat order for ties, with shared ranks", () => {
    const s = { ...base(), longestRoad: "Cy" };
    expect(ranking(s)).toEqual([
      { player: "Cy", points: 4, rank: 1 },
      { player: "Ana", points: 2, rank: 2 },
      { player: "Ben", points: 2, rank: 2 },
    ]);
  });

  it("given an empty game, ranks nobody", () => {
    expect(ranking(replayPlay([]))).toEqual([]);
  });
});
