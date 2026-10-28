import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { LARGEST_ARMY_THRESHOLD, LONGEST_ROAD_THRESHOLD } from "./awards";
import type { CatanCommand } from "./commands";
import { decide } from "./decide";
import type { CatanEvent } from "./events";
import { evolve, replay } from "./evolve";
import { handle, undo } from "./history";
import { initialState, type CatanState } from "./state";
import { baseScoreboard, totalPoints, WINNING_POINTS } from "./score";

const PLAYERS = ["ana", "ben", "cy"] as const;
const RUNS = { numRuns: 200 };

const player = fc.constantFrom(...PLAYERS);

/** Mostly sensible commands, with some invalid ones mixed in. */
const command: fc.Arbitrary<CatanCommand> = fc.oneof(
  { weight: 4, arbitrary: player.map((p) => ({ type: "BuildSettlement", player: p }) as const) },
  { weight: 3, arbitrary: player.map((p) => ({ type: "UpgradeSettlement", player: p }) as const) },
  { weight: 3, arbitrary: player.map((p) => ({ type: "RevealVictoryPointCard", player: p }) as const) },
  { weight: 3, arbitrary: player.map((p) => ({ type: "PlayKnight", player: p }) as const) },
  {
    weight: 3,
    arbitrary: fc
      .tuple(player, fc.integer({ min: 0, max: 15 }))
      .map(([p, length]) => ({ type: "RecordRoadLength", player: p, length }) as const),
  },
  {
    weight: 1,
    arbitrary: fc
      .tuple(player, fc.integer({ min: -5, max: 25 }))
      .map(([p, length]) => ({ type: "RecordRoadLength", player: p, length }) as const),
  },
  { weight: 1, arbitrary: fc.constant({ type: "PlayKnight", player: "zed" } as const) },
);

/** `size: "max"` makes arrays use the full length, so games get long enough to finish. */
const commands = fc.array(command, { maxLength: 150, size: "max" });

/** Ten points for ana: 5 settlements + 5 VP cards. */
const ANA_WINS: CatanCommand[] = [
  ...Array.from({ length: 5 }, () => ({ type: "BuildSettlement", player: "ana" }) as const),
  ...Array.from({ length: 5 }, () => ({ type: "RevealVictoryPointCard", player: "ana" }) as const),
];

/** Runs commands one by one, keeping only the ones the rules accept. */
function play(sequence: readonly CatanCommand[]): CatanEvent[] {
  const log: CatanEvent[] = [];
  let state = initialState;
  for (const next of [{ type: "StartGame", players: [...PLAYERS] } as const, ...sequence]) {
    const decision = decide(state, next);
    if (!decision.ok) continue;
    for (const event of decision.value) {
      log.push(event);
      state = evolve(state, event);
    }
  }
  return log;
}

function prefixStates(log: readonly CatanEvent[]): CatanState[] {
  const states: CatanState[] = [];
  let state = initialState;
  for (const event of log) {
    state = evolve(state, event);
    states.push(state);
  }
  return states;
}

describe("Feature: properties that hold for any game", () => {
  describe("Scenario: replay", () => {
    it("given any valid log, replaying it is deterministic and matches step-by-step evolve", () => {
      fc.assert(
        fc.property(commands, (sequence) => {
          const log = play(sequence);

          expect(replay(log)).toEqual(replay(log));
          const stepped = log.reduce(evolve, initialState);
          expect(stepped).toEqual(replay(log));
        }),
        RUNS,
      );
    });

    it("given any valid log, no tally is ever negative", () => {
      fc.assert(
        fc.property(commands, (sequence) => {
          const state = replay(play(sequence));

          for (const tally of Object.values(state.players)) {
            expect(Math.min(...Object.values(tally))).toBeGreaterThanOrEqual(0);
          }
        }),
        RUNS,
      );
    });
  });

  describe("Scenario: awards", () => {
    it("given any valid log, an award holder always has the highest count and meets the threshold", () => {
      fc.assert(
        fc.property(commands, (sequence) => {
          const state = replay(play(sequence));
          const tallies = Object.values(state.players);

          const check = (
            holder: string | null,
            pick: (t: (typeof tallies)[number]) => number,
            threshold: number,
          ) => {
            const counts = tallies.map(pick);
            const max = Math.max(...counts);
            if (holder === null) {
              const leaders = counts.filter((c) => c === max).length;
              expect(max < threshold || leaders > 1).toBe(true);
            } else {
              const held = pick(state.players[holder]!);
              expect(held).toBeGreaterThanOrEqual(threshold);
              expect(held).toBe(max);
            }
          };

          check(state.largestArmy, (t) => t.knights, LARGEST_ARMY_THRESHOLD);
          check(state.longestRoad, (t) => t.roadLength, LONGEST_ROAD_THRESHOLD);
        }),
        RUNS,
      );
    });
  });

  describe("Scenario: scoring", () => {
    it("given any valid log, each total is base points plus awards worth 2 each", () => {
      fc.assert(
        fc.property(commands, (sequence) => {
          const state = replay(play(sequence));
          const base = baseScoreboard(state);

          for (const id of PLAYERS) {
            const awards =
              (state.largestArmy === id ? 2 : 0) + (state.longestRoad === id ? 2 : 0);
            expect(totalPoints(state, id)).toBe(base[id]! + awards);
          }
        }),
        RUNS,
      );
    });
  });

  describe("Scenario: winning", () => {
    it("given any valid log, the winner is declared exactly when someone first reaches the winning total", () => {
      fc.assert(
        fc.property(commands, (sequence) => {
          const states = prefixStates(play(sequence));
          const firstWon = states.findIndex((s) => s.winner !== null);

          states.forEach((state, i) => {
            const someoneAtTotal = PLAYERS.some(
              (id) => totalPoints(state, id) >= WINNING_POINTS,
            );
            if (firstWon === -1 || i < firstWon) {
              expect(state.winner).toBeNull();
              expect(someoneAtTotal).toBe(false);
            } else if (i === firstWon) {
              expect(someoneAtTotal).toBe(true);
              expect(totalPoints(state, state.winner!)).toBeGreaterThanOrEqual(WINNING_POINTS);
            } else {
              expect(state.winner).toBe(states[firstWon]!.winner);
            }
          });
        }),
        RUNS,
      );
    });

    it("given a finished game, every further command is refused", () => {
      fc.assert(
        fc.property(commands, command, (sequence, extra) => {
          const log = play([...ANA_WINS, ...sequence]);
          expect(replay(log).winner).not.toBeNull();

          const outcome = handle(log, extra);

          expect(outcome).toMatchObject({ ok: false, error: { code: "GAME_OVER" } });
        }),
        RUNS,
      );
    });
  });

  describe("Scenario: undo and refused commands", () => {
    it("given an accepted command, undo returns the log to how it was", () => {
      fc.assert(
        fc.property(commands, command, (sequence, extra) => {
          const log = play(sequence);
          const outcome = handle(log, extra);
          fc.pre(outcome.ok);

          if (outcome.ok) expect(undo(outcome.value)).toEqual(log);
        }),
        RUNS,
      );
    });

    it("given a refused command, the log is untouched", () => {
      fc.assert(
        fc.property(commands, command, (sequence, extra) => {
          const log = play(sequence);
          const copy = JSON.stringify(log);
          const outcome = handle(log, extra);
          fc.pre(!outcome.ok);

          expect(JSON.stringify(log)).toBe(copy);
        }),
        RUNS,
      );
    });
  });

  it("is able to generate games that reach a winner (the generator is not vacuous)", () => {
    const wins = fc.sample(commands, 300).filter((s) => replay(play(s)).winner !== null);

    expect(wins.length).toBeGreaterThan(0);
  });
});
