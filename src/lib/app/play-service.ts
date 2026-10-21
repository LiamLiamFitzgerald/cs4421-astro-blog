import type { Result } from "../core/result";
import type { PlayCommand } from "../games/catan-play/commands";
import { decide } from "../games/catan-play/decide";
import type { PlayEvent } from "../games/catan-play/events";
import { replayPlay } from "../games/catan-play/evolve";
import type { PlayState } from "../games/catan-play/state";
import type { PlayViolation } from "../games/catan-play/violations";
import type { EventStore } from "./event-store";

/** Rebuilds a played game's current state from its stored events. */
export async function loadPlay(store: EventStore<PlayEvent>, gameId: string): Promise<PlayState> {
  return replayPlay(await store.load(gameId));
}

/**
 * Runs a command against a stored played game. A valid command appends its
 * events and returns the new state; a rule violation stores nothing.
 */
export async function executePlayCommand(
  store: EventStore<PlayEvent>,
  gameId: string,
  command: PlayCommand,
): Promise<Result<{ state: PlayState; events: readonly PlayEvent[] }, PlayViolation>> {
  const log = await store.load(gameId);
  const decision = decide(replayPlay(log), command);
  if (!decision.ok) return decision;
  await store.append(gameId, decision.value);
  return { ok: true, value: { state: replayPlay([...log, ...decision.value]), events: decision.value } };
}
