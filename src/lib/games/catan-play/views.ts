import type { PlayerId } from "../catan/events";
import type { PlayCommand } from "./commands";
import { handSize, emptyHand } from "./resources";
import type { PlayState } from "./state";

/**
 * What one screen may know about a game (ADR-019). The board sees only public
 * information; a seat also sees its own resource and development cards. Other
 * players' cards and the deck order never leave the server.
 */
export interface ViewerState {
  /** The state with everyone else's private cards removed. */
  readonly state: PlayState;
  /** How many resource cards each player holds (public in Catan). */
  readonly cardCounts: Readonly<Record<PlayerId, number>>;
  /** How many development cards each player holds, unplayed (public). */
  readonly devCardCounts: Readonly<Record<PlayerId, number>>;
}

/**
 * Removes what `viewer` may not see. `viewer` null is the shared board. The
 * deck keeps its length (how many cards are left is public) but every card in
 * it is replaced, so its order cannot be read.
 */
export function viewFor(state: PlayState, viewer: PlayerId | null): ViewerState {
  const cardCounts: Record<PlayerId, number> = {};
  const devCardCounts: Record<PlayerId, number> = {};
  const hands: Record<PlayerId, PlayState["hands"][string]> = {};
  const devCards: Record<PlayerId, PlayState["devCards"][string]> = {};
  for (const player of state.players) {
    const hand = state.hands[player] ?? emptyHand;
    const held = state.devCards[player] ?? [];
    cardCounts[player] = handSize(hand);
    devCardCounts[player] = held.length;
    hands[player] = player === viewer ? hand : emptyHand;
    devCards[player] = player === viewer ? held : [];
  }
  return {
    state: { ...state, hands, devCards, deck: state.deck.map(() => "knight" as const) },
    cardCounts,
    devCardCounts,
  };
}

/** A source of fair random whole numbers from 0 to n − 1. */
export type RandomBelow = (n: number) => number;

/**
 * The server fills in every random part of a command (ADR-019): the dice, which
 * card a steal takes and a new game's seed. Whatever the phone sent is ignored,
 * so a player cannot choose their roll.
 */
export function withServerRandomness(command: PlayCommand, state: PlayState, random: RandomBelow): PlayCommand {
  switch (command.type) {
    case "RollDice":
      return { ...command, dice: [random(6) + 1, random(6) + 1] };
    case "StealFrom": {
      const cards = handSize(state.hands[command.victim] ?? emptyHand);
      return { ...command, pick: random(Math.max(cards, 1)) };
    }
    case "StartGame":
      return { ...command, seed: random(0x100000000) };
    default:
      return command;
  }
}
