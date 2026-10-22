import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generateBoard } from "../catan/board";
import { decide } from "./decide";
import type { PlayEvent } from "./events";
import { replayPlay } from "./evolve";
import { currentPlayer, expectedStep, production } from "./queries";
import { BANK_START, emptyHand, hand, PRODUCES, RESOURCES } from "./resources";
import { initialPlayState, type PlayState } from "./state";
import { completeSetup, play, resolvePending } from "./test-helpers";
import { TOPOLOGY } from "./topology";

const afterSetup = (players = ["ana", "ben", "cy"], seed = 4) =>
  completeSetup(play([{ type: "StartGame", players, seed }]));

const when = (log: readonly PlayEvent[], command: Parameters<typeof decide>[1]) => decide(replayPlay(log), command);

describe("Feature: rolling the dice", () => {
  it("given the start of a turn, a roll is accepted and building is next", () => {
    const log = play([{ type: "RollDice", player: "ana", dice: [2, 4] }], afterSetup());
    const state = replayPlay(log);
    expect(log.at(-1)).toEqual({ type: "DiceRolled", player: "ana", dice: [2, 4] });
    expect(state.lastRoll).toMatchObject({ player: "ana", dice: [2, 4], total: 6 });
    expect(expectedStep(state)).toBe("build-or-end");
  });

  it("given the dice were rolled, rolling again is refused", () => {
    const log = play([{ type: "RollDice", player: "ana", dice: [1, 2] }], afterSetup());
    expect(when(log, { type: "RollDice", player: "ana", dice: [1, 2] })).toEqual({
      ok: false,
      error: { code: "WRONG_STEP", expected: "build-or-end" },
    });
  });

  it("given it is ana's turn, ben cannot roll", () => {
    expect(when(afterSetup(), { type: "RollDice", player: "ben", dice: [1, 2] })).toEqual({
      ok: false,
      error: { code: "NOT_YOUR_TURN", player: "ben", current: "ana" },
    });
  });

  it("given setup is not finished, rolling is refused", () => {
    const log = play([{ type: "StartGame", players: ["ana", "ben"], seed: 1 }]);
    expect(when(log, { type: "RollDice", player: "ana", dice: [1, 2] })).toEqual({
      ok: false,
      error: { code: "WRONG_STEP", expected: "place-settlement" },
    });
  });

  it.each([
    [[0, 3]],
    [[7, 1]],
    [[1.5, 2]],
    [[2, Number.NaN]],
    [[1, 2, 3]],
    [[4]],
  ])("given dice %j, the roll is refused", (dice) => {
    expect(when(afterSetup(), { type: "RollDice", player: "ana", dice: dice as unknown as [number, number] })).toEqual({
      ok: false,
      error: { code: "INVALID_DICE", dice },
    });
  });

  it.each([
    [1, 1],
    [6, 6],
  ])("given dice [%i, %i], the roll is accepted", (a, b) => {
    expect(when(afterSetup(), { type: "RollDice", player: "ana", dice: [a, b] }).ok).toBe(true);
  });
});

describe("Feature: ending a turn", () => {
  it("given the dice were rolled, ending the turn passes play to the next player", () => {
    const log = play(
      [
        { type: "RollDice", player: "ana", dice: [1, 2] },
        { type: "EndTurn", player: "ana" },
      ],
      afterSetup(),
    );
    const state = replayPlay(log);
    expect(currentPlayer(state)).toBe("ben");
    expect(expectedStep(state)).toBe("roll");
  });

  it("given the last seat ends their turn, play wraps round to player 1", () => {
    let log = afterSetup(["ana", "ben"]);
    for (const player of ["ana", "ben"]) {
      log = play(
        [
          { type: "RollDice", player, dice: [1, 2] },
          { type: "EndTurn", player },
        ],
        log,
      );
    }
    expect(currentPlayer(replayPlay(log))).toBe("ana");
  });

  it("given the dice have not been rolled, ending the turn is refused", () => {
    expect(when(afterSetup(), { type: "EndTurn", player: "ana" })).toEqual({
      ok: false,
      error: { code: "WRONG_STEP", expected: "roll" },
    });
  });
});

describe("Feature: production", () => {
  const board = generateBoard(11);
  const producing = board.hexes.find((h) => h.token !== null && h.token !== 6 && h.token !== 8) ?? board.hexes[0];
  const key = `${producing?.q},${producing?.r}`;
  const corners = TOPOLOGY.hexCorners[key] ?? [];
  const resource = PRODUCES[producing?.terrain ?? "desert"] ?? "lumber";
  const base: PlayState = {
    ...initialPlayState,
    started: true,
    board,
    players: ["ana", "ben"],
    phase: "roll",
    hands: { ana: emptyHand, ben: emptyHand },
    buildings: {
      [corners[0] ?? 0]: { player: "ana", kind: "settlement" },
      [corners[3] ?? 0]: { player: "ben", kind: "city" },
    },
  };
  const token = producing?.token ?? 0;

  it("given a settlement and a city on a hex with the rolled number, they get exactly 1 and 2", () => {
    // Only this hex: other hexes with the same number must not add to the count.
    const single: PlayState = { ...base, board: { hexes: board.hexes.filter((h) => h === producing) } };
    const { produced, shortages } = production(single, token);
    expect(produced.ana).toEqual(hand({ [resource]: 1 }));
    expect(produced.ben).toEqual(hand({ [resource]: 2 }));
    expect(shortages).toEqual([]);
  });

  it.each([
    ["forest", "lumber"],
    ["hills", "brick"],
    ["pasture", "wool"],
    ["fields", "grain"],
    ["mountains", "ore"],
  ] as const)("given %s, it produces %s", (terrain, produces) => {
    const corner = TOPOLOGY.hexCorners["0,0"]?.[0] ?? 0;
    const one: PlayState = {
      ...base,
      board: { hexes: [{ q: 0, r: 0, terrain, token: 9 }] },
      buildings: { [corner]: { player: "ana", kind: "settlement" } },
    };
    expect(production(one, 9).produced.ana).toEqual(hand({ [produces]: 1 }));
  });

  it("given a number no hex shows next to them, nothing is produced", () => {
    const unused = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12].find(
      (n) => !board.hexes.some((h) => h.token === n && (TOPOLOGY.hexCorners[`${h.q},${h.r}`] ?? []).some((c) => base.buildings[c])),
    );
    const { produced } = production(base, unused ?? 2);
    expect(produced).toEqual({ ana: emptyHand, ben: emptyHand });
  });

  it("given a 7, nothing is produced", () => {
    expect(production(base, 7).produced).toEqual({ ana: emptyHand, ben: emptyHand });
  });

  it("given the desert, it never produces, even if it had a number", () => {
    const desert = board.hexes.find((h) => h.terrain === "desert");
    const corner = TOPOLOGY.hexCorners[`${desert?.q},${desert?.r}`]?.[0] ?? 0;
    const desertOnly: PlayState = {
      ...base,
      board: { hexes: [{ q: desert?.q ?? 0, r: desert?.r ?? 0, terrain: "desert", token: 5 }] },
      buildings: { [corner]: { player: "ana", kind: "city" } },
    };
    expect(production(desertOnly, 5).produced.ana).toEqual(emptyHand);
  });

  it("given the bank cannot pay two players, neither gets that resource", () => {
    const short: PlayState = { ...base, bank: hand({ ...BANK_START, [resource]: 1 }) };
    const { produced, shortages } = production(short, token);
    expect(produced.ana?.[resource]).toBe(0);
    expect(produced.ben?.[resource]).toBe(0);
    expect(shortages).toEqual([resource]);
  });

  it("given the bank cannot pay one player in full, they get what is left", () => {
    const solo: PlayState = {
      ...base,
      buildings: { [corners[0] ?? 0]: { player: "ana", kind: "city" } },
      bank: hand({ ...BANK_START, [resource]: 1 }),
    };
    const { produced, shortages } = production(solo, token);
    expect(produced.ana?.[resource]).toBe(1);
    expect(shortages).toEqual([resource]);
  });

  it("given the bank has exactly enough, everyone is paid", () => {
    const demand = (production(base, token).produced.ana?.[resource] ?? 0) + (production(base, token).produced.ben?.[resource] ?? 0);
    const exact: PlayState = { ...base, bank: hand({ ...BANK_START, [resource]: demand }) };
    expect(production(exact, token).shortages).toEqual([]);
  });

  it("given a roll, produced resources move from the bank to the players", () => {
    const state = replayPlay(play([{ type: "RollDice", player: "ana", dice: [Math.min(6, token - 1), token - Math.min(6, token - 1)] }], afterSetup(["ana", "ben"], 11)));
    for (const r of RESOURCES) {
      const held = state.players.reduce((n, p) => n + (state.hands[p]?.[r] ?? 0), 0);
      expect(state.bank[r] + held).toBe(19);
    }
  });
});

describe("Feature: resources are conserved (property)", () => {
  it("over any sequence of rolls, bank plus hands always holds 19 of each resource", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        fc.array(fc.tuple(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 6 })), { maxLength: 40 }),
        (seed, rolls) => {
          let log = afterSetup(["ana", "ben", "cy"], seed);
          for (const dice of rolls) {
            const player = currentPlayer(replayPlay(log)) ?? "";
            log = resolvePending(play([{ type: "RollDice", player, dice }], log));
            log = play([{ type: "EndTurn", player }], log);
          }
          const state = replayPlay(log);
          for (const r of RESOURCES) {
            const held = state.players.reduce((n, p) => n + (state.hands[p]?.[r] ?? 0), 0);
            expect(state.bank[r] + held).toBe(19);
            expect(state.bank[r]).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
