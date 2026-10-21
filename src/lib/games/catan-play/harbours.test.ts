import { describe, expect, it } from "vitest";
import { decide } from "./decide";
import { evolve, replayPlay } from "./evolve";
import { coastRing, dealHarbours, HARBOUR_KINDS, HARBOUR_SLOTS } from "./harbours";
import { tradeRate } from "./queries";
import { hand } from "./resources";
import type { PlayState } from "./state";
import { completeSetup, play } from "./test-helpers";
import { TOPOLOGY } from "./topology";

const shared = (edge: number) => {
  const [a, b] = TOPOLOGY.edges[edge]?.ends ?? [-1, -1];
  return (TOPOLOGY.vertices[a]?.hexes ?? []).filter((h) => TOPOLOGY.vertices[b]?.hexes.includes(h));
};

describe("Feature: the coast", () => {
  const ring = coastRing();

  it("has 30 coastal edges, each touching one hex", () => {
    expect(ring).toHaveLength(30);
    expect(new Set(ring).size).toBe(30);
    for (const edge of ring) expect(shared(edge)).toHaveLength(1);
  });

  it("goes round the island: each edge shares a corner with the next, and the last with the first", () => {
    for (let i = 0; i < ring.length; i++) {
      const a = TOPOLOGY.edges[ring[i] ?? 0]?.ends ?? [];
      const b = TOPOLOGY.edges[ring[(i + 1) % ring.length] ?? 0]?.ends ?? [];
      expect(a.some((v) => b.includes(v))).toBe(true);
    }
  });
});

describe("Feature: dealing harbours", () => {
  it("places the nine base-game harbours on the fixed coastal slots", () => {
    const harbours = dealHarbours(3);
    const ring = coastRing();
    expect(harbours.map((h) => h.edge)).toEqual(HARBOUR_SLOTS.map((s) => ring[s]));
    expect(harbours.map((h) => h.kind).sort()).toEqual([...HARBOUR_KINDS].sort());
  });

  it("never puts two harbours on edges that share a corner", () => {
    const edges = dealHarbours(3).map((h) => TOPOLOGY.edges[h.edge]?.ends ?? []);
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        expect(edges[i]?.some((v) => edges[j]?.includes(v))).toBe(false);
      }
    }
  });

  it("is dealt from the seed", () => {
    expect(dealHarbours(7)).toEqual(dealHarbours(7));
    const orders = new Set(Array.from({ length: 10 }, (_, s) => dealHarbours(s).map((h) => h.kind).join()));
    expect(orders.size).toBeGreaterThan(5);
  });

  it("is stored with the game; old games without harbours have none", () => {
    const log = play([{ type: "StartGame", players: ["ana", "ben"], seed: 4 }]);
    expect(replayPlay(log).harbours).toEqual(dealHarbours(4));
    const old = log.map((e) => (e.type === "GameStarted" ? { ...e, harbours: undefined } : e));
    expect(replayPlay(old).harbours).toEqual([]);
  });
});

describe("Feature: harbour trade rates", () => {
  const base = (): PlayState => {
    const state = replayPlay(play([{ type: "RollDice", player: "ana", dice: [1, 2] }], completeSetup(play([{ type: "StartGame", players: ["ana", "ben"], seed: 4 }]))));
    return { ...state, buildings: {}, roads: {} };
  };
  const corner = (edge: number) => TOPOLOGY.edges[edge]?.ends[0] ?? 0;

  it("given no harbour, the rate is 4", () => {
    expect(tradeRate({ ...base(), harbours: [] }, "ana", "wool")).toBe(4);
  });

  it("given a settlement on a 3:1 harbour, every resource trades at 3", () => {
    const edge = coastRing()[0] ?? 0;
    const state = { ...base(), harbours: [{ edge, kind: "any" as const }], buildings: { [corner(edge)]: { player: "ana", kind: "settlement" as const } } };
    expect(tradeRate(state, "ana", "ore")).toBe(3);
    expect(tradeRate(state, "ben", "ore")).toBe(4);
  });

  it("given a city on a 2:1 wool harbour, wool trades at 2 and the rest at 4", () => {
    const edge = coastRing()[3] ?? 0;
    const state = { ...base(), harbours: [{ edge, kind: "wool" as const }], buildings: { [corner(edge)]: { player: "ana", kind: "city" as const } } };
    expect(tradeRate(state, "ana", "wool")).toBe(2);
    expect(tradeRate(state, "ana", "ore")).toBe(4);
  });

  it("given both harbours, each resource gets its best rate", () => {
    const [e1, e2] = [coastRing()[0] ?? 0, coastRing()[3] ?? 0];
    const state = {
      ...base(),
      harbours: [
        { edge: e1, kind: "any" as const },
        { edge: e2, kind: "wool" as const },
      ],
      buildings: {
        [corner(e1)]: { player: "ana", kind: "settlement" as const },
        [corner(e2)]: { player: "ana", kind: "settlement" as const },
      },
    };
    expect(tradeRate(state, "ana", "wool")).toBe(2);
    expect(tradeRate(state, "ana", "grain")).toBe(3);
  });

  it("given a 2:1 rate, trading takes 2 cards and records the rate", () => {
    const edge = coastRing()[3] ?? 0;
    const state = {
      ...base(),
      harbours: [{ edge, kind: "wool" as const }],
      buildings: { [corner(edge)]: { player: "ana", kind: "settlement" as const } },
      hands: { ana: hand({ wool: 2 }), ben: hand({}) },
    };
    const result = decide(state, { type: "TradeWithBank", player: "ana", give: "wool", get: "ore" });
    expect(result).toEqual({ ok: true, value: [{ type: "BankTraded", player: "ana", give: "wool", get: "ore", rate: 2 }] });
    const next = result.ok ? result.value.reduce(evolve, state) : state;
    expect(next.hands.ana).toEqual(hand({ ore: 1 }));
    expect(next.bank.wool).toBe(state.bank.wool + 2);
  });

  it("given a stored trade without a rate (older games), it is treated as 4:1", () => {
    const state = { ...base(), hands: { ana: hand({ wool: 4 }), ben: hand({}) } };
    const next = evolve(state, { type: "BankTraded", player: "ana", give: "wool", get: "ore" });
    expect(next.hands.ana).toEqual(hand({ ore: 1 }));
  });

  it("given too few cards for the rate, the refusal says how many are needed", () => {
    const edge = coastRing()[0] ?? 0;
    const state = {
      ...base(),
      harbours: [{ edge, kind: "any" as const }],
      buildings: { [corner(edge)]: { player: "ana", kind: "settlement" as const } },
      hands: { ana: hand({ ore: 2 }), ben: hand({}) },
    };
    expect(decide(state, { type: "TradeWithBank", player: "ana", give: "ore", get: "wool" })).toEqual({
      ok: false,
      error: { code: "NOT_ENOUGH_TO_TRADE", give: "ore", needed: 3 },
    });
  });
});
