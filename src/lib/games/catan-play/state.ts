import type { Board } from "../catan/board";
import type { PlayerId } from "../catan/events";
import { BANK_START, type Hand } from "./resources";
import type { EdgeId, VertexId } from "./topology";

export type Phase = "setup" | "roll" | "main" | "finished";

/** What the current player has to do next. */
export type Step = "place-settlement" | "place-road" | "roll" | "build-or-end";

export interface Building {
  readonly player: PlayerId;
  readonly kind: "settlement" | "city";
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
  winner: null,
};
