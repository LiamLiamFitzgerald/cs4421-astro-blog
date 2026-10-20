import type { PlayerId } from "../catan/events";
import type { EdgeId, VertexId } from "./topology";

/** Requests to change a played game. `decide` turns a valid one into events. */
export type PlayCommand =
  | { readonly type: "StartGame"; readonly players: readonly PlayerId[]; readonly seed: number }
  | { readonly type: "PlaceSetupSettlement"; readonly player: PlayerId; readonly vertex: VertexId }
  | { readonly type: "PlaceSetupRoad"; readonly player: PlayerId; readonly edge: EdgeId }
  /** Dice are rolled by the caller and checked here, so decide stays pure (ADR-008). */
  | { readonly type: "RollDice"; readonly player: PlayerId; readonly dice: readonly [number, number] }
  | { readonly type: "EndTurn"; readonly player: PlayerId };
