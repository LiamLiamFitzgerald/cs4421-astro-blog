import { describe, expect, it } from "vitest";
import { MemoryRoomRepository } from "../adapters/memory-room-repository";
import type { PlayEvent } from "../games/catan-play/events";
import { replayPlay } from "../games/catan-play/evolve";
import { currentPlayer, legalSetupRoads, legalSetupSettlements } from "../games/catan-play/queries";
import type { RoomRepository } from "./room-repository";
import {
  CODE_ALPHABET,
  createRoom,
  describeRoomError,
  getRoomView,
  joinSeat,
  newRoomCode,
  parseRoomCode,
  ROOM_LIFETIME_SECONDS,
  type RoomDeps,
  type RoomView,
  runRoomCommand,
} from "./rooms";

/** Deterministic dependencies: random values from a queue, then 0. */
function deps(overrides: Partial<RoomDeps> = {}, randoms: number[] = []): RoomDeps & { rooms: RoomRepository } {
  let tokens = 0;
  const queue = [...randoms];
  return {
    rooms: new MemoryRoomRepository(() => new Date("2026-10-23T18:00:00Z")),
    random: (n) => Math.min(queue.shift() ?? 0, n - 1),
    now: () => new Date("2026-10-23T18:00:00Z"),
    newToken: () => `token-${++tokens}`,
    hashToken: (t) => `hash(${t})`,
    ...overrides,
  };
}

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};
const asView = (v: RoomView | { unchanged: true; version: number }): RoomView => {
  if ("unchanged" in v) throw new Error("expected a full view");
  return v;
};

async function seatedRoom(d = deps()) {
  const { code } = unwrap(await createRoom(d, ["Ana", "Ben"]));
  const ana = unwrap(await joinSeat(d, code, 0));
  const ben = unwrap(await joinSeat(d, code, 1));
  return { d, code, ana: ana.token, ben: ben.token };
}

describe("Feature: room codes", () => {
  it("makes codes of 4 unambiguous letters", () => {
    expect(newRoomCode(() => 0)).toBe("AAAA");
    expect(newRoomCode((n) => n - 1)).toBe("ZZZZ");
    expect(CODE_ALPHABET).not.toMatch(/[ILOU0-9]/);
  });

  it.each([
    ["abcd", "ABCD"],
    [" a b c d ", "ABCD"],
    ["ZZZZ", "ZZZZ"],
  ])("reads %j as %s", (input, code) => {
    expect(parseRoomCode(input)).toBe(code);
  });

  it.each(["", "ABC", "ABCDE", "AB1D", "ABOD", "ABID"])("rejects %j", (input) => {
    expect(parseRoomCode(input)).toBeNull();
  });
});

describe("Feature: creating a room", () => {
  it("given valid names, makes a room whose game has started on a server-dealt board", async () => {
    const d = deps({}, [7]);
    const { code } = unwrap(await createRoom(d, ["Ana", "Ben", "Cy"]));
    const room = await d.rooms.get(code);
    expect(room).toMatchObject({ code, names: ["Ana", "Ben", "Cy"], version: 1 });
    expect(room?.expiresAt).toBe(Date.parse("2026-10-23T18:00:00Z") / 1000 + ROOM_LIFETIME_SECONDS);
    const [started] = await d.rooms.events(code);
    expect(started?.type).toBe("GameStarted");
  });

  it("given names the rules refuse, makes no room and says why", async () => {
    const d = deps();
    const result = await createRoom(d, ["Solo"]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("RULES");
    expect(await d.rooms.get("AAAA")).toBeNull();
  });

  it("given a code already in use, tries another", async () => {
    const d = deps({}, [0, 0, 0, 0, 0, /* second room */ 0, 0, 0, 0, 0, 1, 1, 1, 1]);
    const first = unwrap(await createRoom(d, ["A", "B"]));
    const second = unwrap(await createRoom(d, ["C", "D"]));
    expect(first.code).toBe("AAAA");
    expect(second.code).toBe("BBBB");
  });

  it("given every attempt collides, reports busy rather than overwriting", async () => {
    const d = deps();
    unwrap(await createRoom(d, ["A", "B"]));
    const again = await createRoom(d, ["C", "D"]);
    expect(again).toEqual({ ok: false, error: { code: "BUSY" } });
    expect((await d.rooms.get("AAAA"))?.names).toEqual(["A", "B"]);
  });
});

describe("Feature: joining a seat", () => {
  it("given a free seat, returns a token and the player, and stores only its hash", async () => {
    const d = deps();
    const { code } = unwrap(await createRoom(d, ["Ana", "Ben"]));
    expect(unwrap(await joinSeat(d, code, 1))).toEqual({ token: "token-1", player: "Ben" });
    expect(await d.rooms.seats(code)).toEqual(new Map([[1, "hash(token-1)"]]));
  });

  it("given a taken seat, refuses", async () => {
    const { d, code } = await seatedRoom();
    expect(await joinSeat(d, code, 0)).toEqual({ ok: false, error: { code: "SEAT_TAKEN" } });
  });

  it.each([-1, 2, 0.5, Number.NaN])("given seat %s, says how many seats there are", async (seat) => {
    const d = deps();
    const { code } = unwrap(await createRoom(d, ["Ana", "Ben"]));
    expect(await joinSeat(d, code, seat)).toEqual({ ok: false, error: { code: "NO_SUCH_SEAT", seats: 2 } });
  });

  it("given an unknown room, refuses", async () => {
    expect(await joinSeat(deps(), "ZZZZ", 0)).toEqual({ ok: false, error: { code: "NO_SUCH_ROOM" } });
  });
});

describe("Feature: playing from a phone", () => {
  const firstCorner = async (d: RoomDeps, code: string) => {
    const state = replayPlay(await d.rooms.events(code));
    return { player: currentPlayer(state) ?? "", vertex: legalSetupSettlements(state)[0] ?? -1 };
  };

  it("given the right token, the move is ruled on and stored", async () => {
    const { d, code, ana } = await seatedRoom();
    const { player, vertex } = await firstCorner(d, code);
    expect(player).toBe("Ana");
    expect(unwrap(await runRoomCommand(d, code, ana, { type: "PlaceSetupSettlement", player, vertex }))).toEqual({ version: 2 });
    const state = replayPlay(await d.rooms.events(code));
    expect(state.buildings[vertex]).toEqual({ player: "Ana", kind: "settlement" });
  });

  it("given another player's token, refuses and stores nothing", async () => {
    const { d, code, ben } = await seatedRoom();
    const { vertex } = await firstCorner(d, code);
    expect(await runRoomCommand(d, code, ben, { type: "PlaceSetupSettlement", player: "Ana", vertex })).toEqual({
      ok: false,
      error: { code: "NOT_YOUR_SEAT", seat: "Ben" },
    });
    expect((await d.rooms.get(code))?.version).toBe(1);
  });

  it("given an unknown token, refuses", async () => {
    const { d, code } = await seatedRoom();
    const { vertex } = await firstCorner(d, code);
    expect(await runRoomCommand(d, code, "forged", { type: "PlaceSetupSettlement", player: "Ana", vertex })).toEqual({
      ok: false,
      error: { code: "BAD_TOKEN" },
    });
  });

  it("given a move the rules refuse, passes the reason on", async () => {
    const { d, code, ben } = await seatedRoom();
    const result = await runRoomCommand(d, code, ben, { type: "EndTurn", player: "Ben" });
    expect(!result.ok && result.error.code).toBe("RULES");
    expect(!result.ok && describeRoomError(result.error)).toMatch(/turn|Not now/);
  });

  it("given a start command from a phone, refuses it", async () => {
    const { d, code, ana } = await seatedRoom();
    expect(await runRoomCommand(d, code, ana, { type: "StartGame", players: ["x", "y"], seed: 1 })).toEqual({
      ok: false,
      error: { code: "NOT_ALLOWED", command: "StartGame" },
    });
  });

  it("given an unknown room, refuses", async () => {
    expect(await runRoomCommand(deps(), "ZZZZ", "t", { type: "EndTurn", player: "Ana" })).toEqual({
      ok: false,
      error: { code: "NO_SUCH_ROOM" },
    });
  });

  it("given the phone's dice, ignores them and uses the server's", async () => {
    // Play through setup, then roll with a server that always says 2 (random 1 → die 2).
    const d = deps();
    const { code, ana, ben } = await seatedRoom(d);
    const tokens: Record<string, string> = { Ana: ana, Ben: ben };
    for (let i = 0; i < 8; i++) {
      const state = replayPlay(await d.rooms.events(code));
      const player = currentPlayer(state) ?? "";
      const step = state.pendingSettlement === null ? "settlement" : "road";
      const command =
        step === "settlement"
          ? ({ type: "PlaceSetupSettlement", player, vertex: legalSetupSettlements(state)[0] ?? -1 } as const)
          : ({ type: "PlaceSetupRoad", player, edge: legalSetupRoads(state)[0] ?? -1 } as const);
      unwrap(await runRoomCommand(d, code, tokens[player] ?? "", command));
    }
    const rolled = { ...d, random: () => 1 };
    unwrap(await runRoomCommand(rolled, code, ana, { type: "RollDice", player: "Ana", dice: [6, 6] }));
    const last = (await d.rooms.events(code)).at(-1);
    expect(last).toEqual({ type: "DiceRolled", player: "Ana", dice: [2, 2] });
  });

  it("given someone else moved first, re-runs the move on the new log", async () => {
    const { d, code, ana } = await seatedRoom();
    const { player, vertex } = await firstCorner(d, code);
    let raced = false;
    const racing: RoomRepository = {
      ...d.rooms,
      get: (c) => d.rooms.get(c),
      seats: (c) => d.rooms.seats(c),
      events: (c, a) => d.rooms.events(c, a),
      claimSeat: (c, s, h) => d.rooms.claimSeat(c, s, h),
      create: (r) => d.rooms.create(r),
      append: async (c, expected, events) => {
        if (!raced) {
          raced = true;
          return false; // lost the race once
        }
        return d.rooms.append(c, expected, events);
      },
    };
    expect(unwrap(await runRoomCommand({ ...d, rooms: racing }, code, ana, { type: "PlaceSetupSettlement", player, vertex }))).toEqual({
      version: 2,
    });
  });

  it("given the log keeps moving, gives up and says busy", async () => {
    const { d, code, ana } = await seatedRoom();
    const { player, vertex } = await firstCorner(d, code);
    const losing: RoomRepository = {
      create: (r) => d.rooms.create(r),
      get: (c) => d.rooms.get(c),
      claimSeat: (c, s, h) => d.rooms.claimSeat(c, s, h),
      seats: (c) => d.rooms.seats(c),
      events: (c, a) => d.rooms.events(c, a),
      append: async () => false,
    };
    expect(await runRoomCommand({ ...d, rooms: losing }, code, ana, { type: "PlaceSetupSettlement", player, vertex })).toEqual({
      ok: false,
      error: { code: "BUSY" },
    });
  });
});

describe("Feature: what each screen is shown", () => {
  async function withCards() {
    const room = await seatedRoom();
    // Give both players cards by appending a trade-free fact the rules produce: a roll.
    const events: PlayEvent[] = [...(await room.d.rooms.events(room.code))];
    return { ...room, events };
  }

  it("given the board (no token), shows public information and the seats", async () => {
    const { d, code } = await withCards();
    const view = asView(unwrap(await getRoomView(d, code, null)));
    expect(view).toMatchObject({ code, version: 1, you: null, seats: [{ name: "Ana", joined: true }, { name: "Ben", joined: true }] });
    expect(view.history).toEqual(["Game started: Ana, Ben"]);
    expect(Object.values(view.state.hands).every((h) => Object.values(h).every((n) => n === 0))).toBe(true);
    expect(new Set(view.state.deck)).toEqual(new Set(["knight"]));
  });

  it("given a seat's token, says who the screen is playing as", async () => {
    const { d, code, ben } = await withCards();
    expect(asView(unwrap(await getRoomView(d, code, ben))).you).toBe("Ben");
  });

  it("given a seat that has not joined, shows it as open", async () => {
    const d = deps();
    const { code } = unwrap(await createRoom(d, ["Ana", "Ben"]));
    unwrap(await joinSeat(d, code, 1));
    expect(asView(unwrap(await getRoomView(d, code, null))).seats).toEqual([
      { name: "Ana", joined: false },
      { name: "Ben", joined: true },
    ]);
  });

  it("given the screen is up to date, answers with only the version", async () => {
    const { d, code } = await withCards();
    expect(unwrap(await getRoomView(d, code, null, 1))).toEqual({ unchanged: true, version: 1 });
    expect("unchanged" in unwrap(await getRoomView(d, code, null, 0))).toBe(false);
  });

  it("given a forged token, refuses rather than showing the board", async () => {
    const { d, code } = await withCards();
    expect(await getRoomView(d, code, "forged")).toEqual({ ok: false, error: { code: "BAD_TOKEN" } });
  });

  it("given an unknown room, refuses", async () => {
    expect(await getRoomView(deps(), "ZZZZ", null)).toEqual({ ok: false, error: { code: "NO_SUCH_ROOM" } });
  });
});

describe("Feature: words for room problems", () => {
  it.each([
    [{ code: "NO_SUCH_ROOM" }, /no room with that code/],
    [{ code: "NO_SUCH_SEAT", seats: 3 }, /3 seats/],
    [{ code: "SEAT_TAKEN" }, /already taken/],
    [{ code: "BAD_TOKEN" }, /not seated/],
    [{ code: "NOT_YOUR_SEAT", seat: "Ana" }, /playing as Ana/],
    [{ code: "NOT_ALLOWED", command: "StartGame" }, /cannot be done from a phone/],
    [{ code: "BUSY" }, /busy/],
    [{ code: "RULES", violation: { code: "GAME_NOT_STARTED" } }, /Start a game first/],
  ] as const)("describes %j", (error, words) => {
    expect(describeRoomError(error)).toMatch(words);
  });
});
