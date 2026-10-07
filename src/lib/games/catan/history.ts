import type { Result } from "../../core/result";
import type { CatanCommand } from "./commands";
import { decide } from "./decide";
import type { CatanEvent } from "./events";
import { replay } from "./evolve";
import type { RuleViolation } from "./violations";

/** The log without its last event. Replaying it gives the previous state. */
export function undo(log: readonly CatanEvent[]): CatanEvent[] {
  return log.slice(0, -1);
}

/**
 * Runs a command against a log. On success returns the log with the new events
 * appended; on a rule violation returns the error and the log is unchanged.
 */
export function handle(
  log: readonly CatanEvent[],
  command: CatanCommand,
): Result<readonly CatanEvent[], RuleViolation> {
  const decision = decide(replay(log), command);
  if (!decision.ok) return decision;
  return { ok: true, value: [...log, ...decision.value] };
}
