# ADR-011: Completing the base game: interruptions, hidden choices and randomness

- **Status:** Proposed (2026-10-21)
- **Deciders:** Liam Fitzgerald
- **Issues:** #96 robber, #97 development cards, #98 harbours, #99 player trades

## Context

The first version of play mode (ADR-008) had a simple turn: roll, then build or
trade, then end. The rest of the base game breaks that shape:

- After a 7, *other* players may have to act (discard half their cards) before
  the roller moves the robber and steals.
- A knight moves the robber too, and can be played before rolling.
- Stealing takes a *random* card; development cards come from a *shuffled* deck.
- A trade offer needs the *other* player to accept or decline.

`decide` and `evolve` must stay pure (ADR-003), and every stored game must
replay exactly.

## Decision

1. **Interruptions are explicit state.** `PlayState.pending` holds at most one
   interruption (discard, move robber, steal, and later trade offers). While it
   is set, `expectedStep` returns its step and only that command is accepted.
   Each interruption remembers where play resumes (`roll` or `build-or-end`), so
   a knight played before rolling returns to the roll.
2. **Who acts is a query, not the turn owner.** `actingPlayer(state)` answers
   "whose input is needed now": during discards it is the next player in seat
   order (from the roller) who still owes cards; otherwise the current player.
   `decide` checks commands against it, and the UI titles the turn panel with it.
3. **Randomness comes from the caller; the result is the fact.** The browser
   draws a random index with `crypto.getRandomValues` and sends it (`pick` for a
   steal). `decide` checks it is in range and records the *outcome* in the event
   (`CardStolen { resource }`), never the index. Shuffled things (the development
   card deck, harbour types) are dealt from the game seed when the game starts
   and stored in `GameStarted`, like the board.
4. **Derived amounts are computed, not stored.** Who owes how many cards, who can
   be robbed, and what a monopoly collects are worked out in `evolve` from the
   state; events record only the decisions people made.
5. **One device, so no secrecy.** Pass-and-play shows every hand. Hidden
   information (which card was stolen, unplayed victory point cards) is kept out
   of the shared event log text and the public points, but is not hidden from
   someone looking at the screen.

## Consequences

- Each rule is still a Given (events) / When (command) / Then (events or a
  violation) test, and property tests can resolve interruptions automatically to
  play long random games.
- The browser is trusted to roll and pick fairly. That is fine on one device; an
  online version would move rolling and picking to the server.
- Old saved games without the new fields still load: the robber defaults to the
  desert, and games without a stored deck or harbours simply have none.

## Alternatives considered

- **Random numbers inside `decide`.** Impure and unreplayable. Rejected.
- **Storing the random index in the event.** Replays would depend on the hand
  order never changing. Storing the outcome is simpler and safer. Rejected.
- **A separate state machine library.** More machinery than one `pending` field
  and a query for the acting player. Rejected.
