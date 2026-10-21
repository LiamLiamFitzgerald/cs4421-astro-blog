import type { PlayCommand } from "./commands";
import { decide } from "./decide";
import type { PlayEvent } from "./events";
import { replayPlay } from "./evolve";
import { legalSetupRoads, legalSetupSettlements, currentPlayer } from "./queries";
import type { PlayState } from "./state";

/** Test helper: applies commands in order and fails loudly on the first refusal. */
export function play(commands: readonly PlayCommand[], from: readonly PlayEvent[] = []): PlayEvent[] {
  const log = [...from];
  for (const command of commands) {
    const result = decide(replayPlay(log), command);
    if (!result.ok) throw new Error(`${command.type} refused: ${JSON.stringify(result.error)}`);
    log.push(...result.value);
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
