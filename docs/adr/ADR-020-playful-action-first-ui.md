# ADR-020: A playful, action-first game screen

- **Status:** Proposed (2026-10-26)
- **Deciders:** Liam Fitzgerald
- **Issues:** #141 (actions), #142 (effects and leaderboard)
- **Revises:** parts of ADR-009 (calm art direction, motion only for small
  game events). Colour roles, contrast rules and the board itself stand.

## Context

Playing a real game, and especially a room on a shared screen (ADR-019), showed
the turn panel to be text-dense: every build was listed with a note on why it
was not possible, every development card with a paragraph, and trades as forms
whether or not a trade was possible. The calm, mostly forest-green look of
ADR-009 made the one button that mattered hard to find. On the shared board,
nothing marked the big moments (the robber, a steal, a city), and there was no
quick way to see who was winning.

## Decision

1. **Show only what can be done.** The turn panel lists only the builds the
   player can afford and place, the cards they can play now, a bank trade only
   when one is possible, and a player trade only when they hold cards. What
   cannot be done is not shown; when nothing can, one line says so and End turn
   is the obvious button. The rules still refuse anything illegal (ADR-008); this
   only changes what is offered.
2. **Colour says what kind of action it is**, from the existing palette: roll is
   wheat gold, building is forest green, trading is sea blue, development cards
   are plum, ending the turn is terracotta. Each button keeps an icon and a short
   label, so colour is never the only cue, and every combination passes WCAG AA.
   The action the game is waiting for glows.
3. **Costs are icons, not words.** Notes such as "3 left" and card effect
   paragraphs are removed from buttons; the effect stays as the button's
   accessible description.
4. **Big moments are celebrated on every screen.** The robber moving, a card
   stolen, a 7, a new settlement or city, Longest Road or Largest Army changing
   hands, a new leader and a win each show a short, large banner; the board
   shakes for the robber and a 7, and the robbed player's row flashes. These are
   worked out by comparing what the screen showed before with what it shows
   now, so they work for moves made on this screen and moves pushed from others.
5. **The shared board shows a leaderboard** instead of player cards: players
   ranked by points with progress bars, rank badges and awards.
6. **Accessibility first:** with reduced motion, banners still appear but nothing
   shakes, flashes, glows or slides. Banners are hidden from screen readers
   because the same news is already announced once by the live region.

## Consequences

- Fewer words and fewer controls; the next action is obvious, which matters
  most on a phone.
- A player no longer sees why an action is unavailable (for example which
  resources a city still needs). The costs on the actions they can see, and the
  rules' message if they try something illegal, cover most of that; a "what can
  I build?" reference could return as an optional panel if missed.
- More motion than ADR-009 allowed; it is limited to real game events, short,
  and fully off with reduced motion.
- Event detection reads the screen's own before and after views, so a screen
  that was asleep does not replay everything it missed, only the latest change.
