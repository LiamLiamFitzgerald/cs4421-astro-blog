# ADR-021: Rooms start in a lobby: a player count, names typed on phones

- **Status:** Proposed (2026-10-27)
- **Deciders:** Liam Fitzgerald
- **Issue:** #147
- **Revises:** ADR-019, decision 7 (the host typed every name and the game was
  dealt when the room was created).

## Context

ADR-019 started the game as soon as the host created a room, with every
player's name typed on the shared screen. In practice the host does not know
how people want to be named, typing six names on a shared screen is slow, and
the room could not change once friends arrived. There was also no way to type a
room code: players needed the link.

## Decision

1. **A room has a lobby before its game.** The host chooses a number of seats
   (2 to 6) and creates the room; no board is dealt yet. Creating returns a
   **host token** (kept by the board screen, stored as a hash like seat tokens).
2. **Players name themselves.** A phone sends its name; the server takes the
   next free seat. Names are trimmed, 1 to 20 characters, and unique in the room
   (ignoring case).
3. **The host can resize while in the lobby:** add a seat, or remove an empty
   one from the end. A taken seat is never removed. Resizing is a conditional
   write on the current seat count, so two presses cannot race.
4. **The host starts the game** once at least 2 players have joined. The joined
   players, in seat order, become the game's players; empty seats are dropped;
   the board seed comes from the server. The start is the first append, made
   conditional on version 0, so a game can only start once.
5. **After the start** a room cannot be resized, joined or started again.
6. **The view's version** now counts moves, seats and joined players
   (`moves × 64 + seats × 8 + joined`), so every screen notices a resize or a
   new player as well as a move.
7. **The Rooms page has a code box** next to "Start a room": typing a code goes
   to that room's join screen.

## Consequences

- Setting up is quicker and friendlier; the board fills in as people arrive.
- A host action now needs authority: only the screen with the host token can
  resize or start. If the board's browser loses it (storage cleared), the lobby
  cannot be started from elsewhere; the host creates a new room.
- A phone that loses its seat token after the start cannot rejoin as that
  player. Before the start it can simply join again.
- A join and the start arriving at the same instant could leave a seat claimed
  just after the game began; that phone is then not a player and is told so.
  Accepted: the window is a few milliseconds and nothing is corrupted.
- The repository port changes (seat count and host hash instead of names;
  seats carry the player's name); both adapters and the contract tests follow.
