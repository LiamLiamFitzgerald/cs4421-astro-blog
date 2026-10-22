# ADR-006: Build the scoreboard UI as a thin client-side page with no UI framework

- **Status:** Proposed (2026-10-20)
- **Deciders:** Liam Fitzgerald

## Context

The game core (ADR-003) and the layers around it (ADR-004) had no user
interface, so the only way to see the project working was to read tests. The
scoreboard page at `/catan` fixes that. The module is assessed on the
engineering around the site, not on the site itself, so the UI should be cheap
to build, cheap to change and unable to weaken the architecture.

The page needs to start a game for 2 to 6 players, record events (settlement,
city, victory point card, knight, road length), show scores, awards and the
winner, show why a command was refused, and list the event log.

## Decision

1. **Plain TypeScript in an Astro `<script>`, no UI framework.** The page is one
   Astro file. The script is bundled by Vite and runs in the browser. No React,
   Vue, Svelte or Tailwind is added.
2. **The page is a thin delivery layer.** It reads input, calls
   `executeCommand` and `loadGame` from the app layer, and draws the result. It
   contains no game rules and no formatting rules.
3. **Presentation logic lives in `src/lib/app/scoreboard.ts` as pure functions**
   (`buildScoreboard`, `describeViolation`, `describeEvent`). They have no DOM
   and no storage, and are covered by unit tests in the project's Given/When/Then
   style.
4. **The page is the composition root.** It is the only place that picks the
   adapter (`MemoryEventStore`) and hands it to the app layer. Dependency rules
   from ADR-004 are unchanged and `npm run arch` still passes.
5. **The DOM is built with `createElement` and `textContent`, never
   `innerHTML`.** Player names are typed by the user, so inserting them as HTML
   would allow script injection.
6. **Styles come from the design system (ADR-007).** Page-specific rules are
   global but namespaced under `.scoreboard`, because Astro's scoped styles
   cannot reach elements created by the script.
7. **Games are kept in browser storage** (`LocalStorageEventStore`, #71), falling
   back to memory if storage is blocked. Nothing is stored on the server.

8. **Every failure path is visible.** Rule violations are shown next to the
   player who caused them. Anything else (for example full or blocked browser
   storage) shows an error with a plain explanation, technical details and a
   Try again button; the view is redrawn from the store so it never shows a
   half-applied change, and controls are re-enabled in a `finally` block. If
   storage is blocked the page falls back to memory and says so. Discarding a
   game asks for confirmation in a native `<dialog>`.
9. **The browser controller lives in `src/ui/scoreboard.ts`**, and the page file
   holds only markup and styles.

## Consequences

- The UI adds no dependencies, so there is nothing new for Dependabot, the
  image scan or the lockfile to track, and the container image stays the same.
- Replacing the page, or adding a second front end (for example a CLI), reuses
  the same app-layer functions and tests. Only drawing code would be rewritten.
- The page script is covered by a Playwright end-to-end test in CI (#72) that
  plays a short game against the production server build. It found a real bug
  on its first run: a refused start was reported inside the hidden game section,
  so the message was invisible.
- Hand-written DOM code gets verbose as screens multiply. If the UI grows past a
  few views, adopt a framework island at that point, with this ADR superseded.
- Because games live only in the visitor's browser, the server's health endpoint
  and logs say nothing about them, and a game cannot move between devices. A
  server-side adapter (for example DynamoDB, as noted in ADR-001) is needed
  before the data matters. The `EventStore` port makes that a swap in the
  composition root.
- The event store is append-only, so the page has no undo button even though
  `undo` exists in `history.ts`. Supporting it needs a store operation for
  truncating a log, which is a deliberate design decision of its own.

## Alternatives considered

- **React (or another framework) as an Astro island.** Familiar and good for
  larger UIs, but it adds dependencies and a second build path for one page whose
  logic already lives outside the UI. Rejected for now, and easy to adopt later
  because the logic is framework-free.
- **Server-rendered forms posting to API routes.** Fits server mode, but needs
  server-side storage first, which would force the persistence decision before it
  is needed. Rejected until a persistent adapter exists.
- **Tailwind or a component library.** Faster for large UIs, but adds tooling and
  dependencies that the project has no other use for.
- **Putting scoring and message logic in the page.** Less code to write, but it
  would be untested and tied to the DOM. Rejected because it removes the main
  benefit of the layered design.
