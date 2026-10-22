import { describe, expect, it } from "vitest";
import type { PlayEvent } from "./events";
import { replayPlay } from "./evolve";
import { checkInvariants, isKnownEvent, PLAY_LOG_VERSION, replayChecked } from "./integrity";
import { hand } from "./resources";
import { initialPlayState, type PlayState } from "./state";
import { completeSetup, play } from "./test-helpers";

const started = () => completeSetup(play([{ type: "StartGame", players: ["ana", "ben", "cy"], seed: 4 }]));
const stateOf = (log: readonly PlayEvent[]) => replayPlay(log);
const broken = (state: PlayState, change: Partial<PlayState>): PlayState => ({ ...state, ...change });

describe("Feature: recognising events", () => {
  it("knows every event a game produces", () => {
    expect(started().every(isKnownEvent)).toBe(true);
  });
  it("rejects values that are not events", () => {
    expect(isKnownEvent(null)).toBe(false);
    expect(isKnownEvent("DiceRolled")).toBe(false);
    expect(isKnownEvent({})).toBe(false);
    expect(isKnownEvent({ type: 7 })).toBe(false);
    expect(isKnownEvent({ type: "FutureEvent" })).toBe(false);
  });
  it("does not treat inherited object keys as event types", () => {
    expect(isKnownEvent({ type: "toString" })).toBe(false);
    expect(isKnownEvent({ type: "constructor" })).toBe(false);
  });
  it("has a log version", () => {
    expect(PLAY_LOG_VERSION).toBe(1);
  });
});

describe("Feature: invariants of a sound game", () => {
  it("given a game before it starts, finds nothing to check", () => {
    expect(checkInvariants(initialPlayState)).toEqual([]);
  });
  it("given a normal game, finds nothing wrong", () => {
    expect(checkInvariants(stateOf(started()))).toEqual([]);
  });
  it("given a card created from nowhere, reports the resource total", () => {
    const state = stateOf(started());
    const hands = { ...state.hands, ana: hand({ ...state.hands["ana"], lumber: (state.hands["ana"]?.lumber ?? 0) + 1 }) };
    expect(checkInvariants(broken(state, { hands }))).toEqual(["lumber totals 20 across bank and hands, expected 19"]);
  });
  it("given a negative hand, names the player and resource", () => {
    const state = stateOf(started());
    const hands = { ...state.hands, ben: hand({ brick: -1 }) };
    const problems = checkInvariants(broken(state, { hands }));
    expect(problems).toContain("ben has -1 brick");
  });
  it("given a negative bank, says so", () => {
    const state = stateOf(started());
    const problems = checkInvariants(broken(state, { bank: hand({ ore: -2 }) }));
    expect(problems).toContain("the bank has -2 ore");
  });
  it("given a building or road off the board, reports it", () => {
    const state = stateOf(started());
    const problems = checkInvariants(
      broken(state, {
        buildings: { ...state.buildings, 999: { player: "ana", kind: "settlement" } },
        roads: { ...state.roads, 999: "ana" },
      }),
    );
    expect(problems).toContain("a building stands on corner 999, which does not exist");
    expect(problems).toContain("a road lies on edge 999, which does not exist");
  });
  it("given too many pieces, reports each limit", () => {
    const state = stateOf(started());
    const roads = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i, "ana"]));
    const buildings = {
      ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [i, { player: "ana", kind: "settlement" as const }])),
      ...Object.fromEntries(Array.from({ length: 5 }, (_, i) => [i + 10, { player: "ana", kind: "city" as const }])),
    };
    const problems = checkInvariants(broken(state, { roads, buildings }));
    expect(problems).toContain("ana has 16 roads, the limit is 15");
    expect(problems).toContain("ana has 6 settlements, the limit is 5");
    expect(problems).toContain("ana has 5 cities, the limit is 4");
  });
  it("accepts a player exactly at each limit", () => {
    const state = stateOf(started());
    const roads = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [i, "ana"]));
    const buildings = {
      ...Object.fromEntries(Array.from({ length: 5 }, (_, i) => [i, { player: "ana", kind: "settlement" as const }])),
      ...Object.fromEntries(Array.from({ length: 4 }, (_, i) => [i + 10, { player: "ana", kind: "city" as const }])),
    };
    const problems = checkInvariants(broken(state, { roads, buildings }));
    expect(problems.filter((p) => p.includes("limit"))).toEqual([]);
  });
  it("given a current player outside the seats, reports it", () => {
    const state = stateOf(started());
    expect(checkInvariants(broken(state, { current: 3 }))).toContain("the current player index 3 is outside the 3 seats");
    expect(checkInvariants(broken(state, { current: -1 }))).toContain("the current player index -1 is outside the 3 seats");
  });
  it("given a board with no robber, reports it", () => {
    const state = stateOf(started());
    expect(checkInvariants(broken(state, { robber: null }))).toContain("the robber is not on the board");
  });
});

describe("Feature: replaying a stored log defensively", () => {
  it("given a sound log, applies every event and reports nothing", () => {
    const log = started();
    const outcome = replayChecked(log);
    expect(outcome.salvaged).toBe(false);
    expect(outcome.problems).toEqual([]);
    expect(outcome.events).toEqual(log);
    expect(outcome.state).toEqual(stateOf(log));
  });
  it("given an empty log, returns the initial state", () => {
    expect(replayChecked([])).toEqual({ state: initialPlayState, events: [], salvaged: false, problems: [] });
  });
  it("given an unknown event, keeps the events before it and drops the rest", () => {
    const log = started();
    const outcome = replayChecked([...log.slice(0, 5), { type: "FutureEvent" }, ...log.slice(5)]);
    expect(outcome.salvaged).toBe(true);
    expect(outcome.events).toEqual(log.slice(0, 5));
    expect(outcome.state).toEqual(stateOf(log.slice(0, 5)));
    expect(outcome.problems).toEqual([
      { kind: "unreadable-event", index: 5, detail: "not an event this version of the rules knows" },
    ]);
  });
  it("given junk in the log, stops at the first piece of junk", () => {
    const log = started();
    const outcome = replayChecked([...log.slice(0, 2), null, "x"]);
    expect(outcome.events).toHaveLength(2);
    expect(outcome.problems).toHaveLength(1);
    expect(outcome.problems[0]?.index).toBe(2);
  });
  it("given a log whose first event is not a start, still stops cleanly", () => {
    const outcome = replayChecked([{ type: "FutureEvent" }]);
    expect(outcome.events).toEqual([]);
    expect(outcome.salvaged).toBe(true);
  });
  it("given an event that cannot be applied, stops there and says why", () => {
    const log = started();
    const damaged = { type: "GameStarted", players: ["ana"], board: null } as unknown as PlayEvent;
    const outcome = replayChecked([damaged, ...log.slice(1)]);
    expect(outcome.salvaged).toBe(true);
    expect(outcome.events).toEqual([]);
    expect(outcome.problems[0]).toMatchObject({ kind: "event-failed", index: 0 });
    expect(outcome.problems[0]?.detail).toMatch(/^GameStarted could not be applied: /);
  });
  it("given a log that breaks an invariant, keeps every event and reports it once", () => {
    const log = started();
    const overdraft: PlayEvent = { type: "BankTraded", player: "ana", give: "ore", get: "grain" };
    const outcome = replayChecked([...log, overdraft, overdraft]);
    expect(outcome.salvaged).toBe(false);
    expect(outcome.events).toHaveLength(log.length + 2);
    const invariantProblems = outcome.problems.filter((p) => p.kind === "invariant");
    expect(invariantProblems).toHaveLength(1);
    expect(invariantProblems[0]?.index).toBe(log.length);
  });
});
