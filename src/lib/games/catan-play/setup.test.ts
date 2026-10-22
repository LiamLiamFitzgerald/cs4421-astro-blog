import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generateBoard } from "../catan/board";
import { shuffledDeck } from "./dev-cards";
import { dealHarbours } from "./harbours";
import { decide } from "./decide";
import type { PlayEvent } from "./events";
import { replayPlay } from "./evolve";
import {
  currentPlayer,
  expectedStep,
  legalSetupRoads,
  legalSetupSettlements,
  snakeOrder,
} from "./queries";
import { BANK_START, handSize, PRODUCES, RESOURCES } from "./resources";
import { completeSetup, play } from "./test-helpers";
import { TOPOLOGY } from "./topology";

const started = (players = ["ana", "ben", "cy"], seed = 1) =>
  play([{ type: "StartGame", players, seed }]);

const when = (log: readonly PlayEvent[], command: Parameters<typeof decide>[1]) => decide(replayPlay(log), command);

/** A corner that is legal for the first settlement, and one of its neighbours. */
const corner = TOPOLOGY.vertices.find((v) => v.hexes.length === 3) ?? TOPOLOGY.vertices[0];
const firstCorner = corner?.id ?? 0;
const nextToFirst = corner?.neighbours[0] ?? 0;

describe("Feature: starting a played game", () => {
  it("given players and a seed, GameStarted carries the dealt board", () => {
    expect(when([], { type: "StartGame", players: ["ana", "ben"], seed: 9 })).toEqual({
      ok: true,
      value: [{ type: "GameStarted", players: ["ana", "ben"], board: generateBoard(9), deck: shuffledDeck(9), harbours: dealHarbours(9) }],
    });
  });

  it("given one player, the start is refused with the scoring module's reason", () => {
    expect(when([], { type: "StartGame", players: ["ana"], seed: 1 })).toEqual({
      ok: false,
      error: { code: "INVALID_PLAYERS", reason: "a game needs 2 to 6 players" },
    });
  });

  it("given a bad seed, the start is refused", () => {
    expect(when([], { type: "StartGame", players: ["ana", "ben"], seed: -1 })).toEqual({
      ok: false,
      error: { code: "INVALID_SEED", seed: -1 },
    });
  });

  it("given a started game, starting again is refused", () => {
    expect(when(started(), { type: "StartGame", players: ["x", "y"], seed: 1 })).toEqual({
      ok: false,
      error: { code: "GAME_ALREADY_STARTED" },
    });
  });

  it("given a second GameStarted event, it is ignored", () => {
    const log = [...started(), ...started(["x", "y"], 2)];
    expect(replayPlay(log).players).toEqual(["ana", "ben", "cy"]);
  });

  it("given a started game, player 1 places a settlement first, with empty hands and a full bank", () => {
    const state = replayPlay(started());
    expect(currentPlayer(state)).toBe("ana");
    expect(expectedStep(state)).toBe("place-settlement");
    expect(state.hands.ben).toEqual({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
    expect(state.bank).toEqual(BANK_START);
  });

  it("given no game, any move is refused", () => {
    expect(when([], { type: "PlaceSetupSettlement", player: "ana", vertex: 0 })).toEqual({
      ok: false,
      error: { code: "GAME_NOT_STARTED" },
    });
  });

  it("before the start there is no current player or step", () => {
    expect(currentPlayer(replayPlay([]))).toBeNull();
    expect(expectedStep(replayPlay([]))).toBeNull();
  });
});

describe("Feature: snake order", () => {
  it.each([
    [2, [0, 1, 1, 0]],
    [3, [0, 1, 2, 2, 1, 0]],
    [4, [0, 1, 2, 3, 3, 2, 1, 0]],
  ])("for %i players the order is %j", (n, order) => {
    expect(snakeOrder(n)).toEqual(order);
  });

  it("given a full setup, seats act in snake order and play starts with player 1 rolling", () => {
    const log = completeSetup(started());
    const placers = log.filter((e) => e.type === "SetupSettlementPlaced").map((e) => ("player" in e ? e.player : ""));
    expect(placers).toEqual(["ana", "ben", "cy", "cy", "ben", "ana"]);
    const state = replayPlay(log);
    expect(state.phase).toBe("roll");
    expect(currentPlayer(state)).toBe("ana");
    expect(expectedStep(state)).toBe("roll");
  });
});

describe("Feature: placing a setup settlement", () => {
  it("given an open corner, the settlement is placed and a road is expected next", () => {
    const log = play([{ type: "PlaceSetupSettlement", player: "ana", vertex: firstCorner }], started());
    const state = replayPlay(log);
    expect(state.buildings[firstCorner]).toEqual({ player: "ana", kind: "settlement" });
    expect(expectedStep(state)).toBe("place-road");
  });

  it("given it is another player's turn, the move is refused and says whose turn it is", () => {
    expect(when(started(), { type: "PlaceSetupSettlement", player: "ben", vertex: firstCorner })).toEqual({
      ok: false,
      error: { code: "NOT_YOUR_TURN", player: "ben", current: "ana" },
    });
  });

  it("given a road is expected, no corners are offered; given a settlement is expected, no roads are", () => {
    const log = play([{ type: "PlaceSetupSettlement", player: "ana", vertex: firstCorner }], started());
    expect(legalSetupSettlements(replayPlay(log))).toEqual([]);
    expect(legalSetupRoads(replayPlay(started()))).toEqual([]);
  });

  it("given a road is expected, another settlement is refused", () => {
    const log = play([{ type: "PlaceSetupSettlement", player: "ana", vertex: firstCorner }], started());
    expect(when(log, { type: "PlaceSetupSettlement", player: "ana", vertex: 0 })).toEqual({
      ok: false,
      error: { code: "WRONG_STEP", expected: "place-road" },
    });
  });

  it.each([-1, 54, 1.5])("given corner %d, which does not exist, it is refused", (vertex) => {
    expect(when(started(), { type: "PlaceSetupSettlement", player: "ana", vertex })).toEqual({
      ok: false,
      error: { code: "UNKNOWN_SPOT" },
    });
  });

  describe("given ana has placed on a corner", () => {
    const afterAna = () =>
      play(
        [
          { type: "PlaceSetupSettlement", player: "ana", vertex: firstCorner },
          { type: "PlaceSetupRoad", player: "ana", edge: TOPOLOGY.vertices[firstCorner]?.edges[0] ?? 0 },
        ],
        started(),
      );

    it("the same corner is refused as taken", () => {
      expect(when(afterAna(), { type: "PlaceSetupSettlement", player: "ben", vertex: firstCorner })).toEqual({
        ok: false,
        error: { code: "SPOT_TAKEN" },
      });
    });

    it("a neighbouring corner is refused by the distance rule", () => {
      expect(when(afterAna(), { type: "PlaceSetupSettlement", player: "ben", vertex: nextToFirst })).toEqual({
        ok: false,
        error: { code: "TOO_CLOSE_TO_SETTLEMENT" },
      });
    });

    it("neither corner is offered as legal", () => {
      const legal = legalSetupSettlements(replayPlay(afterAna()));
      expect(legal).not.toContain(firstCorner);
      expect(legal).not.toContain(nextToFirst);
      expect(legal.length).toBeGreaterThan(40);
    });
  });
});

describe("Feature: placing a setup road", () => {
  const withSettlement = () => play([{ type: "PlaceSetupSettlement", player: "ana", vertex: firstCorner }], started());

  it("given a settlement just placed, only the roads touching it are offered", () => {
    expect(legalSetupRoads(replayPlay(withSettlement())).sort()).toEqual(
      [...(TOPOLOGY.vertices[firstCorner]?.edges ?? [])].sort(),
    );
  });

  it("given a road touching it, the road is placed and the next player is up", () => {
    const edge = TOPOLOGY.vertices[firstCorner]?.edges[0] ?? 0;
    const state = replayPlay(play([{ type: "PlaceSetupRoad", player: "ana", edge }], withSettlement()));
    expect(state.roads[edge]).toBe("ana");
    expect(currentPlayer(state)).toBe("ben");
    expect(expectedStep(state)).toBe("place-settlement");
  });

  it("given a road elsewhere, it is refused", () => {
    const far = TOPOLOGY.edges.find((e) => !e.ends.includes(firstCorner))?.id ?? 0;
    expect(when(withSettlement(), { type: "PlaceSetupRoad", player: "ana", edge: far })).toEqual({
      ok: false,
      error: { code: "ROAD_NOT_BESIDE_NEW_SETTLEMENT" },
    });
  });

  it("given an edge that does not exist, it is refused", () => {
    expect(when(withSettlement(), { type: "PlaceSetupRoad", player: "ana", edge: 72 })).toEqual({
      ok: false,
      error: { code: "UNKNOWN_SPOT" },
    });
  });

  it("given a settlement is expected, a road is refused", () => {
    expect(when(started(), { type: "PlaceSetupRoad", player: "ana", edge: 0 })).toEqual({
      ok: false,
      error: { code: "WRONG_STEP", expected: "place-settlement" },
    });
  });

  it("given any completed setup, no setup road ever lands on an existing road (property of the distance rule)", () => {
    const log = completeSetup(started(["ana", "ben", "cy", "di"], 3));
    const roads = log.filter((e) => e.type === "SetupRoadPlaced").map((e) => ("edge" in e ? e.edge : -1));
    expect(new Set(roads).size).toBe(roads.length);
  });
});

describe("Feature: starting resources", () => {
  it("given the first round, settlements give nothing", () => {
    const log = play([{ type: "PlaceSetupSettlement", player: "ana", vertex: firstCorner }], started());
    expect(handSize(replayPlay(log).hands.ana ?? BANK_START)).toBe(0);
  });

  it("given each player's second settlement, they receive one resource per producing hex it touches", () => {
    const log = completeSetup(started(["ana", "ben"], 5));
    const state = replayPlay(log);
    const board = state.board;
    const second = (player: string) =>
      log.filter((e) => e.type === "SetupSettlementPlaced" && e.player === player).at(-1);
    for (const player of ["ana", "ben"]) {
      const placed = second(player);
      const vertex = placed && "vertex" in placed ? placed.vertex : -1;
      const touching = new Set(TOPOLOGY.vertices[vertex]?.hexes);
      const expected = board?.hexes.filter((h) => touching.has(`${h.q},${h.r}`) && PRODUCES[h.terrain]).length;
      expect(handSize(state.hands[player] ?? BANK_START)).toBe(expected);
    }
  });

  it("given resources handed out, the bank pays for them", () => {
    const state = replayPlay(completeSetup(started()));
    for (const r of RESOURCES) {
      const held = state.players.reduce((n, p) => n + (state.hands[p]?.[r] ?? 0), 0);
      expect(state.bank[r] + held).toBe(19);
    }
  });
});

describe("Feature: every setup is legal (property)", () => {
  it("any sequence of legal picks ends with two settlements and two roads each, all apart", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),
        fc.integer({ min: 0, max: 1000 }),
        fc.array(fc.nat(), { minLength: 12, maxLength: 12 }),
        (n, seed, picks) => {
          const players = Array.from({ length: n }, (_, i) => `p${i}`);
          const log = completeSetup(started(players, seed), (count, turn) => (picks[turn % picks.length] ?? 0) % count);
          const state = replayPlay(log);
          expect(state.phase).toBe("roll");
          for (const p of players) {
            expect(Object.values(state.buildings).filter((b) => b.player === p)).toHaveLength(2);
            expect(Object.values(state.roads).filter((owner) => owner === p)).toHaveLength(2);
          }
          for (const v of Object.keys(state.buildings).map(Number)) {
            for (const n2 of TOPOLOGY.vertices[v]?.neighbours ?? []) expect(state.buildings[n2]).toBeUndefined();
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
