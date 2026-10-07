import type { PlayerId } from "./events";

/** What one player has on the table. */
export interface PlayerState {
  readonly settlements: number;
  readonly cities: number;
  readonly victoryPointCards: number;
  readonly knights: number;
  readonly roadLength: number;
}

/** The whole match, derived by folding events. Nothing here is stored. */
export interface CatanState {
  readonly started: boolean;
  readonly playerOrder: readonly PlayerId[];
  readonly players: Readonly<Record<PlayerId, PlayerState>>;
}

export const emptyPlayer: PlayerState = {
  settlements: 0,
  cities: 0,
  victoryPointCards: 0,
  knights: 0,
  roadLength: 0,
};

export const initialState: CatanState = {
  started: false,
  playerOrder: [],
  players: {},
};
