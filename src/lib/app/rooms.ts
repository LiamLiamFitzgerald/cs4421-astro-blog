import { err, ok, type Result } from "../core/result";
import type { PlayCommand } from "../games/catan-play/commands";
import { MAX_PLAYERS, MIN_PLAYERS } from "../games/catan/decide";
import { decide } from "../games/catan-play/decide";
import type { PlayEvent } from "../games/catan-play/events";
import { evolve } from "../games/catan-play/evolve";
import { initialPlayState, type PlayState } from "../games/catan-play/state";
import type { PlayViolation } from "../games/catan-play/violations";
import { type RandomBelow, viewFor, withServerRandomness } from "../games/catan-play/views";
import { describePlayEvent, describePlayViolation } from "./play-view";
import type { RoomRecord, RoomRepository, SeatRecord } from "./room-repository";

/**
 * Shared rooms (ADR-019, ADR-021). A room starts as a lobby: the host picks a
 * number of seats, players name themselves on their phones, and the host starts
 * the game. Then the server is the arbiter: phones send commands, the rules
 * decide, and each screen is shown only what it may see. Everything the service
 * needs from the outside world is passed in, so it is tested without a
 * database, a clock or real randomness.
 */
export interface RoomDeps {
  readonly rooms: RoomRepository;
  readonly random: RandomBelow;
  readonly now: () => Date;
  /** A new secret for a seat or a host, sent to that screen once. */
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
/** Longest player name, in characters. */
export const MAX_NAME_LENGTH = 20;
/** Attempts at a fresh code, a free seat, or an append that lost a race. */
const ATTEMPTS = 5;

/**
 * The view version: one number that changes whenever a screen should redraw,
 * a move, a resize or a player joining (ADR-021). Seats and joined players are
 * both at most 6, so each fits in 3 bits.
 */
export const viewVersion = (moves: number, seats: number, joined: number): number => moves * 64 + seats * 8 + joined;

export type RoomError =
  | { readonly code: "NO_SUCH_ROOM" }
  | { readonly code: "BAD_SEAT_COUNT"; readonly min: number; readonly max: number }
  | { readonly code: "SEATS_TAKEN"; readonly taken: number }
  | { readonly code: "BAD_NAME"; readonly max: number }
  | { readonly code: "NAME_TAKEN"; readonly name: string }
  | { readonly code: "ROOM_FULL" }
  | { readonly code: "NOT_HOST" }
  | { readonly code: "ALREADY_STARTED" }
  | { readonly code: "NOT_STARTED" }
  | { readonly code: "TOO_FEW_PLAYERS"; readonly min: number; readonly joined: number }
  | { readonly code: "BAD_TOKEN" }
  | { readonly code: "NOT_A_PLAYER" }
  | { readonly code: "NOT_YOUR_SEAT"; readonly seat: string }
  | { readonly code: "NOT_ALLOWED"; readonly command: string }
  | { readonly code: "BUSY" }
  | { readonly code: "RULES"; readonly violation: PlayViolation };

/** What one screen is shown: the room, and the game as that viewer may see it. */
export interface RoomView {
  readonly code: string;
  /** See viewVersion. Screens send it back as `since` to ask "anything new?". */
  readonly version: number;
  /** False while in the lobby. */
  readonly started: boolean;
  /** One entry per seat; `name` is null for a seat nobody has taken. */
  readonly seats: readonly { readonly name: string | null; readonly joined: boolean }[];
  /** Who this screen is playing as; null for the shared board. */
  readonly you: string | null;
  /** True for the screen holding the host token. */
  readonly host: boolean;
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

/** A player's name as typed, tidied (spaces collapsed), or null if it cannot be used. */
export function parsePlayerName(input: string): string | null {
  const name = input.replace(/\s+/g, " ").trim();
  return name.length >= 1 && name.length <= MAX_NAME_LENGTH ? name : null;
}

const validSeatCount = (n: number) => Number.isInteger(n) && n >= MIN_PLAYERS && n <= MAX_PLAYERS;

function fold(events: readonly PlayEvent[]): { state: PlayState; history: string[] } {
  let state = initialPlayState;
  const history: string[] = [];
  for (const event of events) {
    state = evolve(state, event);
    history.push(describePlayEvent(event, state));
  }
  return { state, history };
}

async function hostRoom(deps: RoomDeps, code: string, hostToken: string): Promise<Result<RoomRecord, RoomError>> {
  const room = await deps.rooms.get(code);
  if (!room) return err({ code: "NO_SUCH_ROOM" });
  if (deps.hashToken(hostToken) !== room.hostTokenHash) return err({ code: "NOT_HOST" });
  if (room.version > 0) return err({ code: "ALREADY_STARTED" });
  return ok(room);
}

/** Creates a lobby with `seats` seats. The host token is returned once. */
export async function createRoom(deps: RoomDeps, seats: number): Promise<Result<{ code: string; hostToken: string }, RoomError>> {
  if (!validSeatCount(seats)) return err({ code: "BAD_SEAT_COUNT", min: MIN_PLAYERS, max: MAX_PLAYERS });
  const created = deps.now();
  const hostToken = deps.newToken();
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const code = newRoomCode(deps.random);
    const fresh = await deps.rooms.create({
      code,
      seats,
      hostTokenHash: deps.hashToken(hostToken),
      createdAt: created.toISOString(),
      expiresAt: Math.floor(created.getTime() / 1000) + ROOM_LIFETIME_SECONDS,
    });
    if (fresh) return ok({ code, hostToken });
  }
  return err({ code: "BUSY" });
}

/** The host changes the number of seats in the lobby. Taken seats are never removed. */
export async function resizeRoom(deps: RoomDeps, code: string, hostToken: string, seats: number): Promise<Result<{ seats: number }, RoomError>> {
  if (!validSeatCount(seats)) return err({ code: "BAD_SEAT_COUNT", min: MIN_PLAYERS, max: MAX_PLAYERS });
  const room = await hostRoom(deps, code, hostToken);
  if (!room.ok) return room;
  const taken = await deps.rooms.seats(code);
  const highest = Math.max(-1, ...taken.keys());
  if (seats <= highest) return err({ code: "SEATS_TAKEN", taken: highest + 1 });
  if (!(await deps.rooms.resize(code, room.value.seats, seats))) return err({ code: "BUSY" });
  await tellScreens(deps, code);
  return ok({ seats });
}

/** A player names themselves and takes the next free seat. The token is returned once. */
export async function joinRoom(deps: RoomDeps, code: string, typedName: string): Promise<Result<{ token: string; player: string }, RoomError>> {
  const name = parsePlayerName(typedName);
  if (!name) return err({ code: "BAD_NAME", max: MAX_NAME_LENGTH });
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const room = await deps.rooms.get(code);
    if (!room) return err({ code: "NO_SUCH_ROOM" });
    if (room.version > 0) return err({ code: "ALREADY_STARTED" });
    const taken = await deps.rooms.seats(code);
    if ([...taken.values()].some((s) => s.name.toLowerCase() === name.toLowerCase())) return err({ code: "NAME_TAKEN", name });
    const free = Array.from({ length: room.seats }, (_, i) => i).find((i) => !taken.has(i));
    if (free === undefined) return err({ code: "ROOM_FULL" });
    const token = deps.newToken();
    if (await deps.rooms.claimSeat(code, free, { name, tokenHash: deps.hashToken(token) })) {
      await tellScreens(deps, code);
      return ok({ token, player: name });
    }
    // Someone took that seat at the same moment; try the next one.
  }
  return err({ code: "BUSY" });
}

/** The host starts the game with everyone who has joined, in seat order. */
export async function startRoom(deps: RoomDeps, code: string, hostToken: string): Promise<Result<{ players: readonly string[] }, RoomError>> {
  const room = await hostRoom(deps, code, hostToken);
  if (!room.ok) return room;
  const taken = await deps.rooms.seats(code);
  const players = [...taken.entries()].sort(([a], [b]) => a - b).map(([, s]) => s.name);
  if (players.length < MIN_PLAYERS) return err({ code: "TOO_FEW_PLAYERS", min: MIN_PLAYERS, joined: players.length });
  const start = withServerRandomness({ type: "StartGame", players, seed: 0 }, initialPlayState, deps.random);
  const decision = decide(initialPlayState, start);
  if (!decision.ok) return err({ code: "RULES", violation: decision.error });
  // Conditional on version 0: a game starts once, whoever presses Start first.
  if (!(await deps.rooms.append(code, 0, decision.value))) return err({ code: "ALREADY_STARTED" });
  await tellScreens(deps, code);
  return ok({ players });
}

/** The seat a token belongs to, or null. */
async function seatFor(deps: RoomDeps, code: string, token: string): Promise<SeatRecord | null> {
  const hash = deps.hashToken(token);
  for (const seat of (await deps.rooms.seats(code)).values()) {
    if (seat.tokenHash === hash) return seat;
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
  if (room.version === 0) return err({ code: "NOT_STARTED" });
  const seat = await seatFor(deps, code, token);
  if (!seat) return err({ code: "BAD_TOKEN" });
  if (command.player !== seat.name) return err({ code: "NOT_YOUR_SEAT", seat: seat.name });

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const events = await deps.rooms.events(code);
    const { state } = fold(events);
    if (!state.players.includes(seat.name)) return err({ code: "NOT_A_PLAYER" });
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
 * What a screen sees. With a seat token, that seat sees its own cards; with the
 * host token or none, the shared board sees public information only. When
 * `since` equals the current version, only the version is returned.
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
  const current = viewVersion(room.version, room.seats, taken.size);
  // Two small reads answer "nothing new"; the log is only read when it changed.
  if (since !== null && since === current) return ok({ unchanged: true, version: current });
  const host = token !== null && deps.hashToken(token) === room.hostTokenHash;
  const seat = token && !host ? await seatFor(deps, code, token) : null;
  if (token && !host && !seat) return err({ code: "BAD_TOKEN" });
  const events = await deps.rooms.events(code);
  const { state, history } = fold(events);
  const view = viewFor(state, seat?.name ?? null);
  const seatCount = Math.max(room.seats, ...[...taken.keys()].map((k) => k + 1));
  return ok({
    code,
    version: viewVersion(events.length, room.seats, taken.size),
    started: events.length > 0,
    seats: Array.from({ length: seatCount }, (_, i) => ({ name: taken.get(i)?.name ?? null, joined: taken.has(i) })),
    you: seat?.name ?? null,
    host,
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
    case "BAD_SEAT_COUNT":
      return `A room has ${error.min} to ${error.max} players.`;
    case "SEATS_TAKEN":
      return `${error.taken} seats are taken, so the room cannot get smaller than that.`;
    case "BAD_NAME":
      return `Enter a name of 1 to ${error.max} characters.`;
    case "NAME_TAKEN":
      return `Someone in this room is already called ${error.name}. Pick another name.`;
    case "ROOM_FULL":
      return "This room is full. Ask the host to add a seat.";
    case "NOT_HOST":
      return "Only the screen that created the room can do that.";
    case "ALREADY_STARTED":
      return "This game has already started.";
    case "NOT_STARTED":
      return "The game has not started yet. Waiting for the host.";
    case "TOO_FEW_PLAYERS":
      return `At least ${error.min} players need to join before the game can start (${error.joined} so far).`;
    case "BAD_TOKEN":
      return "This phone is not seated in this room. Join again.";
    case "NOT_A_PLAYER":
      return "You joined after the game started, so you are not playing in it.";
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
