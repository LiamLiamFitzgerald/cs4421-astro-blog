import { err, ok, type Result } from "../core/result";
import type { PlayCommand } from "../games/catan-play/commands";
import { type Hand, RESOURCES, type Resource } from "../games/catan-play/resources";

/**
 * Checks a command sent by a phone (ADR-019). Everything from the network is
 * untrusted: the shape is checked here so the rules only ever see well-formed
 * commands. Random fields (dice, a steal's pick) may be left out, because the
 * server chooses them anyway. A new game cannot be started from a phone.
 */
type Fields = Record<string, unknown>;

const isRecord = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const isName = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 40;
const isSpot = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1000;
const isResource = (v: unknown): v is Resource => typeof v === "string" && (RESOURCES as readonly string[]).includes(v);
const isHand = (v: unknown): v is Hand =>
  isRecord(v) &&
  Object.keys(v).length === RESOURCES.length &&
  RESOURCES.every((r) => typeof v[r] === "number" && Number.isInteger(v[r]) && (v[r] as number) >= 0 && (v[r] as number) <= 19);

export function parsePlayCommand(input: unknown): Result<PlayCommand, string> {
  if (!isRecord(input)) return err("command must be an object");
  const { type, player } = input;
  if (typeof type !== "string") return err("command.type must be a string");
  if (!isName(player)) return err("command.player must be a player name");
  const bad = (field: string, what: string) => err(`${type}.${field} must be ${what}`);

  switch (type) {
    case "EndTurn":
    case "BuyDevelopmentCard":
    case "PlayKnight":
    case "PlayRoadBuilding":
    case "AcceptTrade":
    case "DeclineTrade":
      return ok({ type, player });
    case "RollDice":
      return ok({ type, player, dice: [1, 1] });
    case "PlaceSetupSettlement":
    case "BuildSettlement":
    case "BuildCity":
      return isSpot(input["vertex"]) ? ok({ type, player, vertex: input["vertex"] }) : bad("vertex", "a corner number");
    case "PlaceSetupRoad":
    case "BuildRoad":
      return isSpot(input["edge"]) ? ok({ type, player, edge: input["edge"] }) : bad("edge", "an edge number");
    case "TradeWithBank": {
      const { give, get } = input;
      if (!isResource(give)) return bad("give", "a resource");
      if (!isResource(get)) return bad("get", "a resource");
      return ok({ type, player, give, get });
    }
    case "DiscardCards":
      return isHand(input["cards"]) ? ok({ type, player, cards: input["cards"] }) : bad("cards", "a count of each resource");
    case "MoveRobber": {
      const hex = input["hex"];
      return typeof hex === "string" && /^-?\d{1,2},-?\d{1,2}$/.test(hex) ? ok({ type, player, hex }) : bad("hex", "a hex such as 0,1");
    }
    case "StealFrom":
      return isName(input["victim"]) ? ok({ type, player, victim: input["victim"], pick: 0 }) : bad("victim", "a player name");
    case "PlayYearOfPlenty": {
      const r = input["resources"];
      return Array.isArray(r) && r.length === 2 && isResource(r[0]) && isResource(r[1])
        ? ok({ type, player, resources: [r[0], r[1]] })
        : bad("resources", "two resources");
    }
    case "PlayMonopoly":
      return isResource(input["resource"]) ? ok({ type, player, resource: input["resource"] }) : bad("resource", "a resource");
    case "ProposeTrade": {
      const { to, give, get } = input;
      if (!isName(to)) return bad("to", "a player name");
      if (!isHand(give)) return bad("give", "a count of each resource");
      if (!isHand(get)) return bad("get", "a count of each resource");
      return ok({ type, player, to, give, get });
    }
    default:
      return err(`unknown command type: ${type.slice(0, 40)}`);
  }
}
