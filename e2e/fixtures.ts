/**
 * Builds stored games for browser tests by playing the real rules in Node, so
 * a test can start from an interesting position (for example a player holding
 * a knight) without clicking through dozens of turns. Every event comes from
 * `decide`, so the log is exactly what the site would have stored.
 */
import type { PlayCommand } from "../src/lib/games/catan-play/commands";
import type { DevCard } from "../src/lib/games/catan-play/dev-cards";
import type { PlayEvent } from "../src/lib/games/catan-play/events";
import { decide } from "../src/lib/games/catan-play/decide";
import { replayPlay } from "../src/lib/games/catan-play/evolve";
import { tradeableResources } from "../src/lib/app/play-view";
import { currentPlayer, expectedStep, playableCardIndex } from "../src/lib/games/catan-play/queries";
import { completeSetup, play, resolvePending } from "../src/lib/games/catan-play/test-helpers";

const tryCommand = (log: PlayEvent[], command: PlayCommand): PlayEvent[] => {
  const result = decide(replayPlay(log), command);
  return result.ok ? [...log, ...result.value] : log;
};

/**
 * Plays turns (rolling, trading towards a card, buying cards) until it is the
 * start of someone's turn and they can play `card`. Returns the log and who.
 */
export function gameWithPlayableCard(card: DevCard, players = ["Ana", "Ben"], seed = 42): { log: PlayEvent[]; player: string } {
  let log = completeSetup(play([{ type: "StartGame", players, seed }]));
  const rolls: [number, number][] = [[3, 3], [4, 4], [2, 3], [5, 4], [6, 4], [2, 2], [5, 6], [3, 1], [1, 1], [6, 6]];
  for (let turn = 0; turn < 400; turn++) {
    const state = replayPlay(log);
    const player = currentPlayer(state) ?? "";
    if (expectedStep(state) === "roll" && playableCardIndex(state, player, card) >= 0) return { log, player };
    log = resolvePending(play([{ type: "RollDice", player, dice: rolls[turn % rolls.length] ?? [3, 3] }], log));
    for (let i = 0; i < 6; i++) {
      const s = replayPlay(log);
      const give = tradeableResources(s.hands[player] ?? { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 })[0];
      const need = (["ore", "wool", "grain"] as const).find((r) => (s.hands[player]?.[r] ?? 0) === 0);
      if (give && need && give !== need) log = tryCommand(log, { type: "TradeWithBank", player, give, get: need });
      log = tryCommand(log, { type: "BuyDevelopmentCard", player });
    }
    log = play([{ type: "EndTurn", player }], log);
  }
  throw new Error(`No playable ${card} within 400 turns`);
}

/** A game that has finished setup and is waiting for the first roll. */
export function openingLog(players = ["Ana", "Ben"], seed = 42): PlayEvent[] {
  return completeSetup(play([{ type: "StartGame", players, seed }]));
}
