import type { PlayerId } from "./events";

/** Requests to change the match. `decide` turns a valid one into events. */
export type CatanCommand =
  | { readonly type: "StartGame"; readonly players: readonly PlayerId[] }
  | { readonly type: "BuildSettlement"; readonly player: PlayerId }
  | { readonly type: "UpgradeSettlement"; readonly player: PlayerId }
  | { readonly type: "RevealVictoryPointCard"; readonly player: PlayerId }
  | { readonly type: "PlayKnight"; readonly player: PlayerId }
  | {
      readonly type: "RecordRoadLength";
      readonly player: PlayerId;
      readonly length: number;
    };
