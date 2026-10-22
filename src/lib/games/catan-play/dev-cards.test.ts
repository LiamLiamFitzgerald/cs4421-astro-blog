import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { PlayCommand } from "./commands";
import { decide } from "./decide";
import { DECK_COUNTS, type DevCard, type HeldCard, shuffledDeck } from "./dev-cards";
import { evolve, replayPlay } from "./evolve";
import {
  currentPlayer,
  devCardOptions,
  expectedStep,
  hiddenPoints,
  legalRoads,
  piecesLeft,
  points,
  visiblePoints,
} from "./queries";
import { DEV_CARD_COST, emptyHand, hand, RESOURCES } from "./resources";
import type { PlayState } from "./state";
import { completeSetup, play, resolvePending } from "./test-helpers";

const players = ["ana", "ben", "cy"];
const started = () => completeSetup(play([{ type: "StartGame", players, seed: 17 }]));

function apply(state: PlayState, ...commands: PlayCommand[]): PlayState {
  return commands.reduce((s, command) => {
    const result = decide(s, command);
    if (!result.ok) throw new Error(`${command.type} refused: ${JSON.stringify(result.error)}`);
    return result.value.reduce(evolve, s);
  }, state);
}

/** Ana's turn after rolling, holding `cards` bought on an earlier turn. */
function anaWith(cards: DevCard[], extra: Partial<PlayState> = {}): PlayState {
  const rolled = replayPlay(play([{ type: "RollDice", player: "ana", dice: [1, 2] }], started()));
  const held: HeldCard[] = cards.map((card) => ({ card, boughtOnTurn: -1 }));
  return { ...rolled, devCards: { ...rolled.devCards, ana: held }, ...extra };
}

describe("Feature: the development card deck", () => {
  it("has the base game's 25 cards", () => {
    const deck = shuffledDeck(1);
    expect(deck).toHaveLength(25);
    for (const card of Object.keys(DECK_COUNTS) as DevCard[]) {
      expect(deck.filter((c) => c === card)).toHaveLength(DECK_COUNTS[card]);
    }
  });

  it("is dealt from the seed: same seed, same order; different seeds differ", () => {
    expect(shuffledDeck(5)).toEqual(shuffledDeck(5));
    expect(shuffledDeck(5)).not.toEqual(shuffledDeck(6));
  });

  it("is stored in GameStarted and starts the game full", () => {
    const state = replayPlay(started());
    expect(state.deck).toEqual(shuffledDeck(17));
  });

  it("given a game saved before cards existed, the deck is empty and buying is refused", () => {
    const old = replayPlay(started().map((e) => (e.type === "GameStarted" ? { ...e, deck: undefined } : e)));
    const rolled = { ...apply(old, { type: "RollDice", player: "ana", dice: [1, 2] }), hands: { ...old.hands, ana: hand({ ore: 1, wool: 1, grain: 1 }) } };
    expect(decide(rolled, { type: "BuyDevelopmentCard", player: "ana" })).toEqual({ ok: false, error: { code: "DECK_EMPTY" } });
  });
});

describe("Feature: buying a development card", () => {
  it("given ore, wool and grain, the top card is drawn and paid for", () => {
    const state = anaWith([], {});
    const rich = { ...state, hands: { ...state.hands, ana: hand({ ore: 1, wool: 1, grain: 1, lumber: 2 }) } };
    const next = apply(rich, { type: "BuyDevelopmentCard", player: "ana" });
    expect(next.devCards.ana?.map((c) => c.card)).toEqual([rich.deck[0]]);
    expect(next.deck).toEqual(rich.deck.slice(1));
    expect(next.hands.ana).toEqual(hand({ lumber: 2 }));
    for (const r of RESOURCES) expect(next.bank[r]).toBe(rich.bank[r] + DEV_CARD_COST[r]);
  });

  it("given no ore, it is refused with what is missing", () => {
    const state = anaWith([]);
    const poor = { ...state, hands: { ...state.hands, ana: hand({ wool: 1, grain: 1 }) } };
    expect(decide(poor, { type: "BuyDevelopmentCard", player: "ana" })).toEqual({
      ok: false,
      error: { code: "CANNOT_AFFORD", piece: "development-card", missing: hand({ ore: 1 }) },
    });
  });

  it("given the dice have not been rolled, buying is refused", () => {
    expect(decide(replayPlay(started()), { type: "BuyDevelopmentCard", player: "ana" })).toEqual({
      ok: false,
      error: { code: "WRONG_STEP", expected: "roll" },
    });
  });

  it("given a card bought this turn, it cannot be played until next turn", () => {
    const state = anaWith([]);
    const deck: DevCard[] = ["monopoly", ...state.deck.slice(1)];
    const bought = apply({ ...state, deck, hands: { ...state.hands, ana: hand({ ore: 1, wool: 1, grain: 1 }) } }, {
      type: "BuyDevelopmentCard",
      player: "ana",
    });
    expect(decide(bought, { type: "PlayMonopoly", player: "ana", resource: "ore" })).toEqual({
      ok: false,
      error: { code: "CARD_TOO_NEW", card: "monopoly" },
    });
    expect(devCardOptions(bought, "ana")).toEqual([{ card: "monopoly", held: 1, allowed: false, reason: "bought-this-turn" }]);
  });
});

describe("Feature: playing a knight", () => {
  it("given a knight, the robber must move next, then play resumes where it was", () => {
    const state = apply(anaWith(["knight"]), { type: "PlayKnight", player: "ana" });
    expect(expectedStep(state)).toBe("move-robber");
    expect(state.knightsPlayed.ana).toBe(1);
    expect(state.devCards.ana).toEqual([]);
  });

  it("given a knight before rolling, play returns to the roll afterwards", () => {
    const before = replayPlay(started());
    const withKnight = { ...before, devCards: { ...before.devCards, ana: [{ card: "knight" as const, boughtOnTurn: -1 }] } };
    const played = apply(withKnight, { type: "PlayKnight", player: "ana" });
    expect(played.pending).toEqual({ kind: "move-robber", resume: "roll" });
    const hex = (played.board?.hexes ?? []).map((h) => `${h.q},${h.r}`).find((k) => k !== played.robber) ?? "";
    let after = apply(played, { type: "MoveRobber", player: "ana", hex });
    if (after.pending?.kind === "steal") after = apply(after, { type: "StealFrom", player: "ana", victim: after.pending.victims[0] ?? "", pick: 0 });
    expect(expectedStep(after)).toBe("roll");
  });

  it("given three knights, Largest Army is awarded for 2 points", () => {
    let state = anaWith(["knight"], { knightsPlayed: { ana: 2, ben: 0, cy: 0 } });
    const before = visiblePoints(state, "ana");
    state = apply(state, { type: "PlayKnight", player: "ana" });
    expect(state.largestArmy).toBe("ana");
    expect(visiblePoints(state, "ana")).toBe(before + 2);
  });

  it("given a challenger only ties, the holder keeps Largest Army", () => {
    const state = anaWith(["knight"], { knightsPlayed: { ana: 2, ben: 3, cy: 0 }, largestArmy: "ben" });
    expect(apply(state, { type: "PlayKnight", player: "ana" }).largestArmy).toBe("ben");
  });

  it("given no knight in hand, it is refused", () => {
    expect(decide(anaWith([]), { type: "PlayKnight", player: "ana" })).toEqual({ ok: false, error: { code: "NO_SUCH_CARD", card: "knight" } });
  });

  it("given a card already played this turn, a second is refused", () => {
    const state = anaWith(["knight", "monopoly"], { playedDevCardThisTurn: true });
    expect(decide(state, { type: "PlayMonopoly", player: "ana", resource: "ore" })).toEqual({ ok: false, error: { code: "ALREADY_PLAYED_CARD" } });
  });

  it("given the robber is pending, a card cannot be played", () => {
    const state = apply(anaWith(["knight", "knight"]), { type: "PlayKnight", player: "ana" });
    expect(decide(state, { type: "PlayKnight", player: "ana" })).toEqual({ ok: false, error: { code: "WRONG_STEP", expected: "move-robber" } });
  });
});

describe("Feature: road building", () => {
  it("given Road Building, two roads are placed free, then building resumes", () => {
    let state = anaWith(["road-building"], {});
    state = { ...state, hands: { ...state.hands, ana: emptyHand } };
    state = apply(state, { type: "PlayRoadBuilding", player: "ana" });
    expect(state.pending).toMatchObject({ kind: "place-free-road", remaining: 2 });
    const roadsBefore = piecesLeft(state, "ana").road;
    state = apply(state, { type: "BuildRoad", player: "ana", edge: legalRoads(state, "ana")[0] ?? -1 });
    expect(state.pending).toMatchObject({ remaining: 1 });
    state = apply(state, { type: "BuildRoad", player: "ana", edge: legalRoads(state, "ana")[0] ?? -1 });
    expect(state.pending).toBeNull();
    expect(piecesLeft(state, "ana").road).toBe(roadsBefore - 2);
    expect(state.hands.ana).toEqual(emptyHand);
    expect(expectedStep(state)).toBe("build-or-end");
  });

  it("given only one road left in the supply, only one is placed", () => {
    const base = anaWith(["road-building"]);
    const roads: Record<number, string> = { ...base.roads };
    // Give ana 14 roads in total, connected to her network, so one is left.
    while (piecesLeft({ ...base, roads }, "ana").road > 1) {
      const edge = legalRoads({ ...base, roads }, "ana")[0];
      if (edge === undefined) break;
      roads[edge] = "ana";
    }
    const state = apply({ ...base, roads }, { type: "PlayRoadBuilding", player: "ana" });
    expect(state.pending).toMatchObject({ kind: "place-free-road", remaining: 1 });
  });
});

describe("Feature: year of plenty and monopoly", () => {
  it("given Year of Plenty, two chosen resources come from the bank", () => {
    const state = anaWith(["year-of-plenty"]);
    const next = apply(state, { type: "PlayYearOfPlenty", player: "ana", resources: ["ore", "ore"] });
    expect(next.hands.ana?.ore).toBe((state.hands.ana?.ore ?? 0) + 2);
    expect(next.bank.ore).toBe(state.bank.ore - 2);
  });

  it("given the bank holds only one, asking for two of it is refused", () => {
    const state = anaWith(["year-of-plenty"], { bank: hand({ lumber: 19, brick: 19, wool: 19, grain: 19, ore: 1 }) });
    expect(decide(state, { type: "PlayYearOfPlenty", player: "ana", resources: ["ore", "ore"] })).toEqual({
      ok: false,
      error: { code: "BANK_EMPTY", resource: "ore" },
    });
    expect(decide(state, { type: "PlayYearOfPlenty", player: "ana", resources: ["ore", "wool"] }).ok).toBe(true);
  });

  it("given Monopoly on wool, every other player's wool goes to the player", () => {
    const base = anaWith(["monopoly"]);
    const state = { ...base, hands: { ana: hand({ wool: 1 }), ben: hand({ wool: 3, ore: 1 }), cy: hand({ wool: 2 }) } };
    const next = apply(state, { type: "PlayMonopoly", player: "ana", resource: "wool" });
    expect(next.hands).toEqual({ ana: hand({ wool: 6 }), ben: hand({ ore: 1 }), cy: emptyHand });
  });

  it("given an unknown resource, the card is refused", () => {
    const command = { type: "PlayMonopoly", player: "ana", resource: "gold" } as unknown as PlayCommand;
    expect(decide(anaWith(["monopoly"]), command)).toMatchObject({ error: { code: "INVALID_TRADE" } });
    const yop = { type: "PlayYearOfPlenty", player: "ana", resources: ["gold", "ore"] } as unknown as PlayCommand;
    expect(decide(anaWith(["year-of-plenty"]), yop)).toMatchObject({ error: { code: "INVALID_TRADE" } });
  });
});

describe("Feature: victory point cards", () => {
  it("count towards winning but are hidden from the visible score", () => {
    const state = anaWith(["victory-point", "victory-point"]);
    expect(hiddenPoints(state, "ana")).toBe(2);
    expect(points(state, "ana")).toBe(visiblePoints(state, "ana") + 2);
    expect(devCardOptions(state, "ana")).toEqual([{ card: "victory-point", held: 2, allowed: false, reason: "victory-points-are-automatic" }]);
  });

  it("given a bought card brings a player to 10, they win on the spot", () => {
    const base = anaWith(Array.from({ length: 5 }, () => "victory-point" as const), {});
    const need = 9 - points(base, "ana");
    const vp: HeldCard[] = Array.from({ length: 5 + need }, () => ({ card: "victory-point", boughtOnTurn: -1 }));
    const nearly = { ...base, devCards: { ...base.devCards, ana: vp }, deck: ["victory-point" as const], hands: { ...base.hands, ana: hand({ ore: 1, wool: 1, grain: 1 }) } };
    expect(points(nearly, "ana")).toBe(9);
    const won = apply(nearly, { type: "BuyDevelopmentCard", player: "ana" });
    expect(won.winner).toBe("ana");
  });
});

describe("Feature: card options for the UI", () => {
  it("given it is not their turn, nothing can be played", () => {
    const state = anaWith([]);
    const withBen = { ...state, devCards: { ...state.devCards, ben: [{ card: "knight" as const, boughtOnTurn: -1 }] } };
    expect(devCardOptions(withBen, "ben")).toEqual([{ card: "knight", held: 1, allowed: false, reason: "not-now" }]);
  });

  it("given a playable card, it is allowed", () => {
    expect(devCardOptions(anaWith(["knight", "knight"]), "ana")).toEqual([{ card: "knight", held: 2, allowed: true, reason: null }]);
  });
});

describe("Feature: random games with cards stay legal (property)", () => {
  it("buying and playing cards never creates or loses resources or cards", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }), fc.array(fc.nat(), { minLength: 30, maxLength: 120 }), (seed, choices) => {
        let log = completeSetup(play([{ type: "StartGame", players, seed }]));
        for (const choice of choices) {
          const state = replayPlay(log);
          if (state.winner) break;
          const player = currentPlayer(state) ?? "";
          const options: PlayCommand[] = [];
          if (expectedStep(state) === "roll") options.push({ type: "RollDice", player, dice: [(choice % 6) + 1, ((choice >> 3) % 6) + 1] });
          if (expectedStep(state) === "build-or-end") options.push({ type: "BuyDevelopmentCard", player }, { type: "EndTurn", player });
          options.push(
            { type: "PlayKnight", player },
            { type: "PlayYearOfPlenty", player, resources: ["ore", "grain"] },
            { type: "PlayMonopoly", player, resource: RESOURCES[choice % 5] ?? "ore" },
            { type: "PlayRoadBuilding", player },
          );
          const command = options[choice % options.length];
          const result = command ? decide(state, command) : null;
          if (result?.ok) log = [...log, ...result.value];
          log = resolvePending(log);
          const after = replayPlay(log);
          if (after.pending?.kind === "place-free-road") {
            const edge = legalRoads(after, player)[0];
            if (edge !== undefined) log = play([{ type: "BuildRoad", player, edge }], log);
            log = resolvePending(log);
          }
        }
        const state = replayPlay(log);
        for (const r of RESOURCES) {
          const held = state.players.reduce((n, p) => n + (state.hands[p]?.[r] ?? 0), 0);
          expect(state.bank[r] + held).toBe(19);
        }
        const cards = state.players.reduce((n, p) => n + (state.devCards[p]?.length ?? 0), 0);
        const knights = Object.values(state.knightsPlayed).reduce((a, b) => a + b, 0);
        expect(state.deck.length + cards).toBeLessThanOrEqual(25);
        expect(knights).toBeLessThanOrEqual(14);
      }),
      { numRuns: 40 },
    );
  });
});
