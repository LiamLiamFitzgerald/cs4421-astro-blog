import type { Board } from "../catan/board";
import type { PlayerId } from "../catan/events";
import type { Hand, Resource } from "./resources";
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
  | { readonly type: "BankTraded"; readonly player: PlayerId; readonly give: Resource; readonly get: Resource }
  | { readonly type: "CardsDiscarded"; readonly player: PlayerId; readonly cards: Hand }
  | { readonly type: "RobberMoved"; readonly player: PlayerId; readonly hex: string }
  /** The card that was taken is the fact, not the random pick that chose it. */
  | { readonly type: "CardStolen"; readonly player: PlayerId; readonly victim: PlayerId; readonly resource: Resource };
