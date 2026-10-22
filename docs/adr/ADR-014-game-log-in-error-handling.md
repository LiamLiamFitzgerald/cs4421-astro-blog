# ADR-014: Use the game's event log in error handling

- **Status:** Proposed (2026-10-22)
- **Deciders:** Liam Fitzgerald
- **Issue:** #114
- **Builds on:** ADR-004 (event sourcing), ADR-006 (browser storage), ADR-007
  (error handling) and the `/api/client-errors` endpoint.

## Context

Played games are event-sourced: the state is a pure fold over an ordered log
(ADR-004). That makes the log a complete, replayable record of how a game got
where it is. The error handling built so far ignored this:

- A browser error report said what failed (`context`, `name`, `message`, `page`)
  but not which game or how it got there, so a bug could not be reproduced.
- A damaged save was handled by `LocalStorageEventStore.load`, which treats
  unparseable data as an empty game. An unknown or unapplicable event inside an
  otherwise good log was not handled at all: replay would throw and the page
  would fail.
- Nothing checked that the rules kept their promises (cards are conserved, the
  piece limits hold). A bug that created a card would go unnoticed.

## Decision

1. **Reports carry the game.** A report may include `game`: `{ id, version,
   eventCount, events }`. The browser attaches the last loaded log of the game on
   screen. `events` is left out (with `eventsOmitted`) when it exceeds 24,000 JSON
   characters or 2,000 events. The server logs `gameId`, `gameLogVersion`,
   `gameEvents` and `eventLog` on the same JSON line as the error, so one search
   by game id finds every report from that game. The report size limit rose from
   4 KB to 32 KB; field limits are unchanged.
2. **Defensive replay.** `replayChecked` replays a stored log event by event. An
   event the rules do not know, or one that throws when applied, ends the replay
   at the last good event. `SalvagingPlayStore` wraps the browser store: it cuts
   the saved game back to that point, tells the player ("restored to move N"), and
   reports the damage once, with the **full original log** attached so the lost
   moves can still be examined.
3. **Invariants.** After each event the replay checks that every resource totals
   19 across bank and hands and never goes negative, that pieces sit on real
   corners and edges within the piece limits, that the current seat exists and
   that the robber is on the board. A broken invariant is a bug, not a player's
   mistake: it is reported with the log but nothing is cut back, because the game
   is still playable and the bug needs the whole log. The same check runs after
   every command in the test helper, so all rules tests assert the invariants for
   free.
4. **Replay tool.** `npx jiti scripts/replay-report.ts report.json` replays the
   log in a logged report, prints where it stopped and why, and exits 1 on a
   problem. The path is: alarm, log line, game id, event log, replay, regression
   test, fix.
5. **Version.** Reports carry `PLAY_LOG_VERSION` (1). Bump it when an event
   changes in a way old logs cannot be read.

## Consequences

- A bug seen in the field can be replayed locally and turned into a test.
- A damaged save loses only the moves after the damage, and the player is told.
- Every report from one game can be found by its id; with shared rooms the same
  ids point at a server-side log and the attachment becomes unnecessary.
- **Privacy:** the log contains the player names typed into the game, the board
  and every move, including hidden victory-point cards. There is no account or
  contact detail. The names can still be personal data if someone types a real
  one, so logs are kept for a limited time (the retention work in #115) and the
  handbook says what a report contains.
- Replaying with checks does more work per load. A game is a few hundred events,
  so this is negligible; it would need revisiting for much longer logs.
- **Limits, stated plainly:**
  - Stored events do not carry a version each. The version travels with the
    report, and unknown events are cut off, so a downgrade is handled safely, but
    there is no migration path for changed events yet.
  - If the whole stored value is not valid JSON, `LocalStorageEventStore` still
    returns an empty game before any of this runs. Salvaging that would mean
    keeping the raw text; left for later.
  - A log over the size limit is not attached; only its length is reported.

## Alternatives considered

- **Send only a game id.** Smaller, but while games live in the browser the
  server cannot look the log up, so the id alone could not reproduce anything.
- **Send a state snapshot instead of the log.** Smaller to read, but a snapshot
  shows where the game is, not how it got there, and it cannot be replayed.
- **Fail loudly on a damaged save.** Simple, but a single bad event would cost
  the player the whole game.
- **Cut back on a broken invariant too.** That would destroy the evidence and
  punish the player for the rules' bug.
