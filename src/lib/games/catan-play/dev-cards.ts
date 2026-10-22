import { mulberry32, shuffle } from "../../core/random";

export type DevCard = "knight" | "victory-point" | "road-building" | "year-of-plenty" | "monopoly";

/** The base game's 25 development cards. */
export const DECK_COUNTS: Readonly<Record<DevCard, number>> = {
  knight: 14,
  "victory-point": 5,
  "road-building": 2,
  "year-of-plenty": 2,
  monopoly: 2,
};

/** Players need 3 knights for Largest Army. */
export const LARGEST_ARMY_KNIGHTS = 3;

/**
 * The deck in draw order, shuffled from the game seed. A different stream from
 * the board's (the seed is mixed first), so the two orders are independent.
 */
export function shuffledDeck(seed: number): DevCard[] {
  const cards = (Object.keys(DECK_COUNTS) as DevCard[]).flatMap((card) =>
    Array.from({ length: DECK_COUNTS[card] }, () => card),
  );
  return shuffle(cards, mulberry32((seed ^ 0x9e3779b9) >>> 0));
}

/** A card in a player's hand, and the turn it was bought on. */
export interface HeldCard {
  readonly card: DevCard;
  readonly boughtOnTurn: number;
}
