import { describe, expect, it } from "vitest";
import { generateBoard } from "../games/catan/board";
import { hand } from "../games/catan-play/resources";
import { initialPlayState } from "../games/catan-play/state";
import { TOPOLOGY } from "../games/catan-play/topology";
import {
  describeCorner,
  describeEdge,
  describeHand,
  describePlayEvent,
  describePlayViolation,
  describeRoll,
  describeStep,
  tradeableResources,
} from "./play-view";

const board = generateBoard(42);

describe("Feature: words for the play mode", () => {
  it.each([
    [hand({}), "nothing"],
    [hand({ ore: 2 }), "2 ore"],
    [hand({ lumber: 1, grain: 2 }), "1 lumber and 2 grain"],
    [hand({ lumber: 1, brick: 1, wool: 3 }), "1 lumber, 1 brick and 3 wool"],
  ])("describes hand %j as %s", (h, text) => expect(describeHand(h)).toBe(text));

  it("gives an instruction for every step", () => {
    for (const step of ["place-settlement", "place-road", "roll", "build-or-end"] as const) {
      expect(describeStep(step)).toMatch(/\.$/);
    }
    expect(describeStep("roll")).toBe("Roll the dice to start the turn.");
  });

  it("explains refusals in plain English", () => {
    expect(describePlayViolation({ code: "NOT_YOUR_TURN", player: "ben", current: "ana" })).toBe("It is ana's turn, not ben's.");
    expect(describePlayViolation({ code: "CANNOT_AFFORD", piece: "city", missing: hand({ ore: 1, grain: 2 }) })).toBe(
      "You need 2 grain and 1 ore more to build a city.",
    );
    expect(describePlayViolation({ code: "WRONG_STEP", expected: "roll" })).toBe("Not now. Roll the dice to start the turn.");
    expect(describePlayViolation({ code: "TOO_CLOSE_TO_SETTLEMENT" })).toContain("two roads apart");
    expect(describePlayViolation({ code: "INVALID_TRADE", reason: "same-resource" })).toBe("Choose two different resources.");
    expect(describePlayViolation({ code: "NOT_ENOUGH_TO_TRADE", give: "wool", needed: 4 })).toBe("You need 4 wool to trade with the bank.");
  });

  it("names a corner by the hexes around it", () => {
    const centre = TOPOLOGY.hexCorners["0,0"]?.[0] ?? 0;
    const text = describeCorner(board, centre);
    expect(text.split(", ")).toHaveLength(3);
  });

  it("names a coastal edge by its one hex", () => {
    const coastal = TOPOLOGY.edges.find((e) => {
      const [a, b] = e.ends;
      return (TOPOLOGY.vertices[a]?.hexes ?? []).filter((h) => TOPOLOGY.vertices[b]?.hexes.includes(h)).length === 1;
    });
    expect(describeEdge(board, coastal?.id ?? 0)).toMatch(/^along the coast by /);
  });

  it("names an inland edge by the two hexes it separates", () => {
    const inland = TOPOLOGY.edges.find((e) => {
      const [a, b] = e.ends;
      return (TOPOLOGY.vertices[a]?.hexes ?? []).filter((h) => TOPOLOGY.vertices[b]?.hexes.includes(h)).length === 2;
    });
    expect(describeEdge(board, inland?.id ?? 0)).toMatch(/^between .+ and .+$/);
  });

  it("summarises a roll", () => {
    const roll = { player: "ana", dice: [3, 5] as const, total: 8, produced: { ana: hand({ grain: 1 }), ben: hand({}) }, shortages: [] };
    expect(describeRoll(roll, ["ana", "ben"])).toBe("Rolled 8. ana gets 1 grain.");
    expect(describeRoll({ ...roll, produced: { ana: hand({}), ben: hand({}) } }, ["ana", "ben"])).toBe("Rolled 8. Nobody collects anything.");
    expect(describeRoll({ ...roll, total: 7 }, ["ana", "ben"])).toContain("Nothing is produced on a 7");
    expect(describeRoll({ ...roll, shortages: ["ore"] }, ["ana", "ben"])).toContain("The bank ran short of ore.");
  });

  it("describes events for the log", () => {
    const state = { ...initialPlayState, board };
    expect(describePlayEvent({ type: "BankTraded", player: "ana", give: "wool", get: "ore" }, state)).toBe("ana traded 4 wool for 1 ore");
    expect(describePlayEvent({ type: "DiceRolled", player: "ben", dice: [2, 4] }, state)).toBe("ben rolled 6");
    expect(describePlayEvent({ type: "SettlementBuilt", player: "ana", vertex: 0 }, state)).toMatch(/^ana built a settlement at /);
  });

  it("offers only resources with at least four cards for trade", () => {
    expect(tradeableResources(hand({ wool: 4, ore: 3, grain: 7 }))).toEqual(["wool", "grain"]);
  });
});
