import { err, ok, type Result } from "../core/result";
import type { PlayCommand } from "../games/catan-play/commands";
import { decide } from "../games/catan-play/decide";
import type { PlayEvent } from "../games/catan-play/events";
import { evolve } from "../games/catan-play/evolve";
import { initialPlayState, type PlayState } from "../games/catan-play/state";
import type { PlayViolation } from "../games/catan-play/violations";
import { type RandomBelow, viewFor, withServerRandomness } from "../games/catan-play/views";
import { describePlayEvent, describePlayViolation } from "./play-view";
import type { RoomRepository } from "./room-repository";

/**
 * Shared rooms (ADR-019). The server is the arbiter: phones send commands, the
 * rules decide, and each screen is shown only what it may see. Everything the
 * service needs from the outside world is passed in, so it is tested without a
 * database, a clock or real randomness.
 */
export interface RoomDeps {
  readonly rooms: RoomRepository;
  readonly random: RandomBelow;
  readonly now: () => Date;
  /** A new secret for a seat, sent to that phone once. */
  readonly newToken: () => string;
  /** One-way hash of a token; only hashes are stored. */
  readonly hashToken: (token: string) => string;
  /**
   * Tells the room's screens that something changed (the push side of the
   * RoomFeed, ADR-019). It carries no game data: each screen then fetches its
   * own view. Optional: without it, screens rely on polling.
   */
  readonly notify?: RoomNotifier;
}

/** Port: pushes "this room changed" to every screen connected to it. */
export type RoomNotifier = (code: string) => Promise<void>;

/** A failed notification must never fail the move: screens still catch up by polling. */
async function tellScreens(deps: RoomDeps, code: string): Promise<void> {
  try {
    await deps.notify?.(code);
  } catch {
    // Polling is the fallback; nothing to undo.
  }
}

/** Letters that cannot be mistaken for each other or for digits (no I, L, O, U). */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 4;
/** Rooms are deleted this long after they are created. */
export const ROOM_LIFETIME_SECONDS = 48 * 60 * 60;
/** More than the most seats a room can have, so the version can count seats and moves together. */
const SEAT_SLOTS = 8;

/** The view version: moves and joined seats in one number (see RoomView.version). */
export const viewVersion = (moves: number, joined: number): number => moves * SEAT_SLOTS + joined;

/** Attempts at a fresh code, and at an append that lost a race. */
const ATTEMPTS = 5;

export type RoomError =
  | { readonly code: "NO_SUCH_ROOM" }
  | { readonly code: "NO_SUCH_SEAT"; readonly seats: number }
  | { readonly code: "SEAT_TAKEN" }
  | { readonly code: "BAD_TOKEN" }
  | { readonly code: "NOT_YOUR_SEAT"; readonly seat: string }
  | { readonly code: "NOT_ALLOWED"; readonly command: string }
  | { readonly code: "BUSY" }
  | { readonly code: "RULES"; readonly violation: PlayViolation };

/** What one screen is shown: the game as that viewer may see it, plus the room. */
export interface RoomView {
  readonly code: string;
  /**
   * Changes whenever anything a screen shows changes: a move or a seat being
   * taken. Screens send it back as `since` to ask "anything new?".
   */
  readonly version: number;
  readonly seats: readonly { readonly name: string; readonly joined: boolean }[];
  /** Who this screen is playing as; null for the shared board. */
  readonly you: string | null;
  readonly state: PlayState;
  readonly cardCounts: Readonly<Record<string, number>>;
  readonly devCardCounts: Readonly<Record<string, number>>;
  /** The event log in words, oldest first. Hidden details are never described. */
  readonly history: readonly string[];
}

export function newRoomCode(random: RandomBelow): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[random(CODE_ALPHABET.length)];
  return code;
}

/** Normalises what a person typed ("abcd ", "a b c d") into a code, or null. */
export function parseRoomCode(input: string): string | null {
  const code = input.replace(/\s+/g, "").toUpperCase();
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : null;
}

function fold(events: readonly PlayEvent[]): { state: PlayState; history: string[] } {
  let state = initialPlayState;
  const history: string[] = [];
  for (const event of events) {
    state = evolve(state, event);
    history.push(describePlayEvent(event, state));
  }
  return { state, history };
}

/** Creates a room and deals the board. The names are checked by the rules. */
export async function createRoom(deps: RoomDeps, names: readonly string[]): Promise<Result<{ code: string }, RoomError>> {
  const start = withServerRandomness({ type: "StartGame", players: names, seed: 0 }, initialPlayState, deps.random);
  const decision = decide(initialPlayState, start);
  if (!decision.ok) return err({ code: "RULES", violation: decision.error });
  const created = deps.now();
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const code = newRoomCode(deps.random);
    const fresh = await deps.rooms.create({
      code,
      names: [...names],
      createdAt: created.toISOString(),
      expiresAt: Math.floor(created.getTime() / 1000) + ROOM_LIFETIME_SECONDS,
    });
    if (!fresh) continue;
    await deps.rooms.append(code, 0, decision.value);
    return ok({ code });
  }
  return err({ code: "BUSY" });
}

/** Takes a seat. The token is returned once and only its hash is kept. */
export async function joinSeat(
  deps: RoomDeps,
  code: string,
  seat: number,
): Promise<Result<{ token: string; player: string }, RoomError>> {
  const room = await deps.rooms.get(code);
  if (!room) return err({ code: "NO_SUCH_ROOM" });
  const player = room.names[seat];
  if (!Number.isInteger(seat) || player === undefined) return err({ code: "NO_SUCH_SEAT", seats: room.names.length });
  const token = deps.newToken();
  if (!(await deps.rooms.claimSeat(code, seat, deps.hashToken(token)))) return err({ code: "SEAT_TAKEN" });
  await tellScreens(deps, code);
  return ok({ token, player });
}

/** The player a token belongs to, or null. */
async function playerFor(deps: RoomDeps, code: string, names: readonly string[], token: string): Promise<string | null> {
  const hash = deps.hashToken(token);
  for (const [seat, stored] of await deps.rooms.seats(code)) {
    if (stored === hash) return names[seat] ?? null;
  }
  return null;
}

/**
 * Runs a phone's command. The token must belong to the player the command is
 * for; random parts are chosen here; the rules rule; the append only lands if
 * nobody else moved first (otherwise the command is re-run on the new log).
 */
export async function runRoomCommand(
  deps: RoomDeps,
  code: string,
  token: string,
  command: PlayCommand,
): Promise<Result<{ moves: number }, RoomError>> {
  const room = await deps.rooms.get(code);
  if (!room) return err({ code: "NO_SUCH_ROOM" });
  if (command.type === "StartGame") return err({ code: "NOT_ALLOWED", command: command.type });
  const player = await playerFor(deps, code, room.names, token);
  if (!player) return err({ code: "BAD_TOKEN" });
  if (command.player !== player) return err({ code: "NOT_YOUR_SEAT", seat: player });

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const events = await deps.rooms.events(code);
    const { state } = fold(events);
    const decision = decide(state, withServerRandomness(command, state, deps.random));
    if (!decision.ok) return err({ code: "RULES", violation: decision.error });
    if (await deps.rooms.append(code, events.length, decision.value)) {
      await tellScreens(deps, code);
      return ok({ moves: events.length + decision.value.length });
    }
  }
  return err({ code: "BUSY" });
}

/**
 * What a screen sees. With a token, the seat it belongs to sees its own cards;
 * without one, the shared board sees public information only. When `since`
 * equals the current version, only the version is returned (nothing new).
 */
export async function getRoomView(
  deps: RoomDeps,
  code: string,
  token: string | null,
  since: number | null = null,
): Promise<Result<RoomView | { readonly unchanged: true; readonly version: number }, RoomError>> {
  const room = await deps.rooms.get(code);
  if (!room) return err({ code: "NO_SUCH_ROOM" });
  const taken = await deps.rooms.seats(code);
  const current = viewVersion(room.version, taken.size);
  // Two small reads answer "nothing new"; the log is only read when it changed.
  if (since !== null && since === current) return ok({ unchanged: true, version: current });
  const you = token ? await playerFor(deps, code, room.names, token) : null;
  if (token && !you) return err({ code: "BAD_TOKEN" });
  const events = await deps.rooms.events(code);
  const { state, history } = fold(events);
  const view = viewFor(state, you);
  return ok({
    code,
    version: viewVersion(events.length, taken.size),
    seats: room.names.map((name, i) => ({ name, joined: taken.has(i) })),
    you,
    state: view.state,
    cardCounts: view.cardCounts,
    devCardCounts: view.devCardCounts,
    history,
  });
}

/** Words for a room problem, for the screens. */
export function describeRoomError(error: RoomError): string {
  switch (error.code) {
    case "NO_SUCH_ROOM":
      return "There is no room with that code. Check the code, or the room may have expired.";
    case "NO_SUCH_SEAT":
      return `That seat does not exist. This room has ${error.seats} seats.`;
    case "SEAT_TAKEN":
      return "Someone has already taken that seat. Pick another one.";
    case "BAD_TOKEN":
      return "This phone is not seated in this room. Join a seat again.";
    case "NOT_YOUR_SEAT":
      return `You are playing as ${error.seat}; you can only move for ${error.seat}.`;
    case "NOT_ALLOWED":
      return "That cannot be done from a phone.";
    case "BUSY":
      return "The room is busy. Try again.";
    case "RULES":
      return describePlayViolation(error.violation);
  }
}
