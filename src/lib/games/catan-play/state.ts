import type { Board } from "../catan/board";
import type { PlayerId } from "../catan/events";
import { BANK_START, type Hand, type Resource } from "./resources";
import type { DevCard, HeldCard } from "./dev-cards";
import type { EdgeId, VertexId } from "./topology";

export type Phase = "setup" | "roll" | "main" | "finished";

/** What has to happen next. Discard and steal steps can belong to someone other than the current player. */
export type Step =
  | "place-settlement"
  | "place-road"
  | "roll"
  | "build-or-end"
  | "discard"
  | "move-robber"
  | "steal"
  | "place-free-road";

/** Where play returns once the robber has been dealt with. */
export type Resume = "roll" | "build-or-end";

/**
 * An interruption to normal turn order (ADR-011). While one is pending, only
 * the step it names is allowed.
 */
export type Pending =
  /** After a 7: these players still owe this many cards. Then the robber moves. */
  | { readonly kind: "discard"; readonly owed: Readonly<Record<PlayerId, number>>; readonly resume: Resume }
  | { readonly kind: "move-robber"; readonly resume: Resume }
  /** The robber has moved; the mover picks one of these players to steal from. */
  | { readonly kind: "steal"; readonly victims: readonly PlayerId[]; readonly resume: Resume }
  /** Road Building: place this many more roads for free. */
  | { readonly kind: "place-free-road"; readonly remaining: number; readonly resume: Resume };

export interface Building {
  readonly player: PlayerId;
  readonly kind: "settlement" | "city";
}

/** The most recent roll and what it produced. */
export interface Roll {
  readonly player: PlayerId;
  readonly dice: readonly [number, number];
  readonly total: number;
  /** What each player received (all zero on a 7). */
  readonly produced: Readonly<Record<PlayerId, Hand>>;
  /** Resources the bank could not supply to everyone who earned them. */
  readonly shortages: readonly Resource[];
}

/** The whole played game, derived by folding events. Nothing here is stored. */
export interface PlayState {
  readonly started: boolean;
  readonly board: Board | null;
  /** Seating order. */
  readonly players: readonly PlayerId[];
  readonly phase: Phase;
  /** Index into `players` of whoever acts now. */
  readonly current: number;
  /** Position in the snake order during setup (0 to 2n−1). */
  readonly setupTurn: number;
  /** The settlement placed this setup turn, which the road must touch. */
  readonly pendingSettlement: VertexId | null;
  readonly buildings: Readonly<Record<VertexId, Building>>;
  readonly roads: Readonly<Record<EdgeId, PlayerId>>;
  readonly hands: Readonly<Record<PlayerId, Hand>>;
  readonly bank: Hand;
  readonly lastRoll: Roll | null;
  /** Key ("q,r") of the hex the robber is on; it produces nothing. */
  readonly robber: string | null;
  readonly pending: Pending | null;
  /** Turns completed since setup; cards bought this turn cannot be played. */
  readonly turn: number;
  /** Development cards left to draw, in order. */
  readonly deck: readonly DevCard[];
  readonly devCards: Readonly<Record<PlayerId, readonly HeldCard[]>>;
  /** At most one development card (other than victory points) per turn. */
  readonly playedDevCardThisTurn: boolean;
  readonly knightsPlayed: Readonly<Record<PlayerId, number>>;
  /** Holder of Largest Army, or null while vacant. */
  readonly largestArmy: PlayerId | null;
  /** Holder of Longest Road, or null while vacant. */
  readonly longestRoad: PlayerId | null;
  readonly winner: PlayerId | null;
}

export const initialPlayState: PlayState = {
  started: false,
  board: null,
  players: [],
  phase: "setup",
  current: 0,
  setupTurn: 0,
  pendingSettlement: null,
  buildings: {},
  roads: {},
  hands: {},
  bank: BANK_START,
  lastRoll: null,
  robber: null,
  pending: null,
  turn: 0,
  deck: [],
  devCards: {},
  playedDevCardThisTurn: false,
  knightsPlayed: {},
  largestArmy: null,
  longestRoad: null,
  winner: null,
};
