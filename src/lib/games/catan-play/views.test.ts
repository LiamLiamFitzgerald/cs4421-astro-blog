import { describe, expect, it } from "vitest";
import { replayPlay } from "./evolve";
import { hand } from "./resources";
import type { PlayState } from "./state";
import { completeSetup, play } from "./test-helpers";
import { viewFor, withServerRandomness } from "./views";

const started = (): PlayState => {
  const state = replayPlay(completeSetup(play([{ type: "StartGame", players: ["ana", "ben", "cy"], seed: 4 }])));
  return {
    ...state,
    hands: { ana: hand({ lumber: 2, ore: 1 }), ben: hand({ wool: 4 }), cy: hand({}) },
    devCards: { ana: [{ card: "victory-point", boughtOnTurn: 0 }], ben: [{ card: "knight", boughtOnTurn: 1 }, { card: "monopoly", boughtOnTurn: 1 }], cy: [] },
  };
};

describe("Feature: what each screen may see", () => {
  it("given the shared board, nobody's cards are visible, only their counts", () => {
    const view = viewFor(started(), null);
    for (const p of ["ana", "ben", "cy"]) {
      expect(view.state.hands[p]).toEqual(hand({}));
      expect(view.state.devCards[p]).toEqual([]);
    }
    expect(view.cardCounts).toEqual({ ana: 3, ben: 4, cy: 0 });
    expect(view.devCardCounts).toEqual({ ana: 1, ben: 2, cy: 0 });
  });

  it("given a seat, that player sees their own cards and only counts for the others", () => {
    const view = viewFor(started(), "ben");
    expect(view.state.hands["ben"]).toEqual(hand({ wool: 4 }));
    expect(view.state.devCards["ben"]).toHaveLength(2);
    expect(view.state.hands["ana"]).toEqual(hand({}));
    expect(view.state.devCards["ana"]).toEqual([]);
    expect(view.cardCounts["ana"]).toBe(3);
  });

  it("keeps how many development cards are left but not their order", () => {
    const state = started();
    const view = viewFor(state, "ana");
    expect(view.state.deck).toHaveLength(state.deck.length);
    expect(new Set(view.state.deck)).toEqual(new Set(["knight"]));
  });

  it("keeps public information: board, pieces, bank, robber, scores", () => {
    const state = started();
    const view = viewFor(state, null).state;
    expect(view.board).toEqual(state.board);
    expect(view.buildings).toEqual(state.buildings);
    expect(view.roads).toEqual(state.roads);
    expect(view.bank).toEqual(state.bank);
    expect(view.robber).toBe(state.robber);
  });

  it("does not change the state it was given", () => {
    const state = started();
    const before = JSON.stringify(state);
    viewFor(state, null);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("Feature: the server chooses everything random", () => {
  const state = started();
  const fixed = (values: number[]) => {
    const queue = [...values];
    const asked: number[] = [];
    return { random: (n: number) => (asked.push(n), queue.shift() ?? 0), asked };
  };

  it("given a roll, replaces the phone's dice with the server's", () => {
    const { random, asked } = fixed([5, 0]);
    expect(withServerRandomness({ type: "RollDice", player: "ana", dice: [6, 6] }, state, random)).toEqual({
      type: "RollDice",
      player: "ana",
      dice: [6, 1],
    });
    expect(asked).toEqual([6, 6]);
  });

  it("given a steal, picks one of the victim's cards", () => {
    const { random, asked } = fixed([2]);
    expect(withServerRandomness({ type: "StealFrom", player: "ana", victim: "ben", pick: 0 }, state, random)).toMatchObject({
      pick: 2,
    });
    expect(asked).toEqual([4]);
  });

  it("given a steal from an empty hand, still asks for a valid range", () => {
    const { random, asked } = fixed([0]);
    withServerRandomness({ type: "StealFrom", player: "ana", victim: "cy", pick: 9 }, state, random);
    expect(asked).toEqual([1]);
  });

  it("given a new game, chooses the seed", () => {
    const { random, asked } = fixed([123]);
    expect(withServerRandomness({ type: "StartGame", players: ["a", "b"], seed: 1 }, state, random)).toMatchObject({ seed: 123 });
    expect(asked).toEqual([0x100000000]);
  });

  it("leaves other commands alone", () => {
    const { random, asked } = fixed([]);
    const end = { type: "EndTurn", player: "ana" } as const;
    expect(withServerRandomness(end, state, random)).toBe(end);
    expect(asked).toEqual([]);
  });
});
