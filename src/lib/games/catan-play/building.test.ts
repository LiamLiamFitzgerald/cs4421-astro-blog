import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decide } from "./decide";
import type { PlayCommand } from "./commands";
import { evolve, replayPlay } from "./evolve";
import {
  buildOptions,
  currentPlayer,
  legalCities,
  legalRoads,
  legalSettlements,
  longestRoadLength,
  piecesLeft,
  points,
} from "./queries";
import { COSTS, emptyHand, hand, handSize, PIECE_LIMITS, RESOURCES, type Hand } from "./resources";
import type { PlayState } from "./state";
import { completeSetup, play } from "./test-helpers";
import { TOPOLOGY, type EdgeId, type VertexId } from "./topology";

const rich = hand({ lumber: 10, brick: 10, wool: 10, grain: 10, ore: 10 });

/** After setup, ana has rolled and holds `cards`. */
function anaToBuild(cards: Hand = rich, players = ["ana", "ben"]): PlayState {
  const log = play(
    [{ type: "RollDice", player: "ana", dice: [1, 1] }],
    completeSetup(play([{ type: "StartGame", players, seed: 21 }])),
  );
  const state = replayPlay(log);
  return { ...state, hands: { ...state.hands, ana: cards } };
}

/** Applies commands to a state, failing on the first refusal. */
function apply(state: PlayState, ...commands: PlayCommand[]): PlayState {
  return commands.reduce((s, command) => {
    const result = decide(s, command);
    if (!result.ok) throw new Error(`${command.type} refused: ${JSON.stringify(result.error)}`);
    return result.value.reduce(evolve, s);
  }, state);
}

const firstLegalRoad = (s: PlayState) => legalRoads(s, "ana")[0] ?? -1;

describe("Feature: building a road", () => {
  it("given lumber and brick, a connected road is built and paid for", () => {
    const state = anaToBuild();
    const edge = firstLegalRoad(state);
    const next = apply(state, { type: "BuildRoad", player: "ana", edge });
    expect(next.roads[edge]).toBe("ana");
    expect(next.hands.ana).toEqual(hand({ lumber: 9, brick: 9, wool: 10, grain: 10, ore: 10 }));
    expect(next.bank.lumber).toBe(state.bank.lumber + 1);
  });

  it("given no brick, the road is refused with what is missing", () => {
    const state = anaToBuild(hand({ lumber: 1 }));
    expect(decide(state, { type: "BuildRoad", player: "ana", edge: firstLegalRoad(state) })).toEqual({
      ok: false,
      error: { code: "CANNOT_AFFORD", piece: "road", missing: hand({ brick: 1 }) },
    });
  });

  it("given an edge away from ana's pieces, it is refused as not connected", () => {
    const state = anaToBuild();
    const reachable = new Set(legalRoads(state, "ana"));
    const far = TOPOLOGY.edges.find((e) => state.roads[e.id] === undefined && !reachable.has(e.id))?.id ?? -1;
    expect(decide(state, { type: "BuildRoad", player: "ana", edge: far })).toEqual({
      ok: false,
      error: { code: "ROAD_NOT_CONNECTED" },
    });
  });

  it("given an edge with a road, it is refused as taken", () => {
    const state = anaToBuild();
    const taken = Number(Object.keys(state.roads)[0]);
    expect(decide(state, { type: "BuildRoad", player: "ana", edge: taken })).toEqual({
      ok: false,
      error: { code: "SPOT_TAKEN" },
    });
  });

  it("given an edge that does not exist, it is refused", () => {
    expect(decide(anaToBuild(), { type: "BuildRoad", player: "ana", edge: 999 })).toEqual({
      ok: false,
      error: { code: "UNKNOWN_SPOT" },
    });
  });

  it("given the dice have not been rolled, building is refused", () => {
    const log = completeSetup(play([{ type: "StartGame", players: ["ana", "ben"], seed: 21 }]));
    expect(decide(replayPlay(log), { type: "BuildRoad", player: "ana", edge: 0 })).toEqual({
      ok: false,
      error: { code: "WRONG_STEP", expected: "roll" },
    });
  });

  it("given all 15 roads are on the board, another is refused", () => {
    let state = anaToBuild(hand({ lumber: 30, brick: 30 }));
    while (piecesLeft(state, "ana").road > 0 && legalRoads(state, "ana").length > 0) {
      state = apply(state, { type: "BuildRoad", player: "ana", edge: firstLegalRoad(state) });
    }
    expect(piecesLeft(state, "ana").road).toBe(0);
    expect(decide(state, { type: "BuildRoad", player: "ana", edge: firstLegalRoad(state) })).toMatchObject({
      ok: false,
      error: { code: "NO_PIECES_LEFT", piece: "road" },
    });
  });

  it("a road cannot continue through an opponent's settlement", () => {
    // Build a hand-made position: ana's road ends at a corner holding ben's settlement.
    const base = anaToBuild();
    const corner = TOPOLOGY.vertices.find((v) => v.edges.length === 3 && !base.buildings[v.id] && v.neighbours.every((n) => !base.buildings[n]) && v.edges.every((e) => base.roads[e] === undefined));
    const [into, beyond] = corner?.edges ?? [];
    const state: PlayState = {
      ...base,
      roads: { ...base.roads, [into ?? 0]: "ana" },
      buildings: { ...base.buildings, [corner?.id ?? 0]: { player: "ben", kind: "settlement" } },
    };
    expect(legalRoads(state, "ana")).not.toContain(beyond);
  });
});

describe("Feature: building a settlement", () => {
  /** Ana with two extra roads, so a corner two steps from her settlement is reachable. */
  function withReach(): { state: PlayState; corner: VertexId } {
    let state = anaToBuild();
    for (let i = 0; i < 6; i++) {
      const corner = legalSettlements(state, "ana")[0];
      if (corner !== undefined) return { state, corner };
      state = apply(state, { type: "BuildRoad", player: "ana", edge: firstLegalRoad(state) });
    }
    throw new Error("no reachable corner");
  }

  it("given a free corner on ana's road, the settlement is built and paid for", () => {
    const { state, corner } = withReach();
    const next = apply(state, { type: "BuildSettlement", player: "ana", vertex: corner });
    expect(next.buildings[corner]).toEqual({ player: "ana", kind: "settlement" });
    expect(handSize(next.hands.ana ?? emptyHand)).toBe(handSize(state.hands.ana ?? emptyHand) - 4);
    expect(points(next, "ana")).toBe(points(state, "ana") + 1);
  });

  it("given a corner not on ana's road, it is refused", () => {
    const state = anaToBuild();
    const lonely = TOPOLOGY.vertices.find(
      (v) => !state.buildings[v.id] && v.neighbours.every((n) => !state.buildings[n]) && v.edges.every((e) => state.roads[e] !== "ana"),
    );
    expect(decide(state, { type: "BuildSettlement", player: "ana", vertex: lonely?.id ?? -1 })).toEqual({
      ok: false,
      error: { code: "SETTLEMENT_NOT_ON_ROAD" },
    });
  });

  it("given a corner next to a settlement, it is refused by the distance rule", () => {
    const state = anaToBuild();
    const own = Number(Object.keys(state.buildings)[0]);
    const near = TOPOLOGY.vertices[own]?.neighbours[0] ?? -1;
    expect(decide(state, { type: "BuildSettlement", player: "ana", vertex: near })).toEqual({
      ok: false,
      error: { code: "TOO_CLOSE_TO_SETTLEMENT" },
    });
  });

  it("given a taken corner, it is refused", () => {
    const state = anaToBuild();
    expect(decide(state, { type: "BuildSettlement", player: "ana", vertex: Number(Object.keys(state.buildings)[0]) })).toEqual({
      ok: false,
      error: { code: "SPOT_TAKEN" },
    });
  });

  it("given a corner that does not exist, it is refused", () => {
    expect(decide(anaToBuild(), { type: "BuildSettlement", player: "ana", vertex: -2 })).toEqual({
      ok: false,
      error: { code: "UNKNOWN_SPOT" },
    });
  });

  it("given no wool or grain, it is refused with what is missing", () => {
    const { state, corner } = withReach();
    const poor = { ...state, hands: { ...state.hands, ana: hand({ lumber: 1, brick: 1 }) } };
    expect(decide(poor, { type: "BuildSettlement", player: "ana", vertex: corner })).toEqual({
      ok: false,
      error: { code: "CANNOT_AFFORD", piece: "settlement", missing: hand({ wool: 1, grain: 1 }) },
    });
  });

  it("given 5 settlements on the board, another is refused", () => {
    const { state, corner } = withReach();
    const fake: Record<number, { player: string; kind: "settlement" }> = {};
    const far = TOPOLOGY.vertices.filter((v) => !state.buildings[v.id]).slice(-3);
    for (const v of far) fake[v.id] = { player: "ana", kind: "settlement" };
    const full = { ...state, buildings: { ...state.buildings, ...fake } };
    expect(piecesLeft(full, "ana").settlement).toBe(0);
    expect(decide(full, { type: "BuildSettlement", player: "ana", vertex: corner })).toMatchObject({
      ok: false,
      error: { code: "NO_PIECES_LEFT", piece: "settlement" },
    });
  });
});

describe("Feature: building a city", () => {
  it("given ana's settlement and 3 ore + 2 grain, it becomes a city and returns a settlement to her supply", () => {
    const state = anaToBuild();
    const own = legalCities(state, "ana")[0] ?? -1;
    const next = apply(state, { type: "BuildCity", player: "ana", vertex: own });
    expect(next.buildings[own]).toEqual({ player: "ana", kind: "city" });
    expect(next.hands.ana).toEqual(hand({ lumber: 10, brick: 10, wool: 10, grain: 8, ore: 7 }));
    expect(piecesLeft(next, "ana")).toMatchObject({ settlement: PIECE_LIMITS.settlement - 1, city: PIECE_LIMITS.city - 1 });
    expect(points(next, "ana")).toBe(points(state, "ana") + 1);
    expect(legalCities(next, "ana")).not.toContain(own);
  });

  it("given ben's settlement, ana cannot upgrade it", () => {
    const state = anaToBuild();
    const bens = legalCities(state, "ben")[0] ?? -1;
    expect(decide(state, { type: "BuildCity", player: "ana", vertex: bens })).toEqual({
      ok: false,
      error: { code: "NOT_YOUR_SETTLEMENT" },
    });
  });

  it("given an empty corner or an existing city, it is refused", () => {
    const state = anaToBuild();
    const own = legalCities(state, "ana")[0] ?? -1;
    const city = apply(state, { type: "BuildCity", player: "ana", vertex: own });
    expect(decide(city, { type: "BuildCity", player: "ana", vertex: own })).toMatchObject({ error: { code: "NOT_YOUR_SETTLEMENT" } });
    const empty = TOPOLOGY.vertices.find((v) => !state.buildings[v.id])?.id ?? -1;
    expect(decide(state, { type: "BuildCity", player: "ana", vertex: empty })).toMatchObject({ error: { code: "NOT_YOUR_SETTLEMENT" } });
  });

  it("given 2 ore, it is refused with what is missing", () => {
    const state = anaToBuild(hand({ grain: 2, ore: 2 }));
    expect(decide(state, { type: "BuildCity", player: "ana", vertex: legalCities(state, "ana")[0] ?? -1 })).toEqual({
      ok: false,
      error: { code: "CANNOT_AFFORD", piece: "city", missing: hand({ ore: 1 }) },
    });
  });

  it("given 4 cities already, another is refused", () => {
    const state = anaToBuild();
    const spare = TOPOLOGY.vertices.filter((v) => !state.buildings[v.id]).slice(-4);
    const cities = Object.fromEntries(spare.map((v) => [v.id, { player: "ana", kind: "city" as const }]));
    const full = { ...state, buildings: { ...state.buildings, ...cities } };
    expect(decide(full, { type: "BuildCity", player: "ana", vertex: legalCities(full, "ana")[0] ?? -1 })).toEqual({
      ok: false,
      error: { code: "NO_PIECES_LEFT", piece: "city" },
    });
  });
});

describe("Feature: trading with the bank", () => {
  it("given 4 of a resource, they are traded for 1 of another", () => {
    const state = anaToBuild(hand({ wool: 5 }));
    const next = apply(state, { type: "TradeWithBank", player: "ana", give: "wool", get: "ore" });
    expect(next.hands.ana).toEqual(hand({ wool: 1, ore: 1 }));
    expect(next.bank.wool).toBe(state.bank.wool + 4);
    expect(next.bank.ore).toBe(state.bank.ore - 1);
  });

  it("given 3 of a resource, the trade is refused with how many are needed", () => {
    expect(decide(anaToBuild(hand({ wool: 3 })), { type: "TradeWithBank", player: "ana", give: "wool", get: "ore" })).toEqual({
      ok: false,
      error: { code: "NOT_ENOUGH_TO_TRADE", give: "wool", needed: 4 },
    });
  });

  it("given the same resource on both sides, it is refused", () => {
    expect(decide(anaToBuild(), { type: "TradeWithBank", player: "ana", give: "ore", get: "ore" })).toEqual({
      ok: false,
      error: { code: "INVALID_TRADE", reason: "same-resource" },
    });
  });

  it("given an unknown resource, it is refused", () => {
    const command = { type: "TradeWithBank", player: "ana", give: "gold", get: "ore" } as unknown as PlayCommand;
    expect(decide(anaToBuild(), command)).toEqual({ ok: false, error: { code: "INVALID_TRADE", reason: "unknown-resource" } });
  });

  it("given the bank has none left, it is refused", () => {
    const state = { ...anaToBuild(hand({ wool: 4 })), bank: hand({ wool: 10 }) };
    expect(decide(state, { type: "TradeWithBank", player: "ana", give: "wool", get: "ore" })).toEqual({
      ok: false,
      error: { code: "BANK_EMPTY", resource: "ore" },
    });
  });
});

describe("Feature: Longest Road", () => {
  /** A chain of `n` connected edges starting from corner `start`, avoiding `avoid`. */
  function chain(start: VertexId, n: number): EdgeId[] {
    const edges: EdgeId[] = [];
    const seen = new Set([start]);
    let at = start;
    for (let i = 0; i < n; i++) {
      const next = TOPOLOGY.vertices[at]?.neighbours.find((v) => !seen.has(v));
      if (next === undefined) break;
      const edge = TOPOLOGY.edges.find((e) => e.ends.includes(at) && e.ends.includes(next))?.id ?? -1;
      edges.push(edge);
      seen.add(next);
      at = next;
    }
    return edges;
  }

  const empty = (): PlayState => ({ ...anaToBuild(), roads: {}, buildings: {}, longestRoad: null });

  it("counts a straight chain of roads", () => {
    const edges = chain(0, 6);
    const state = { ...empty(), roads: Object.fromEntries(edges.map((e) => [e, "ana"])) };
    expect(longestRoadLength(state, "ana")).toBe(6);
    expect(longestRoadLength(state, "ben")).toBe(0);
  });

  it("counts the longest branch of a fork, not the total", () => {
    const main = chain(20, 4);
    const at = TOPOLOGY.edges[main[1] ?? 0]?.ends ?? [0, 0];
    const fork = TOPOLOGY.vertices[at[1]]?.edges.find((e) => !main.includes(e)) ?? -1;
    const state = { ...empty(), roads: Object.fromEntries([...main, fork].map((e) => [e, "ana"])) };
    expect(longestRoadLength(state, "ana")).toBe(4);
  });

  it("counts a closed loop of six roads as six", () => {
    const ring = TOPOLOGY.hexCorners["0,0"] ?? [];
    const edges = ring.map((v, i) => TOPOLOGY.edges.find((e) => e.ends.includes(v) && e.ends.includes(ring[(i + 1) % 6] ?? -1))?.id ?? -1);
    const state = { ...empty(), roads: Object.fromEntries(edges.map((e) => [e, "ana"])) };
    expect(longestRoadLength(state, "ana")).toBe(6);
  });

  it("is broken by an opponent's settlement in the middle", () => {
    const edges = chain(0, 6);
    const middle = TOPOLOGY.edges[edges[2] ?? 0]?.ends.find((v) => TOPOLOGY.edges[edges[3] ?? 0]?.ends.includes(v)) ?? -1;
    const state = {
      ...empty(),
      roads: Object.fromEntries(edges.map((e) => [e, "ana"])),
      buildings: { [middle]: { player: "ben", kind: "settlement" as const } },
    };
    expect(longestRoadLength(state, "ana")).toBe(3);
  });

  it("is not broken by the player's own settlement", () => {
    const edges = chain(0, 6);
    const middle = TOPOLOGY.edges[edges[2] ?? 0]?.ends.find((v) => TOPOLOGY.edges[edges[3] ?? 0]?.ends.includes(v)) ?? -1;
    const state = {
      ...empty(),
      roads: Object.fromEntries(edges.map((e) => [e, "ana"])),
      buildings: { [middle]: { player: "ana", kind: "settlement" as const } },
    };
    expect(longestRoadLength(state, "ana")).toBe(6);
  });

  it("given a road of 5 is built, the builder takes Longest Road worth 2 points", () => {
    let state = anaToBuild(hand({ lumber: 20, brick: 20 }));
    const before = points(state, "ana");
    while (longestRoadLength(state, "ana") < 5) {
      const best = legalRoads(state, "ana")
        .map((edge) => ({ edge, length: longestRoadLength({ ...state, roads: { ...state.roads, [edge]: "ana" } }, "ana") }))
        .sort((a, b) => b.length - a.length)[0];
      state = apply(state, { type: "BuildRoad", player: "ana", edge: best?.edge ?? -1 });
    }
    expect(state.longestRoad).toBe("ana");
    expect(points(state, "ana")).toBe(before + 2);
  });
});

describe("Feature: winning", () => {
  it("given ana reaches 10 points on her turn, she wins and no more moves are accepted", () => {
    const state = anaToBuild(rich);
    const spare = TOPOLOGY.vertices
      .filter((v) => !state.buildings[v.id] && v.neighbours.every((n) => !state.buildings[n]))
      .slice(0, 5);
    const kinds = ["city", "city", "settlement", "settlement", "settlement"] as const;
    const nearly: PlayState = {
      ...state,
      buildings: {
        ...state.buildings,
        ...Object.fromEntries(spare.map((v, i) => [v.id, { player: "ana", kind: kinds[i] ?? "settlement" }])),
      },
    };
    expect(points(nearly, "ana")).toBe(9);
    expect(nearly.winner).toBeNull();

    const final = apply(nearly, { type: "BuildCity", player: "ana", vertex: legalCities(nearly, "ana")[0] ?? -1 });

    expect(points(final, "ana")).toBe(10);
    expect(final.winner).toBe("ana");
    expect(final.phase).toBe("finished");
    expect(decide(final, { type: "EndTurn", player: "ana" })).toEqual({ ok: false, error: { code: "GAME_OVER", winner: "ana" } });
  });
});

describe("Feature: build options for the UI", () => {
  it("given ana's build step and plenty of cards, every piece is allowed with its legal spots", () => {
    const options = buildOptions(anaToBuild(), "ana");
    expect(options.map((o) => o.piece)).toEqual(["road", "settlement", "city"]);
    const [road, , city] = options;
    expect(road).toMatchObject({ allowed: true, cost: COSTS.road, missing: emptyHand });
    expect(city?.spots).toHaveLength(2);
  });

  it("given no cards, each option says what is missing and is not allowed", () => {
    const options = buildOptions(anaToBuild(emptyHand), "ana");
    expect(options.every((o) => !o.allowed)).toBe(true);
    expect(options[2]?.missing).toEqual(COSTS.city);
  });

  it("given it is not ben's turn, nothing is allowed for ben", () => {
    const state = anaToBuild();
    const withCards = { ...state, hands: { ...state.hands, ben: rich } };
    expect(buildOptions(withCards, "ben").every((o) => !o.allowed)).toBe(true);
  });
});

describe("Feature: random games stay legal (property)", () => {
  it("whatever legal builds and trades happen, resources are conserved and pieces never exceed the supply", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 300 }), fc.array(fc.nat(), { minLength: 20, maxLength: 120 }), (seed, choices) => {
        let log = completeSetup(play([{ type: "StartGame", players: ["ana", "ben", "cy"], seed }]));
        for (const choice of choices) {
          const state = replayPlay(log);
          if (state.winner) break;
          const player = currentPlayer(state) ?? "";
          let command: PlayCommand;
          if (state.phase === "roll") {
            command = { type: "RollDice", player, dice: [(choice % 6) + 1, ((choice >> 3) % 6) + 1] };
          } else {
            const options = buildOptions(state, player).filter((o) => o.allowed);
            const pick = options[choice % (options.length + 1)];
            command = pick
              ? pick.piece === "road"
                ? { type: "BuildRoad", player, edge: pick.spots[choice % pick.spots.length] ?? -1 }
                : pick.piece === "settlement"
                  ? { type: "BuildSettlement", player, vertex: pick.spots[choice % pick.spots.length] ?? -1 }
                  : { type: "BuildCity", player, vertex: pick.spots[choice % pick.spots.length] ?? -1 }
              : { type: "EndTurn", player };
          }
          log = play([command], log);
        }
        const state = replayPlay(log);
        for (const r of RESOURCES) {
          const held = state.players.reduce((n, p) => n + (state.hands[p]?.[r] ?? 0), 0);
          expect(state.bank[r] + held).toBe(19);
          for (const p of state.players) expect(state.hands[p]?.[r]).toBeGreaterThanOrEqual(0);
        }
        for (const p of state.players) {
          const left = piecesLeft(state, p);
          expect(left.road).toBeGreaterThanOrEqual(0);
          expect(left.settlement).toBeGreaterThanOrEqual(0);
          expect(left.city).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 40 },
    );
  });
});
