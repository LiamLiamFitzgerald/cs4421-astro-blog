import type { PlayerId } from "../catan/events";
import type { Hand, Resource } from "./resources";
import type { EdgeId, VertexId } from "./topology";

/** Requests to change a played game. `decide` turns a valid one into events. */
export type PlayCommand =
  | { readonly type: "StartGame"; readonly players: readonly PlayerId[]; readonly seed: number }
  | { readonly type: "PlaceSetupSettlement"; readonly player: PlayerId; readonly vertex: VertexId }
  | { readonly type: "PlaceSetupRoad"; readonly player: PlayerId; readonly edge: EdgeId }
  /** Dice are rolled by the caller and checked here, so decide stays pure (ADR-008). */
  | { readonly type: "RollDice"; readonly player: PlayerId; readonly dice: readonly [number, number] }
  | { readonly type: "EndTurn"; readonly player: PlayerId }
  | { readonly type: "BuildRoad"; readonly player: PlayerId; readonly edge: EdgeId }
  | { readonly type: "BuildSettlement"; readonly player: PlayerId; readonly vertex: VertexId }
  | { readonly type: "BuildCity"; readonly player: PlayerId; readonly vertex: VertexId }
  | { readonly type: "TradeWithBank"; readonly player: PlayerId; readonly give: Resource; readonly get: Resource }
  | { readonly type: "DiscardCards"; readonly player: PlayerId; readonly cards: Hand }
  | { readonly type: "MoveRobber"; readonly player: PlayerId; readonly hex: string }
  /**
   * `pick` chooses which of the victim's cards is taken (0 to cards − 1, in
   * resource order). The caller draws it at random, so decide stays pure (ADR-011).
   */
  | { readonly type: "StealFrom"; readonly player: PlayerId; readonly victim: PlayerId; readonly pick: number };
