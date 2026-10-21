import type { PlayerId } from "../catan/events";
import type { EdgeId, VertexId } from "./topology";

/** Requests to change a played game. `decide` turns a valid one into events. */
export type PlayCommand =
  | { readonly type: "StartGame"; readonly players: readonly PlayerId[]; readonly seed: number }
  | { readonly type: "PlaceSetupSettlement"; readonly player: PlayerId; readonly vertex: VertexId }
  | { readonly type: "PlaceSetupRoad"; readonly player: PlayerId; readonly edge: EdgeId };
