# ADR-009: Art direction: colour roles, fewer cards, and a board that feels physical

- **Status:** Proposed (2026-10-21)
- **Deciders:** Liam Fitzgerald
- **Issue:** #100

## Context

ADR-007 set up the design system. An art direction brief then asked for a
calmer, more premium result: parchment and ivory, forest green for navigation
and primary actions, sage for secondary surfaces, slate and sand as accents,
the board as the only colourful object, and far fewer boxed cards.

Reviewing screenshots against the brief showed five gaps: primary buttons used
terracotta, there was no sage or slate, every player and every resource count
sat in its own card, the board looked flat, and pieces on the board showed
ownership by colour only.

## Decision

1. **Every colour has one named role in `tokens.css`** (backgrounds, sage,
   text and lines, forest, accents, feedback, board, seats). Components use the
   role, not a raw value. Pastures move to sage, mountains to slate.
2. **Forest green is the primary action; terracotta becomes an accent.** A new
   destructive style (brick red) is used for "Discard and start over".
   Disabled buttons keep legible text on a sunk, dashed surface instead of
   fading to 50% opacity.
3. **One surface per list.** Players share a `.stack` surface separated by
   lines, with a seat-colour edge; the current player sits on sage. Resource
   counts are no longer individual boxes.
4. **The board is a physical object:** a soft drop shadow, a fine coast line
   inside the sea frame, a faint bevel on each tile, and number tokens drawn
   as discs with a shadow and inner ring.
5. **Seat numbers on every settlement and city**, so ownership never relies
   on colour alone. Seat colours were chosen to pass 4.5:1 against white.
6. **Motion only for game events:** a piece settles into place when built,
   and resources just received glow briefly with a "+n" badge. Legal spots
   breathe gently rather than pulse. All of it is off with reduced motion and
   nothing depends on it, because the same change is announced as text.
7. **Numbers use lining, tabular figures** so scores and counts line up.

## Consequences

- The look changes in one file (`tokens.css`) plus a few shared classes, so
  later screens inherit it.
- Removing cards removed visual noise without removing information; the e2e
  tests did not need to change.
- Seat numbers on pieces are small (about 10px). They are a backup to colour,
  with full names in each piece's tooltip and text alternative.

## Alternatives considered

- **Textured, illustrated tiles** (wood grain, painted terrain). More
  atmospheric but heavier to load, harder to keep legible, and against the
  brief's "nearly imperceptible" texture rule. Rejected.
- **Keeping terracotta as the primary colour.** It competed with the hills
  tiles and with error states. Rejected.
