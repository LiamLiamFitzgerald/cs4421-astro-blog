import { describe, expect, it } from "vitest";
import { hand } from "../games/catan-play/resources";
import { parsePlayCommand } from "./room-commands";

const h = hand({ wool: 1 });

describe("Feature: checking commands from phones", () => {
  it.each([
    [{ type: "EndTurn", player: "Ana" }, { type: "EndTurn", player: "Ana" }],
    [{ type: "BuyDevelopmentCard", player: "Ana" }, { type: "BuyDevelopmentCard", player: "Ana" }],
    [{ type: "PlayKnight", player: "Ana" }, { type: "PlayKnight", player: "Ana" }],
    [{ type: "PlayRoadBuilding", player: "Ana" }, { type: "PlayRoadBuilding", player: "Ana" }],
    [{ type: "AcceptTrade", player: "Ana" }, { type: "AcceptTrade", player: "Ana" }],
    [{ type: "DeclineTrade", player: "Ana" }, { type: "DeclineTrade", player: "Ana" }],
    [{ type: "RollDice", player: "Ana", dice: [6, 6] }, { type: "RollDice", player: "Ana", dice: [1, 1] }],
    [{ type: "PlaceSetupSettlement", player: "Ana", vertex: 3 }, { type: "PlaceSetupSettlement", player: "Ana", vertex: 3 }],
    [{ type: "BuildSettlement", player: "Ana", vertex: 0 }, { type: "BuildSettlement", player: "Ana", vertex: 0 }],
    [{ type: "BuildCity", player: "Ana", vertex: 53 }, { type: "BuildCity", player: "Ana", vertex: 53 }],
    [{ type: "PlaceSetupRoad", player: "Ana", edge: 4 }, { type: "PlaceSetupRoad", player: "Ana", edge: 4 }],
    [{ type: "BuildRoad", player: "Ana", edge: 71 }, { type: "BuildRoad", player: "Ana", edge: 71 }],
    [{ type: "TradeWithBank", player: "Ana", give: "ore", get: "wool" }, { type: "TradeWithBank", player: "Ana", give: "ore", get: "wool" }],
    [{ type: "DiscardCards", player: "Ana", cards: h }, { type: "DiscardCards", player: "Ana", cards: h }],
    [{ type: "MoveRobber", player: "Ana", hex: "-1,2" }, { type: "MoveRobber", player: "Ana", hex: "-1,2" }],
    [{ type: "StealFrom", player: "Ana", victim: "Ben", pick: 9 }, { type: "StealFrom", player: "Ana", victim: "Ben", pick: 0 }],
    [{ type: "PlayYearOfPlenty", player: "Ana", resources: ["ore", "ore"] }, { type: "PlayYearOfPlenty", player: "Ana", resources: ["ore", "ore"] }],
    [{ type: "PlayMonopoly", player: "Ana", resource: "brick" }, { type: "PlayMonopoly", player: "Ana", resource: "brick" }],
    [{ type: "ProposeTrade", player: "Ana", to: "Ben", give: h, get: h }, { type: "ProposeTrade", player: "Ana", to: "Ben", give: h, get: h }],
  ])("accepts %j", (input, expected) => {
    expect(parsePlayCommand(input)).toEqual({ ok: true, value: expected });
  });

  it("drops fields it does not know", () => {
    expect(parsePlayCommand({ type: "EndTurn", player: "Ana", admin: true })).toEqual({ ok: true, value: { type: "EndTurn", player: "Ana" } });
  });

  it.each([
    [null, "command must be an object"],
    [[], "command must be an object"],
    ["EndTurn", "command must be an object"],
    [{ player: "Ana" }, "command.type must be a string"],
    [{ type: "EndTurn" }, "command.player must be a player name"],
    [{ type: "EndTurn", player: "" }, "command.player must be a player name"],
    [{ type: "EndTurn", player: "x".repeat(41) }, "command.player must be a player name"],
    [{ type: "StartGame", player: "Ana" }, "unknown command type: StartGame"],
    [{ type: "Cheat", player: "Ana" }, "unknown command type: Cheat"],
    [{ type: "BuildCity", player: "Ana", vertex: -1 }, "BuildCity.vertex must be a corner number"],
    [{ type: "BuildCity", player: "Ana", vertex: 1.5 }, "BuildCity.vertex must be a corner number"],
    [{ type: "BuildCity", player: "Ana", vertex: 1000 }, "BuildCity.vertex must be a corner number"],
    [{ type: "BuildCity", player: "Ana", vertex: "3" }, "BuildCity.vertex must be a corner number"],
    [{ type: "BuildRoad", player: "Ana" }, "BuildRoad.edge must be an edge number"],
    [{ type: "TradeWithBank", player: "Ana", give: "gold", get: "ore" }, "TradeWithBank.give must be a resource"],
    [{ type: "TradeWithBank", player: "Ana", give: "ore", get: "toString" }, "TradeWithBank.get must be a resource"],
    [{ type: "DiscardCards", player: "Ana", cards: { ore: 1 } }, "DiscardCards.cards must be a count of each resource"],
    [{ type: "DiscardCards", player: "Ana", cards: { ...h, ore: -1 } }, "DiscardCards.cards must be a count of each resource"],
    [{ type: "DiscardCards", player: "Ana", cards: { ...h, ore: 20 } }, "DiscardCards.cards must be a count of each resource"],
    [{ type: "DiscardCards", player: "Ana", cards: { ...h, ore: 0.5 } }, "DiscardCards.cards must be a count of each resource"],
    [{ type: "DiscardCards", player: "Ana", cards: { ...h, gold: 1 } }, "DiscardCards.cards must be a count of each resource"],
    [{ type: "DiscardCards", player: "Ana", cards: [] }, "DiscardCards.cards must be a count of each resource"],
    [{ type: "MoveRobber", player: "Ana", hex: "middle" }, "MoveRobber.hex must be a hex such as 0,1"],
    [{ type: "MoveRobber", player: "Ana", hex: 3 }, "MoveRobber.hex must be a hex such as 0,1"],
    [{ type: "StealFrom", player: "Ana" }, "StealFrom.victim must be a player name"],
    [{ type: "PlayYearOfPlenty", player: "Ana", resources: ["ore"] }, "PlayYearOfPlenty.resources must be two resources"],
    [{ type: "PlayYearOfPlenty", player: "Ana", resources: ["ore", "gold"] }, "PlayYearOfPlenty.resources must be two resources"],
    [{ type: "PlayYearOfPlenty", player: "Ana", resources: ["gold", "ore"] }, "PlayYearOfPlenty.resources must be two resources"],
    [{ type: "PlayYearOfPlenty", player: "Ana", resources: "ore,ore" }, "PlayYearOfPlenty.resources must be two resources"],
    [{ type: "PlayMonopoly", player: "Ana", resource: 1 }, "PlayMonopoly.resource must be a resource"],
    [{ type: "ProposeTrade", player: "Ana", give: h, get: h }, "ProposeTrade.to must be a player name"],
    [{ type: "ProposeTrade", player: "Ana", to: "Ben", give: 1, get: h }, "ProposeTrade.give must be a count of each resource"],
    [{ type: "ProposeTrade", player: "Ana", to: "Ben", give: h, get: null }, "ProposeTrade.get must be a count of each resource"],
  ])("refuses %j", (input, reason) => {
    expect(parsePlayCommand(input)).toEqual({ ok: false, error: reason });
  });

  it("accepts the edges of the allowed ranges", () => {
    expect(parsePlayCommand({ type: "BuildCity", player: "x".repeat(40), vertex: 999 }).ok).toBe(true);
    expect(parsePlayCommand({ type: "DiscardCards", player: "A", cards: hand({ ore: 19 }) }).ok).toBe(true);
    expect(parsePlayCommand({ type: "MoveRobber", player: "A", hex: "-12,34" }).ok).toBe(true);
    expect(parsePlayCommand({ type: "MoveRobber", player: "A", hex: "1,2,3" }).ok).toBe(false);
    expect(parsePlayCommand({ type: "MoveRobber", player: "A", hex: "x1,2" }).ok).toBe(false);
  });
});
