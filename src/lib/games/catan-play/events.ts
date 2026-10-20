import type { Board } from "../catan/board";
import type { PlayerId } from "../catan/events";
import type { Resource } from "./resources";
import type { EdgeId, VertexId } from "./topology";

/** Facts that have happened in a played game. Stored, replayed, never edited. */
export type PlayEvent =
  | { readonly type: "GameStarted"; readonly players: readonly PlayerId[]; readonly board: Board }
  | { readonly type: "SetupSettlementPlaced"; readonly player: PlayerId; readonly vertex: VertexId }
  | { readonly type: "SetupRoadPlaced"; readonly player: PlayerId; readonly edge: EdgeId }
  | { readonly type: "DiceRolled"; readonly player: PlayerId; readonly dice: readonly [number, number] }
  | { readonly type: "TurnEnded"; readonly player: PlayerId }
  | { readonly type: "RoadBuilt"; readonly player: PlayerId; readonly edge: EdgeId }
  | { readonly type: "SettlementBuilt"; readonly player: PlayerId; readonly vertex: VertexId }
  | { readonly type: "CityBuilt"; readonly player: PlayerId; readonly vertex: VertexId }
  /** Four `give` to the bank for one `get` (BANK_TRADE_RATE). */
  | { readonly type: "BankTraded"; readonly player: PlayerId; readonly give: Resource; readonly get: Resource };
