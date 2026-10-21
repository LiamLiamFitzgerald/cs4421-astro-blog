import { TERRAIN_NAMES } from "./board-view";
import type { Board } from "../games/catan/board";
import type { PlayerId } from "../games/catan/events";
import type { PlayEvent } from "../games/catan-play/events";
import { BANK_TRADE_RATE, type Hand, type Piece, RESOURCES, type Resource } from "../games/catan-play/resources";
import type { DevCard } from "../games/catan-play/dev-cards";
import type { DevCardOption } from "../games/catan-play/queries";
import type { PlayState, Roll, Step } from "../games/catan-play/state";
import { TOPOLOGY } from "../games/catan-play/topology";
import type { PlayViolation } from "../games/catan-play/violations";

/** Words for the play mode, in one place so the UI and its tests agree. */

export const PIECE_NAMES: Readonly<Record<Piece | "development-card", string>> = {
  road: "road",
  settlement: "settlement",
  city: "city",
  "development-card": "development card",
};

export const CARD_NAMES: Readonly<Record<DevCard, string>> = {
  knight: "Knight",
  "victory-point": "Victory point",
  "road-building": "Road building",
  "year-of-plenty": "Year of plenty",
  monopoly: "Monopoly",
};

/** What each card does, in one line, for buttons and tooltips. */
export const CARD_EFFECTS: Readonly<Record<DevCard, string>> = {
  knight: "Move the robber and steal a card. Three or more knights can win Largest Army.",
  "victory-point": "Worth 1 point, counted automatically. Kept hidden until you win.",
  "road-building": "Place 2 roads for free.",
  "year-of-plenty": "Take any 2 resources from the bank.",
  monopoly: "Name a resource: every other player gives you all of theirs.",
};

export function describeCardReason(reason: DevCardOption["reason"]): string {
  switch (reason) {
    case "victory-points-are-automatic":
      return "Counted automatically";
    case "bought-this-turn":
      return "Bought this turn: play it from your next turn";
    case "one-per-turn":
      return "You have already played a card this turn";
    case "not-now":
      return "Play it on your turn, before rolling or while building";
    case null:
      return "";
  }
}

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
    case "discard":
      return "Discard half your cards (rounded down): you hold more than 7.";
    case "move-robber":
      return "Move the robber: choose a highlighted hex.";
    case "steal":
      return "Choose a player to steal a card from.";
    case "place-free-road":
      return "Place a free road from Road Building.";
    case "respond-trade":
      return "Accept or decline the trade offer.";
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
    case "NOTHING_TO_DISCARD":
      return "You do not need to discard.";
    case "WRONG_DISCARD_COUNT":
      return `Discard exactly ${v.owed} card${v.owed === 1 ? "" : "s"} (you chose ${v.given}).`;
    case "NOT_IN_HAND":
      return "You can only discard cards you hold.";
    case "ROBBER_MUST_MOVE":
      return "The robber must move to a different hex.";
    case "NOT_A_VICTIM":
      return v.victims.length > 0 ? `Steal from ${v.victims.join(" or ")}.` : "There is nobody to steal from.";
    case "INVALID_PICK":
      return "That card cannot be stolen.";
    case "DECK_EMPTY":
      return "There are no development cards left.";
    case "NO_SUCH_CARD":
      return `You do not have a ${CARD_NAMES[v.card].toLowerCase()} card.`;
    case "CARD_TOO_NEW":
      return `You bought that ${CARD_NAMES[v.card].toLowerCase()} card this turn; play it from your next turn.`;
    case "ALREADY_PLAYED_CARD":
      return "You can play only one development card per turn.";
    case "INVALID_OFFER":
      return {
        "unknown-player": "Choose a player in this game to trade with.",
        yourself: "You cannot trade with yourself.",
        "not-whole-numbers": "Offer whole numbers of cards.",
        "empty-side": "A trade needs at least one card on each side.",
      }[v.reason];
    case "RECIPIENT_LACKS_CARDS":
      return `You need ${describeHand(v.missing)} more to accept this trade.`;
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
  if (roll.total === 7) return "Rolled 7. Nobody collects; the robber moves.";
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
      return `${event.player} traded ${event.rate ?? BANK_TRADE_RATE} ${event.give} for 1 ${event.get}`;
    case "CardsDiscarded":
      return `${event.player} discarded ${describeHand(event.cards)}`;
    case "RobberMoved":
      return `${event.player} moved the robber to ${describeHex(state.board, event.hex)}`;
    case "CardStolen":
      // Which card was taken is private between the two players.
      return `${event.player} stole a card from ${event.victim}`;
    case "DevelopmentCardBought":
      // The card stays hidden from the other players.
      return `${event.player} bought a development card`;
    case "KnightPlayed":
      return `${event.player} played a knight`;
    case "RoadBuildingPlayed":
      return `${event.player} played Road building`;
    case "YearOfPlentyPlayed":
      return `${event.player} played Year of plenty for ${event.resources[0]} and ${event.resources[1]}`;
    case "MonopolyPlayed":
      return `${event.player} played Monopoly on ${event.resource}`;
    case "TradeProposed":
      return `${event.player} offered ${event.to} ${describeHand(event.give)} for ${describeHand(event.get)}`;
    case "TradeAccepted":
      return `${event.player} accepted ${event.from}'s trade`;
    case "TradeDeclined":
      return `${event.player} declined ${event.from}'s trade`;
  }
}

/** Resources a player can offer the bank right now, given their rate for each (4 unless a harbour helps). */
export function tradeableResources(h: Hand, rate: (r: Resource) => number = () => BANK_TRADE_RATE): Resource[] {
  return RESOURCES.filter((r) => h[r] >= rate(r));
}

/** "3:1 harbour" or "2:1 wool harbour". */
export function describeHarbour(kind: Resource | "any"): string {
  return kind === "any" ? "3:1 harbour" : `2:1 ${kind} harbour`;
}

/** "Forest 8": a hex by its terrain and number. */
export function describeHex(board: Board | null, key: string): string {
  const hex = board?.hexes.find((h) => `${h.q},${h.r}` === key);
  if (!hex) return "the board";
  const name = TERRAIN_NAMES[hex.terrain].name;
  return hex.token === null ? `the ${name.toLowerCase()}` : `${name} ${hex.token}`;
}
