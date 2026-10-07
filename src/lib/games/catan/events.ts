/** Identifies a player within one match. */
export type PlayerId = string;

/**
 * Facts that have already happened in a match. Events are stored and replayed;
 * they are never edited. See docs/architecture.md and ADR-003.
 */
export type CatanEvent =
  | { readonly type: "GameStarted"; readonly players: readonly PlayerId[] }
  | { readonly type: "SettlementBuilt"; readonly player: PlayerId }
  | { readonly type: "SettlementUpgraded"; readonly player: PlayerId }
  | { readonly type: "VictoryPointCardRevealed"; readonly player: PlayerId }
  | { readonly type: "KnightPlayed"; readonly player: PlayerId }
  | {
      readonly type: "RoadLengthRecorded";
      readonly player: PlayerId;
      readonly length: number;
    };
