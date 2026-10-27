import type { PlayerId } from "../catan/events";
import type { PlayCommand } from "./commands";
import {
  actingPlayer,
  buildOptions,
  currentPlayer,
  expectedStep,
  legalRoads,
  legalRobberHexes,
  legalSetupRoads,
  legalSetupSettlements,
} from "./queries";
import { emptyHand, RESOURCES, type Resource } from "./resources";
import type { PlayState } from "./state";

/**
 * A simple player for benchmarks and load tests: the move `me` would make now,
 * or null if it is not their move. It only reads what that player's own phone
 * can see (its own hand, public everything else), so it works on a room view.
 * Not clever: it builds what it can (city, settlement, then road), then ends
 * its turn; it declines trades. Dice and steal picks are filled in by whoever
 * runs the command (the server, in a room).
 */
export function botMove(state: PlayState, me: PlayerId): PlayCommand | null {
  if (!state.started || state.winner || actingPlayer(state) !== me) return null;
  const step = expectedStep(state);
  switch (step) {
    case "place-settlement":
      return { type: "PlaceSetupSettlement", player: me, vertex: legalSetupSettlements(state)[0] ?? -1 };
    case "place-road":
      return { type: "PlaceSetupRoad", player: me, edge: legalSetupRoads(state)[0] ?? -1 };
    case "roll":
      return { type: "RollDice", player: me, dice: [1, 1] };
    case "discard": {
      const owed = state.pending?.kind === "discard" ? (state.pending.owed[me] ?? 0) : 0;
      const held = state.hands[me] ?? emptyHand;
      const cards: Record<Resource, number> = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
      let left = owed;
      for (const r of RESOURCES) {
        const take = Math.min(left, held[r]);
        cards[r] = take;
        left -= take;
      }
      return { type: "DiscardCards", player: me, cards };
    }
    case "move-robber":
      return { type: "MoveRobber", player: me, hex: legalRobberHexes(state)[0] ?? "" };
    case "steal":
      return state.pending?.kind === "steal"
        ? { type: "StealFrom", player: me, victim: state.pending.victims[0] ?? "", pick: 0 }
        : null;
    case "place-free-road": {
      const edge = legalRoads(state, me)[0];
      return edge === undefined ? null : { type: "BuildRoad", player: me, edge };
    }
    case "respond-trade":
      return { type: "DeclineTrade", player: me };
    case "build-or-end": {
      if (currentPlayer(state) !== me) return null;
      const options = buildOptions(state, me);
      for (const piece of ["city", "settlement", "road"] as const) {
        const option = options.find((o) => o.piece === piece && o.allowed);
        const spot = option?.spots[0];
        if (spot === undefined) continue;
        if (piece === "road") return { type: "BuildRoad", player: me, edge: spot };
        return { type: piece === "city" ? "BuildCity" : "BuildSettlement", player: me, vertex: spot };
      }
      return { type: "EndTurn", player: me };
    }
    default:
      return null;
  }
}
