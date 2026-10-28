import type { PlayCommand } from "./commands";
import { decide } from "./decide";
import type { PlayEvent } from "./events";
import { replayPlay } from "./evolve";
import { actingPlayer, currentPlayer, expectedStep, legalRobberHexes, legalSetupRoads, legalSetupSettlements } from "./queries";
import { emptyHand, RESOURCES, type Resource } from "./resources";
import type { PlayState } from "./state";
import { checkInvariants } from "./integrity";

/** Test helper: applies commands in order and fails loudly on the first refusal. */
export function play(commands: readonly PlayCommand[], from: readonly PlayEvent[] = []): PlayEvent[] {
  const log = [...from];
  for (const command of commands) {
    const result = decide(replayPlay(log), command);
    if (!result.ok) throw new Error(`${command.type} refused: ${JSON.stringify(result.error)}`);
    log.push(...result.value);
    const broken = checkInvariants(replayPlay(log));
    if (broken.length > 0) throw new Error(`invariant broken after ${command.type}: ${broken.join('; ')}`);
  }
  return log;
}

/** Test helper: completes setup, each time picking the `pick`-th legal spot. */
export function completeSetup(log: readonly PlayEvent[], pick: (count: number, turn: number) => number = () => 0): PlayEvent[] {
  let events = [...log];
  for (let turn = 0; replayPlay(events).phase === "setup"; turn++) {
    const state: PlayState = replayPlay(events);
    const player = currentPlayer(state) ?? "";
    const corners = legalSetupSettlements(state);
    const vertex = corners[pick(corners.length, turn) % corners.length] ?? -1;
    events = play([{ type: "PlaceSetupSettlement", player, vertex }], events);
    const roads = legalSetupRoads(replayPlay(events));
    const edge = roads[pick(roads.length, turn) % roads.length] ?? -1;
    events = play([{ type: "PlaceSetupRoad", player, edge }], events);
  }
  return events;
}

/**
 * Test helper: if the robber has interrupted play (discard, move, steal),
 * resolves it with simple legal choices so random games can carry on.
 */
export function resolvePending(log: readonly PlayEvent[]): PlayEvent[] {
  let events = [...log];
  for (let guard = 0; guard < 20; guard++) {
    const state = replayPlay(events);
    const step = expectedStep(state);
    const actor = actingPlayer(state) ?? "";
    if (step === "discard" && state.pending?.kind === "discard") {
      const owed = state.pending.owed[actor] ?? 0;
      const held = state.hands[actor] ?? emptyHand;
      const cards: Record<Resource, number> = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
      let left = owed;
      for (const r of RESOURCES) {
        const take = Math.min(left, held[r]);
        cards[r] = take;
        left -= take;
      }
      events = play([{ type: "DiscardCards", player: actor, cards }], events);
    } else if (step === "move-robber") {
      events = play([{ type: "MoveRobber", player: actor, hex: legalRobberHexes(state)[0] ?? "" }], events);
    } else if (step === "steal" && state.pending?.kind === "steal") {
      events = play([{ type: "StealFrom", player: actor, victim: state.pending.victims[0] ?? "", pick: 0 }], events);
    } else {
      return events;
    }
  }
  throw new Error("robber steps did not resolve");
}
