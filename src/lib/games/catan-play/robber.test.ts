import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { PlayCommand } from "./commands";
import { decide } from "./decide";
import { evolve, replayPlay } from "./evolve";
import {
  actingPlayer,
  cardAt,
  currentPlayer,
  discardsOwed,
  expectedStep,
  legalRobberHexes,
  production,
  robberVictims,
} from "./queries";
import { emptyHand, hand, handSize, RESOURCES } from "./resources";
import type { PlayState } from "./state";
import { completeSetup, play, resolvePending } from "./test-helpers";
import { TOPOLOGY } from "./topology";

const players = ["ana", "ben", "cy"];
const afterSetup = () => replayPlay(completeSetup(play([{ type: "StartGame", players, seed: 8 }])));

function apply(state: PlayState, ...commands: PlayCommand[]): PlayState {
  return commands.reduce((s, command) => {
    const result = decide(s, command);
    if (!result.ok) throw new Error(`${command.type} refused: ${JSON.stringify(result.error)}`);
    return result.value.reduce(evolve, s);
  }, state);
}

const withHands = (state: PlayState, hands: Record<string, ReturnType<typeof hand>>): PlayState => ({
  ...state,
  hands: { ...state.hands, ...hands },
});

const desert = (state: PlayState) => {
  const d = state.board?.hexes.find((h) => h.terrain === "desert");
  return `${d?.q},${d?.r}`;
};

/** A hex next to one of `owner`'s buildings (not the desert). */
function hexBeside(state: PlayState, owner: string): string {
  const corner = Number(Object.entries(state.buildings).find(([, b]) => b.player === owner)?.[0]);
  return (TOPOLOGY.vertices[corner]?.hexes ?? []).find((h) => h !== state.robber) ?? "";
}

describe("Feature: the robber starts on the desert", () => {
  it("given a new game, the robber is on the desert", () => {
    const state = afterSetup();
    expect(state.robber).toBe(desert(state));
    expect(legalRobberHexes(state)).toHaveLength(18);
    expect(legalRobberHexes(state)).not.toContain(desert(state));
  });
});

describe("Feature: rolling a 7", () => {
  it("given nobody holds more than 7 cards, the roller moves the robber next", () => {
    const state = apply(afterSetup(), { type: "RollDice", player: "ana", dice: [3, 4] });
    expect(expectedStep(state)).toBe("move-robber");
    expect(actingPlayer(state)).toBe("ana");
    expect(state.lastRoll?.produced).toEqual({ ana: emptyHand, ben: emptyHand, cy: emptyHand });
  });

  it("given players hold more than 7 cards, each owes half rounded down, in seat order from the roller", () => {
    const state = withHands(afterSetup(), { ana: hand({ ore: 8 }), ben: hand({ wool: 7 }), cy: hand({ grain: 9 }) });
    expect(discardsOwed(state)).toEqual({ ana: 4, cy: 4 });
    const rolled = apply(state, { type: "RollDice", player: "ana", dice: [6, 1] });
    expect(expectedStep(rolled)).toBe("discard");
    expect(actingPlayer(rolled)).toBe("ana");
    const afterAna = apply(rolled, { type: "DiscardCards", player: "ana", cards: hand({ ore: 4 }) });
    expect(actingPlayer(afterAna)).toBe("cy");
    const afterCy = apply(afterAna, { type: "DiscardCards", player: "cy", cards: hand({ grain: 4 }) });
    expect(expectedStep(afterCy)).toBe("move-robber");
    expect(actingPlayer(afterCy)).toBe("ana");
    expect(afterCy.hands.ana?.ore).toBe(4);
    expect(afterCy.bank.ore).toBe(state.bank.ore + 4);
  });

  it("given a discard of the wrong size, it is refused with how many are owed", () => {
    const rolled = apply(withHands(afterSetup(), { ana: hand({ ore: 9 }) }), { type: "RollDice", player: "ana", dice: [5, 2] });
    expect(decide(rolled, { type: "DiscardCards", player: "ana", cards: hand({ ore: 3 }) })).toEqual({
      ok: false,
      error: { code: "WRONG_DISCARD_COUNT", owed: 4, given: 3 },
    });
  });

  it("given a discard of cards not held, it is refused", () => {
    const rolled = apply(withHands(afterSetup(), { ana: hand({ ore: 9 }) }), { type: "RollDice", player: "ana", dice: [5, 2] });
    expect(decide(rolled, { type: "DiscardCards", player: "ana", cards: hand({ wool: 4 }) })).toEqual({
      ok: false,
      error: { code: "NOT_IN_HAND" },
    });
  });

  it("given negative or fractional counts, the discard is refused", () => {
    const rolled = apply(withHands(afterSetup(), { ana: hand({ ore: 9 }) }), { type: "RollDice", player: "ana", dice: [5, 2] });
    expect(decide(rolled, { type: "DiscardCards", player: "ana", cards: hand({ ore: 5, wool: -1 }) })).toMatchObject({
      error: { code: "WRONG_DISCARD_COUNT" },
    });
    expect(decide(rolled, { type: "DiscardCards", player: "ana", cards: hand({ ore: 3.5, grain: 0.5 }) })).toMatchObject({
      error: { code: "WRONG_DISCARD_COUNT" },
    });
  });

  it("given a player who owes nothing, their discard is refused as not their turn", () => {
    const rolled = apply(withHands(afterSetup(), { ben: hand({ ore: 9 }) }), { type: "RollDice", player: "ana", dice: [5, 2] });
    expect(actingPlayer(rolled)).toBe("ben");
    expect(decide(rolled, { type: "DiscardCards", player: "ana", cards: hand({}) })).toEqual({
      ok: false,
      error: { code: "NOT_YOUR_TURN", player: "ana", current: "ben" },
    });
  });

  it("given discards are pending, building or ending the turn is refused", () => {
    const rolled = apply(withHands(afterSetup(), { ana: hand({ ore: 9 }) }), { type: "RollDice", player: "ana", dice: [5, 2] });
    expect(decide(rolled, { type: "EndTurn", player: "ana" })).toEqual({ ok: false, error: { code: "WRONG_STEP", expected: "discard" } });
  });
});

describe("Feature: moving the robber and stealing", () => {
  const rolledSeven = () => apply(afterSetup(), { type: "RollDice", player: "ana", dice: [3, 4] });

  it("given the robber's hex, moving it there again is refused", () => {
    const state = rolledSeven();
    expect(decide(state, { type: "MoveRobber", player: "ana", hex: state.robber ?? "" })).toEqual({
      ok: false,
      error: { code: "ROBBER_MUST_MOVE" },
    });
  });

  it("given a hex that does not exist, it is refused", () => {
    expect(decide(rolledSeven(), { type: "MoveRobber", player: "ana", hex: "9,9" })).toEqual({
      ok: false,
      error: { code: "UNKNOWN_SPOT" },
    });
  });

  it("given a hex with an opponent's building, the mover steals one card from them", () => {
    const base = withHands(rolledSeven(), { ben: hand({ wool: 2, ore: 1 }) });
    const hex = hexBeside(base, "ben");
    const moved = apply(base, { type: "MoveRobber", player: "ana", hex });
    expect(moved.robber).toBe(hex);
    expect(expectedStep(moved)).toBe("steal");
    expect(robberVictims(moved, hex, "ana")).toContain("ben");
    const stolen = apply(moved, { type: "StealFrom", player: "ana", victim: "ben", pick: 2 });
    expect(stolen.hands.ben).toEqual(hand({ wool: 2 }));
    expect(stolen.hands.ana?.ore).toBe((base.hands.ana?.ore ?? 0) + 1);
    expect(expectedStep(stolen)).toBe("build-or-end");
  });

  it("given a victim not on the hex, or a pick past their cards, the steal is refused", () => {
    const base = withHands(rolledSeven(), { ben: hand({ wool: 1 }) });
    const moved = apply(base, { type: "MoveRobber", player: "ana", hex: hexBeside(base, "ben") });
    const victims = moved.pending?.kind === "steal" ? moved.pending.victims : [];
    const outsider = players.find((p) => p !== "ana" && !victims.includes(p));
    if (outsider) {
      expect(decide(moved, { type: "StealFrom", player: "ana", victim: outsider, pick: 0 })).toMatchObject({ error: { code: "NOT_A_VICTIM" } });
    }
    expect(decide(moved, { type: "StealFrom", player: "ana", victim: "ben", pick: 1 })).toEqual({ ok: false, error: { code: "INVALID_PICK" } });
    expect(decide(moved, { type: "StealFrom", player: "ana", victim: "ben", pick: -1 })).toEqual({ ok: false, error: { code: "INVALID_PICK" } });
    expect(decide(moved, { type: "StealFrom", player: "ana", victim: "ben", pick: 0.5 })).toEqual({ ok: false, error: { code: "INVALID_PICK" } });
  });

  it("given nobody to steal from, play goes straight back to building", () => {
    const state = rolledSeven();
    const empty = legalRobberHexes(state).find((h) => robberVictims(state, h, "ana").length === 0) ?? "";
    const moved = apply(state, { type: "MoveRobber", player: "ana", hex: empty });
    expect(moved.pending).toBeNull();
    expect(expectedStep(moved)).toBe("build-or-end");
  });

  it("given the robber on a hex, that hex produces nothing", () => {
    const state = afterSetup();
    const hex = state.board?.hexes.find((h) => h.token !== null && (TOPOLOGY.hexCorners[`${h.q},${h.r}`] ?? []).some((c) => state.buildings[c]));
    const key = `${hex?.q},${hex?.r}`;
    const before = production(state, hex?.token ?? 0).produced;
    const robbed = production({ ...state, robber: key }, hex?.token ?? 0).produced;
    const total = (p: Record<string, ReturnType<typeof hand>>) => Object.values(p).reduce((n, h) => n + handSize(h), 0);
    expect(total(robbed)).toBeLessThan(total(before));
  });

  it("a victim with no cards is not offered", () => {
    const state = withHands(rolledSeven(), { ben: emptyHand });
    expect(robberVictims(state, hexBeside(state, "ben"), "ana")).not.toContain("ben");
  });

  it("the thief is never their own victim", () => {
    const state = withHands(rolledSeven(), { ana: hand({ ore: 3 }) });
    expect(robberVictims(state, hexBeside(state, "ana"), "ana")).not.toContain("ana");
  });
});

describe("Feature: picking a card", () => {
  it.each([
    [0, "lumber"],
    [1, "wool"],
    [3, "ore"],
    [4, null],
  ] as const)("pick %i from 1 lumber, 2 wool, 1 ore is %s", (pick, expected) => {
    expect(cardAt(hand({ lumber: 1, wool: 2, ore: 1 }), pick)).toBe(expected);
  });
});

describe("Feature: robber turns keep the game legal (property)", () => {
  it("after any sevens and discards, resources are conserved and nobody owes cards at the end of a turn", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 2, max: 12 }), { minLength: 5, maxLength: 30 }), (totals) => {
        let log = completeSetup(play([{ type: "StartGame", players, seed: 13 }]));
        for (const total of totals) {
          const player = currentPlayer(replayPlay(log)) ?? "";
          const a = Math.max(1, Math.min(6, total - 1));
          log = resolvePending(play([{ type: "RollDice", player, dice: [a, total - a] }], log));
          log = play([{ type: "EndTurn", player }], log);
        }
        const state = replayPlay(log);
        expect(state.pending).toBeNull();
        for (const r of RESOURCES) {
          const held = state.players.reduce((n, p) => n + (state.hands[p]?.[r] ?? 0), 0);
          expect(state.bank[r] + held).toBe(19);
        }
      }),
      { numRuns: 50 },
    );
  });
});
