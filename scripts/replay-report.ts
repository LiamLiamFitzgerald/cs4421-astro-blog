/**
 * Replays the game attached to a browser error report (ADR-014).
 *
 *   npx jiti scripts/replay-report.ts report.json
 *
 * The file can be a whole report as logged ({ game: { events } }), the logged
 * event list on its own ("eventLog" from CloudWatch), or a plain array of
 * events. Prints how far the replay got and what, if anything, went wrong, then
 * exits 1 if the game was damaged or broke a rule. To turn a failure into a
 * regression test, copy the events into a test and replay them there.
 */
import { readFileSync } from "node:fs";
import { replayChecked } from "../src/lib/games/catan-play/integrity";

function eventsFrom(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (typeof input === "object" && input !== null) {
    const record = input as Record<string, unknown>;
    const game = record["game"];
    if (typeof game === "object" && game !== null && Array.isArray((game as Record<string, unknown>)["events"])) {
      return (game as { events: unknown[] }).events;
    }
    if (Array.isArray(record["eventLog"])) return record["eventLog"] as unknown[];
  }
  throw new Error("No event log found. Expected a report with game.events, an eventLog list, or an array.");
}

const path = process.argv[2];
if (!path) {
  console.error("Usage: npx jiti scripts/replay-report.ts <report.json>");
  process.exit(2);
}

const events = eventsFrom(JSON.parse(readFileSync(path, "utf8")));
const outcome = replayChecked(events);
const { state } = outcome;

console.log(`Events in the report: ${events.length}; applied: ${outcome.events.length}`);
console.log(`Players: ${state.players.join(", ") || "(none)"}; phase: ${state.phase}; turn ${state.turn}`);
console.log(`Winner: ${state.winner ?? "none yet"}`);
if (outcome.problems.length === 0) {
  console.log("No problems found: the log replays cleanly and every invariant holds.");
} else {
  for (const problem of outcome.problems) {
    console.log(`PROBLEM (${problem.kind}) at event ${problem.index}: ${problem.detail}`);
  }
  process.exitCode = 1;
}
