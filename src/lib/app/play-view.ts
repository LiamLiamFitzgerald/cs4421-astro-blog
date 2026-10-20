import { TERRAIN_NAMES } from "./board-view";
import type { Board } from "../games/catan/board";
import type { PlayerId } from "../games/catan/events";
import type { PlayEvent } from "../games/catan-play/events";
import { BANK_TRADE_RATE, type Hand, type Piece, RESOURCES, type Resource } from "../games/catan-play/resources";
import type { PlayState, Roll, Step } from "../games/catan-play/state";
import { TOPOLOGY } from "../games/catan-play/topology";
import type { PlayViolation } from "../games/catan-play/violations";

/** Words for the play mode, in one place so the UI and its tests agree. */

export const PIECE_NAMES: Readonly<Record<Piece, string>> = { road: "road", settlement: "settlement", city: "city" };

/** "1 lumber and 2 grain"; "nothing" when empty. */
export function describeHand(h: Hand): string {
  const parts = RESOURCES.filter((r) => h[r] > 0).map((r) => `${h[r]} ${r}`);
  if (parts.length === 0) return "nothing";
  return parts.length === 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** What the current player should do, as an instruction. */
export function describeStep(step: Step): string {
  switch (step) {
    case "place-settlement":
      return "Place a settlement: choose a highlighted corner.";
    case "place-road":
      return "Place a road next to the settlement you just placed.";
    case "roll":
      return "Roll the dice to start the turn.";
    case "build-or-end":
      return "Build, trade with the bank, or end your turn.";
  }
}

export function describePlayViolation(v: PlayViolation): string {
  switch (v.code) {
    case "GAME_ALREADY_STARTED":
      return "The game has already started.";
    case "GAME_NOT_STARTED":
      return "Start a game first.";
    case "GAME_OVER":
      return `The game is over: ${v.winner} has won.`;
    case "INVALID_PLAYERS":
      return `${v.reason.charAt(0).toUpperCase()}${v.reason.slice(1)}.`;
    case "INVALID_SEED":
      return `${v.seed} is not a valid board seed.`;
    case "NOT_YOUR_TURN":
      return `It is ${v.current}'s turn, not ${v.player}'s.`;
    case "WRONG_STEP":
      return `Not now. ${describeStep(v.expected)}`;
    case "UNKNOWN_SPOT":
      return "That spot is not on the board.";
    case "SPOT_TAKEN":
      return "Someone has already built there.";
    case "TOO_CLOSE_TO_SETTLEMENT":
      return "Too close: settlements must be at least two roads apart.";
    case "ROAD_NOT_BESIDE_NEW_SETTLEMENT":
      return "The road must touch the settlement you just placed.";
    case "INVALID_DICE":
      return "The dice must each show 1 to 6.";
    case "CANNOT_AFFORD":
      return `You need ${describeHand(v.missing)} more to build a ${PIECE_NAMES[v.piece]}.`;
    case "NO_PIECES_LEFT":
      return `You have no ${PIECE_NAMES[v.piece]} pieces left.`;
    case "ROAD_NOT_CONNECTED":
      return "Roads must connect to your own road or building.";
    case "SETTLEMENT_NOT_ON_ROAD":
      return "Settlements must be on one of your roads.";
    case "NOT_YOUR_SETTLEMENT":
      return "A city must replace one of your own settlements.";
    case "INVALID_TRADE":
      return v.reason === "same-resource" ? "Choose two different resources." : "Choose a resource to give and to get.";
    case "NOT_ENOUGH_TO_TRADE":
      return `You need ${v.needed} ${v.give} to trade with the bank.`;
    case "BANK_EMPTY":
      return `The bank has no ${v.resource} left.`;
  }
}

/** "Forest 8, Hills 5": the hexes around a corner, for labels and announcements. */
export function describeCorner(board: Board | null, vertex: number): string {
  const keys = new Set(TOPOLOGY.vertices[vertex]?.hexes ?? []);
  const names = (board?.hexes ?? [])
    .filter((h) => keys.has(`${h.q},${h.r}`))
    .map((h) => (h.token === null ? TERRAIN_NAMES[h.terrain].name : `${TERRAIN_NAMES[h.terrain].name} ${h.token}`));
  return names.length > 0 ? names.join(", ") : "the coast";
}

/** Describes an edge by the hexes on either side of it. */
export function describeEdge(board: Board | null, edge: number): string {
  const [a, b] = TOPOLOGY.edges[edge]?.ends ?? [-1, -1];
  const shared = (TOPOLOGY.vertices[a]?.hexes ?? []).filter((h) => TOPOLOGY.vertices[b]?.hexes.includes(h));
  const names = (board?.hexes ?? [])
    .filter((h) => shared.includes(`${h.q},${h.r}`))
    .map((h) => (h.token === null ? TERRAIN_NAMES[h.terrain].name : `${TERRAIN_NAMES[h.terrain].name} ${h.token}`));
  return names.length === 2 ? `between ${names[0]} and ${names[1]}` : `along the coast by ${names[0] ?? "the sea"}`;
}

/** "Rolled 8. Ana gets 1 grain. Ben gets 2 ore." */
export function describeRoll(roll: Roll, players: readonly PlayerId[]): string {
  if (roll.total === 7) return `Rolled 7. Nothing is produced on a 7 (the robber is not in this version yet).`;
  const gains = players
    .filter((p) => RESOURCES.some((r) => (roll.produced[p]?.[r] ?? 0) > 0))
    .map((p) => `${p} gets ${describeHand(roll.produced[p] ?? ({} as Hand))}.`);
  const short = roll.shortages.length > 0 ? ` The bank ran short of ${roll.shortages.join(" and ")}.` : "";
  return `Rolled ${roll.total}. ${gains.length > 0 ? gains.join(" ") : "Nobody collects anything."}${short}`;
}

export function describePlayEvent(event: PlayEvent, state: PlayState): string {
  switch (event.type) {
    case "GameStarted":
      return `Game started: ${event.players.join(", ")}`;
    case "SetupSettlementPlaced":
    case "SettlementBuilt":
      return `${event.player} built a settlement at ${describeCorner(state.board, event.vertex)}`;
    case "SetupRoadPlaced":
    case "RoadBuilt":
      return `${event.player} built a road ${describeEdge(state.board, event.edge)}`;
    case "CityBuilt":
      return `${event.player} upgraded to a city at ${describeCorner(state.board, event.vertex)}`;
    case "DiceRolled":
      return `${event.player} rolled ${event.dice[0] + event.dice[1]}`;
    case "TurnEnded":
      return `${event.player} ended their turn`;
    case "BankTraded":
      return `${event.player} traded ${BANK_TRADE_RATE} ${event.give} for 1 ${event.get}`;
  }
}

/** Resources a player can offer the bank right now. */
export function tradeableResources(h: Hand): Resource[] {
  return RESOURCES.filter((r) => h[r] >= BANK_TRADE_RATE);
}
