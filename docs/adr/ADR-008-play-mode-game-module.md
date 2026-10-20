# ADR-008: Play mode as a second game module beside the scorekeeper

- **Status:** Proposed (2026-10-20)
- **Deciders:** Liam Fitzgerald

## Context

The site keeps score of a physical game (the `catan` module, ADR-003). Players
also want to play on the site: place pieces on the dealt board, roll dice,
collect resources and build, passing one device around the table.

That is a much larger rule set than scoring, with its own state (pieces on
corners and edges, hands of resources, turn order). The architecture's goal of
"rules that are plug-ins, so variants fit" (docs/architecture.md) is tested by
whether this can be added without bending the existing module.

Scope for the first version (chosen with the product owner): setup in snake
order, turns, dice, production, building with costs and legal placement, 4:1
bank trade, Longest Road from the roads on the board, and winning at 10 points.
The robber, development cards, ports and player trades are later issues.

## Decision

1. **A separate module, `src/lib/games/catan-play`,** with its own commands,
   events, state, `decide` and `evolve`. The scorekeeper is unchanged and stays
   available as the "Just keep score" mode.
2. **Shared rules are reused, not copied.** Board dealing, player-name checks,
   the seed check and the exclusive-award resolver (Longest Road) come from the
   `catan` module.
3. **The board as a graph.** `topology.ts` turns the 19 hex positions into 54
   corners and 72 edges using exact integer coordinates, so placement rules are
   graph questions with no drawing code involved.
4. **Rules as queries.** `queries.ts` answers "where can this player build?" and
   "what is the current step?". `decide` uses them to refuse commands and the UI
   uses the same functions to highlight legal spots, so no rule is written twice.
5. **Dice values are part of the command and the event.** The browser rolls
   (with `crypto.getRandomValues`) and sends the values; `decide` checks they are
   1–6. This keeps `decide` and `evolve` pure and makes a stored game replay
   exactly. Production, starting resources and turn order are derived in
   `evolve`, never stored.
6. **The UI only draws what the queries allow.** Legal corners and edges are
   drawn as keyboard-focusable buttons on the board; build buttons show the cost
   and, when disabled, what is missing (from `buildOptions`). Play mode reuses
   the scoreboard's failure handling, error reporting and confirmation dialog
   (`src/ui/feedback.ts`). The controller is `src/ui/play.ts`.
7. **One log per mode.** Each mode has its own event log in browser storage, so
   the two never mix and either can be discarded alone.

## Consequences

- Each rule is testable as Given (events) / When (command) / Then (events or a
  violation), plus property tests over random legal games, and is covered by the
  weekly mutation run.
- Adding the robber or development cards means new commands, events and
  queries in this module, without touching the scorekeeper.
- Dice are trusted from the client. That is acceptable for pass-and-play on one
  device; an online version would need the server to roll.
- Two game modules means two sets of event types. Their names overlap
  (`GameStarted`), which is fine because the logs are kept separately.

## Alternatives considered

- **Extend the scorekeeper.** Its events are scoring facts ("a settlement was
  built") with no position; adding positions and hands would change every
  existing event and test. Rejected.
- **Roll dice inside `decide`.** Makes `decide` impure and replays
  non-deterministic. Rejected.
- **Store derived data in events** (for example the resources each roll
  produced). Duplicates what `evolve` can compute and risks the two disagreeing.
  Rejected.
