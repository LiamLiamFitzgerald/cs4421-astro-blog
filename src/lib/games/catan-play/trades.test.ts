import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { PlayCommand } from "./commands";
import { decide } from "./decide";
import { evolve, replayPlay } from "./evolve";
import { actingPlayer, expectedStep } from "./queries";
import { hand, RESOURCES } from "./resources";
import type { PlayState } from "./state";
import { completeSetup, play } from "./test-helpers";

const players = ["ana", "ben", "cy"];

function apply(state: PlayState, ...commands: PlayCommand[]): PlayState {
  return commands.reduce((s, command) => {
    const result = decide(s, command);
    if (!result.ok) throw new Error(`${command.type} refused: ${JSON.stringify(result.error)}`);
    return result.value.reduce(evolve, s);
  }, state);
}

/** Ana's build step, with set hands. */
function building(hands: Record<string, ReturnType<typeof hand>>): PlayState {
  const state = replayPlay(play([{ type: "RollDice", player: "ana", dice: [1, 2] }], completeSetup(play([{ type: "StartGame", players, seed: 2 }]))));
  return { ...state, hands: { ...state.hands, ...hands } };
}

describe("Feature: offering a trade to another player", () => {
  it("given an offer, the other player has to answer before anything else happens", () => {
    const state = apply(building({ ana: hand({ wool: 2 }), ben: hand({ ore: 1 }) }), {
      type: "ProposeTrade",
      player: "ana",
      to: "ben",
      give: hand({ wool: 2 }),
      get: hand({ ore: 1 }),
    });
    expect(expectedStep(state)).toBe("respond-trade");
    expect(actingPlayer(state)).toBe("ben");
    expect(decide(state, { type: "EndTurn", player: "ana" })).toEqual({
      ok: false,
      error: { code: "NOT_YOUR_TURN", player: "ana", current: "ben" },
    });
  });

  it("given acceptance, the cards swap and the offerer carries on building", () => {
    const base = building({ ana: hand({ wool: 2, grain: 1 }), ben: hand({ ore: 1, brick: 3 }) });
    const state = apply(
      base,
      { type: "ProposeTrade", player: "ana", to: "ben", give: hand({ wool: 2 }), get: hand({ ore: 1 }) },
      { type: "AcceptTrade", player: "ben" },
    );
    expect(state.hands.ana).toEqual(hand({ grain: 1, ore: 1 }));
    expect(state.hands.ben).toEqual(hand({ wool: 2, brick: 3 }));
    expect(state.bank).toEqual(base.bank);
    expect(expectedStep(state)).toBe("build-or-end");
    expect(actingPlayer(state)).toBe("ana");
  });

  it("given a decline, nothing changes and the offerer carries on", () => {
    const base = building({ ana: hand({ wool: 2 }), ben: hand({ ore: 1 }) });
    const state = apply(
      base,
      { type: "ProposeTrade", player: "ana", to: "ben", give: hand({ wool: 2 }), get: hand({ ore: 1 }) },
      { type: "DeclineTrade", player: "ben" },
    );
    expect(state.hands).toEqual(base.hands);
    expect(state.pending).toBeNull();
  });

  it("given the recipient lacks the cards asked for, accepting is refused with what is missing", () => {
    const state = apply(building({ ana: hand({ wool: 2 }), ben: hand({ ore: 1 }) }), {
      type: "ProposeTrade",
      player: "ana",
      to: "ben",
      give: hand({ wool: 1 }),
      get: hand({ ore: 3 }),
    });
    expect(decide(state, { type: "AcceptTrade", player: "ben" })).toEqual({
      ok: false,
      error: { code: "RECIPIENT_LACKS_CARDS", missing: hand({ ore: 2 }) },
    });
  });

  it.each([
    ["an unknown player", { to: "zed" }, "unknown-player"],
    ["yourself", { to: "ana" }, "yourself"],
    ["a gift (nothing asked)", { get: hand({}) }, "empty-side"],
    ["a request for nothing in return", { give: hand({}) }, "empty-side"],
    ["negative counts", { give: hand({ wool: -1, ore: 2 }) }, "not-whole-numbers"],
    ["fractions", { give: hand({ wool: 0.5 }) }, "not-whole-numbers"],
  ])("given %s, the offer is refused", (_label, change, reason) => {
    const state = building({ ana: hand({ wool: 2 }), ben: hand({ ore: 1 }) });
    const command = { type: "ProposeTrade", player: "ana", to: "ben", give: hand({ wool: 1 }), get: hand({ ore: 1 }), ...change } as PlayCommand;
    expect(decide(state, command)).toEqual({ ok: false, error: { code: "INVALID_OFFER", reason } });
  });

  it("given an offer of cards the offerer does not hold, it is refused", () => {
    const state = building({ ana: hand({ wool: 1 }), ben: hand({ ore: 1 }) });
    expect(decide(state, { type: "ProposeTrade", player: "ana", to: "ben", give: hand({ wool: 2 }), get: hand({ ore: 1 }) })).toEqual({
      ok: false,
      error: { code: "NOT_IN_HAND" },
    });
  });

  it("given the dice have not been rolled, offering is refused", () => {
    const state = replayPlay(completeSetup(play([{ type: "StartGame", players, seed: 2 }])));
    expect(decide(state, { type: "ProposeTrade", player: "ana", to: "ben", give: hand({ wool: 1 }), get: hand({ ore: 1 }) })).toEqual({
      ok: false,
      error: { code: "WRONG_STEP", expected: "roll" },
    });
  });

  it("given no offer, accepting or declining is refused", () => {
    const state = building({});
    expect(decide(state, { type: "AcceptTrade", player: "ana" })).toEqual({ ok: false, error: { code: "WRONG_STEP", expected: "build-or-end" } });
    expect(decide(state, { type: "DeclineTrade", player: "ana" })).toEqual({ ok: false, error: { code: "WRONG_STEP", expected: "build-or-end" } });
  });

  it("missing resources in an offer are read as zero", () => {
    const state = building({ ana: hand({ wool: 1 }), ben: hand({ ore: 1 }) });
    const result = decide(state, { type: "ProposeTrade", player: "ana", to: "ben", give: { wool: 1 } as never, get: { ore: 1 } as never });
    expect(result.ok && result.value[0]).toEqual({ type: "TradeProposed", player: "ana", to: "ben", give: hand({ wool: 1 }), get: hand({ ore: 1 }) });
  });
});

describe("Feature: trades never create or destroy cards (property)", () => {
  it("any accepted trade keeps every resource total the same", () => {
    const counts = fc.record({ lumber: fc.nat(3), brick: fc.nat(3), wool: fc.nat(3), grain: fc.nat(3), ore: fc.nat(3) });
    fc.assert(
      fc.property(counts, counts, (give, get) => {
        const base = building({ ana: hand({ lumber: 3, brick: 3, wool: 3, grain: 3, ore: 3 }), ben: hand({ lumber: 3, brick: 3, wool: 3, grain: 3, ore: 3 }) });
        const offer = decide(base, { type: "ProposeTrade", player: "ana", to: "ben", give, get });
        if (!offer.ok) return;
        const after = apply(offer.value.reduce(evolve, base), { type: "AcceptTrade", player: "ben" });
        for (const r of RESOURCES) {
          expect((after.hands.ana?.[r] ?? 0) + (after.hands.ben?.[r] ?? 0)).toBe(6);
        }
      }),
    );
  });
});
