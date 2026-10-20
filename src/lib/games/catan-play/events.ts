import type { Board } from "../catan/board";
import type { PlayerId } from "../catan/events";
import type { EdgeId, VertexId } from "./topology";

/** Facts that have happened in a played game. Stored, replayed, never edited. */
export type PlayEvent =
  | { readonly type: "GameStarted"; readonly players: readonly PlayerId[]; readonly board: Board }
  | { readonly type: "SetupSettlementPlaced"; readonly player: PlayerId; readonly vertex: VertexId }
  | { readonly type: "SetupRoadPlaced"; readonly player: PlayerId; readonly edge: EdgeId };
