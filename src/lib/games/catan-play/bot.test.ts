import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { botMove } from "./bot";
import { decide } from "./decide";
import type { PlayEvent } from "./events";
import { evolve, replayPlay } from "./evolve";
import { actingPlayer } from "./queries";
import { viewFor, withServerRandomness } from "./views";
import { initialPlayState, type PlayState } from "./state";

/** Plays bots against each other through the rules, as the server would, for up to `moves` moves. */
function playOut(players: string[], seed: number, rolls: number[], moves: number) {
  let state: PlayState = initialPlayState;
  const log: PlayEvent[] = [];
  const start = decide(state, { type: "StartGame", players, seed });
  if (!start.ok) throw new Error("start refused");
  for (const e of start.value) state = evolve(state, e);
  log.push(...start.value);
  let r = 0;
  const random = (n: number) => (rolls[r++ % rolls.length] ?? 0) % n;
  for (let i = 0; i < moves && !state.winner; i++) {
    const me = actingPlayer(state);
    if (!me) break;
    // The bot only sees what its own phone would.
    const command = botMove(viewFor(state, me).state, me);
    if (!command) return { state, log, stuck: true as const };
    const decision = decide(state, withServerRandomness(command, state, random));
    if (!decision.ok) return { state, log, refused: decision.error, command };
    for (const e of decision.value) state = evolve(state, e);
    log.push(...decision.value);
  }
  return { state, log };
}

describe("Feature: a simple bot for load tests", () => {
  it("given any game, every move the bot proposes from its own view is accepted by the rules", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 4 }),
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 20 }),
        (count, seed, rolls) => {
          const result = playOut(["A", "B", "C", "D"].slice(0, count), seed, rolls, 400);
          expect(result).not.toHaveProperty("refused");
          expect(result).not.toHaveProperty("stuck");
        },
      ),
      { numRuns: 25 },
    );
  });

  it("given a long game, gets past setup into real turns", () => {
    const { log } = playOut(["A", "B", "C"], 7, [3, 4, 2, 5, 1, 0], 300);
    expect(log.some((e) => e.type === "DiceRolled")).toBe(true);
    expect(log.some((e) => e.type === "RoadBuilt" || e.type === "SettlementBuilt")).toBe(true);
    expect(log.length).toBeGreaterThan(100);
  });

  it("given it is someone else's move, or no game, proposes nothing", () => {
    const { state } = playOut(["A", "B"], 1, [0], 0);
    const other = actingPlayer(state) === "A" ? "B" : "A";
    expect(botMove(state, other)).toBeNull();
    expect(botMove(initialPlayState, "A")).toBeNull();
    expect(botMove(replayPlay([]), "A")).toBeNull();
  });
});
