# ADR-007: One design system for every page, with the board as the only colourful element

- **Status:** Proposed (2026-10-20); colour roles and component changes refined by ADR-009
- **Deciders:** Liam Fitzgerald

## Context

The site started as the Astro blog template. Its styles, fonts and components
were a starter kit, not a design, and each new page (the scoreboard) added its
own one-off CSS. That is the kind of drift that makes a UI hard to maintain:
the same button looked different on two pages, colours were typed as raw
values, and there were no shared error or empty states.

The template has been removed (#74). The site needs a visual identity and, more
importantly for this project, one place where it is defined so that new pages
inherit it instead of copying it.

Brief: warm ivory backgrounds, deep forest-green navigation, muted terracotta
accents, a subtle parchment texture and crisp typography. The board should be
colourful and prominent; the interface around it should be restrained.

## Decision

1. **Tokens in one file.** `src/styles/tokens.css` defines every colour, the
   type scale (ratio 1.25 on a 17px base), spacing (4px steps), three radii
   (controls, panels, round), two shadows and motion durations as CSS custom
   properties. Components use the variables, never raw values.
2. **Shared component classes in `src/styles/base.css`:** `.button` (with
   `--primary`, `--quiet`, `--small`), `.input`, `.field`, `.notice` (info,
   `--success`, `--error`), `.panel` and `.dialog`. Each has hover, focus,
   active and disabled states. The focus ring is a single 3px outline used
   everywhere.
3. **One layout.** `src/layouts/Layout.astro` gives every page the same head,
   skip link, header, navigation and footer. Navigation items and site
   constants live in `src/consts.ts`.
4. **One icon set.** `src/ui/icons.ts` holds 24×24 stroke icons. `Icon.astro`
   renders them on the server and `iconElement` in the browser, from the same
   paths. Emoji are not used as icons.
5. **The board is drawn once.** `src/lib/app/board-view.ts` turns a board into
   geometry and text labels (pure, unit-tested); `src/ui/board.ts` draws it as
   SVG with a text list for screen readers. Every page that shows a board uses
   it. Terrain colours are the only saturated colours in the palette.
6. **Type: the Alegreya superfamily**, self-hosted through Astro's font API.
   Alegreya (serif) for headings has the feel of a printed rulebook; Alegreya
   Sans for the interface. Lining figures are switched on so scores and dice
   numbers line up. Font files and their SIL Open Font Licences are in
   `src/assets/fonts`; no third-party font service is contacted at runtime.
7. **Plain CSS, no new dependencies.** No Tailwind or component library.
8. **Accessibility floor:** colour contrast at WCAG AA for text, visible focus,
   a skip link, `prefers-reduced-motion` sets every duration to 0, and player
   identity is shown by seat number as well as colour.

## Consequences

- A new page gets the full look by using `Layout` and the shared classes. A
  colour or spacing change is a one-line edit in `tokens.css`.
- Design decisions are reviewable in a pull request as code, the same way as
  everything else in the project.
- The parchment texture is an inline SVG noise filter at very low opacity, so it
  adds no image request and does not affect text contrast.
- Global classes need care: page styles stay scoped (Astro `<style>`), and only
  the shared classes above are global. Script-built elements use the shared
  classes, which is why they are global.
- There is no dark theme. Adding one is a second set of token values, not a
  rewrite, because components only read tokens.
- Self-hosting fonts adds about 120 KB of font files to the repository and the
  container image.

## Alternatives considered

- **Tailwind.** Fast to write, but adds a build dependency and spreads design
  decisions across markup. Tokens in CSS keep them in one reviewable place.
- **A component library.** Brings its own look, which works against the brief,
  and is a large dependency for a handful of components.
- **Google Fonts from the CDN.** Simpler, but a runtime request to a third
  party for every visitor, and the site would depend on it being reachable.
