import type { Result } from "../core/result";
import type { CatanCommand } from "../games/catan/commands";
import type { CatanEvent } from "../games/catan/events";
import { replay } from "../games/catan/evolve";
import { handle } from "../games/catan/history";
import type { CatanState } from "../games/catan/state";
import type { RuleViolation } from "../games/catan/violations";
import type { EventStore } from "./event-store";

/** Rebuilds a game's current state from its stored events. */
export async function loadGame(
  store: EventStore<CatanEvent>,
  gameId: string,
): Promise<CatanState> {
  return replay(await store.load(gameId));
}

/**
 * Runs a command against a stored game. A valid command appends its events and
 * returns the new state; a rule violation stores nothing and is returned.
 */
export async function executeCommand(
  store: EventStore<CatanEvent>,
  gameId: string,
  command: CatanCommand,
): Promise<Result<CatanState, RuleViolation>> {
  const log = await store.load(gameId);
  const outcome = handle(log, command);
  if (!outcome.ok) return outcome;

  await store.append(gameId, outcome.value.slice(log.length));
  return { ok: true, value: replay(outcome.value) };
}
