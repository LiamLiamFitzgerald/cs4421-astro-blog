import { describe, expect, it } from "vitest";
import { MemoryRoomRepository } from "../adapters/memory-room-repository";
import { replayPlay } from "../games/catan-play/evolve";
import { currentPlayer, legalSetupRoads, legalSetupSettlements } from "../games/catan-play/queries";
import type { RoomRepository } from "./room-repository";
import {
  CODE_ALPHABET,
  createRoom,
  describeRoomError,
  getRoomView,
  joinRoom,
  MAX_NAME_LENGTH,
  newRoomCode,
  parsePlayerName,
  parseRoomCode,
  resizeRoom,
  ROOM_LIFETIME_SECONDS,
  type RoomDeps,
  type RoomError,
  type RoomView,
  runRoomCommand,
  startRoom,
  viewVersion,
} from "./rooms";

const NOW = new Date("2026-10-23T18:00:00Z");

/** Deterministic dependencies: random values from a queue, then 0; one clock for service and store. */
function deps(overrides: Partial<RoomDeps> = {}, randoms: number[] = []): RoomDeps {
  let tokens = 0;
  const queue = [...randoms];
  return {
    rooms: new MemoryRoomRepository(() => NOW),
    random: (n) => Math.min(queue.shift() ?? 0, n - 1),
    now: () => NOW,
    newToken: () => `token-${++tokens}`,
    hashToken: (t) => `hash(${t})`,
    ...overrides,
  };
}

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};
const failure = (r: { ok: boolean; error?: RoomError }) => (r.ok ? null : r.error);
const asView = (v: RoomView | { unchanged: true; version: number }): RoomView => {
  if ("unchanged" in v) throw new Error("expected a full view");
  return v;
};

async function lobby(d = deps(), seats = 4) {
  const { code, hostToken } = unwrap(await createRoom(d, seats));
  return { d, code, host: hostToken };
}

async function startedRoom(d = deps()) {
  const room = await lobby(d, 2);
  const ana = unwrap(await joinRoom(d, room.code, "Ana")).token;
  const ben = unwrap(await joinRoom(d, room.code, "Ben")).token;
  unwrap(await startRoom(d, room.code, room.host));
  return { ...room, ana, ben };
}

describe("Feature: room codes and names", () => {
  it("makes codes of 4 unambiguous letters", () => {
    expect(newRoomCode(() => 0)).toBe("AAAA");
    expect(newRoomCode((n) => n - 1)).toBe("ZZZZ");
    expect(CODE_ALPHABET).not.toMatch(/[ILOU0-9]/);
  });

  it.each([
    ["abcd", "ABCD"],
    [" a b c d ", "ABCD"],
    ["ZZZZ", "ZZZZ"],
  ])("reads code %j as %s", (input, code) => {
    expect(parseRoomCode(input)).toBe(code);
  });

  it.each(["", "ABC", "ABCDE", "AB1D", "ABOD", "ABID"])("rejects code %j", (input) => {
    expect(parseRoomCode(input)).toBeNull();
  });

  it.each([
    ["Ana", "Ana"],
    ["  Ana  ", "Ana"],
    ["Mary  Jane", "Mary Jane"],
    ["x".repeat(MAX_NAME_LENGTH), "x".repeat(MAX_NAME_LENGTH)],
  ])("tidies name %j to %j", (input, name) => {
    expect(parsePlayerName(input)).toBe(name);
  });

  it.each(["", "   ", "x".repeat(MAX_NAME_LENGTH + 1)])("rejects name %j", (input) => {
    expect(parsePlayerName(input)).toBeNull();
  });
});

describe("Feature: creating a lobby", () => {
  it("given a player count, makes a lobby with that many seats and no game yet", async () => {
    const { d, code, host } = await lobby(deps(), 3);
    expect(host).toBe("token-1");
    const room = await d.rooms.get(code);
    expect(room).toMatchObject({ code, seats: 3, version: 0, hostTokenHash: "hash(token-1)" });
    expect(room?.expiresAt).toBe(NOW.getTime() / 1000 + ROOM_LIFETIME_SECONDS);
    expect(await d.rooms.events(code)).toEqual([]);
  });

  it.each([1, 7, 2.5, Number.NaN])("given %s players, refuses", async (n) => {
    expect(failure(await createRoom(deps(), n))).toEqual({ code: "BAD_SEAT_COUNT", min: 2, max: 6 });
  });

  it.each([2, 6])("accepts %s players", async (n) => {
    expect((await createRoom(deps(), n)).ok).toBe(true);
  });

  it("given a code already in use, tries another", async () => {
    const d = deps({}, [0, 0, 0, 0, /* second */ 0, 0, 0, 0, 1, 1, 1, 1]);
    expect(unwrap(await createRoom(d, 2)).code).toBe("AAAA");
    expect(unwrap(await createRoom(d, 2)).code).toBe("BBBB");
  });

  it("given every attempt collides, reports busy rather than overwriting", async () => {
    const d = deps();
    unwrap(await createRoom(d, 2));
    expect(failure(await createRoom(d, 5))).toEqual({ code: "BUSY" });
    expect((await d.rooms.get("AAAA"))?.seats).toBe(2);
  });
});

describe("Feature: players joining by name", () => {
  it("given a name, takes the next free seat and stores only the token's hash", async () => {
    const { d, code } = await lobby();
    expect(unwrap(await joinRoom(d, code, " Ana "))).toEqual({ token: "token-2", player: "Ana" });
    expect(unwrap(await joinRoom(d, code, "Ben")).player).toBe("Ben");
    expect(await d.rooms.seats(code)).toEqual(
      new Map([
        [0, { name: "Ana", tokenHash: "hash(token-2)" }],
        [1, { name: "Ben", tokenHash: "hash(token-3)" }],
      ]),
    );
  });

  it("given a name already used, ignoring case, refuses", async () => {
    const { d, code } = await lobby();
    unwrap(await joinRoom(d, code, "Ana"));
    expect(failure(await joinRoom(d, code, "ana"))).toEqual({ code: "NAME_TAKEN", name: "ana" });
  });

  it.each(["", "x".repeat(21)])("given name %j, refuses", async (name) => {
    const { d, code } = await lobby();
    expect(failure(await joinRoom(d, code, name))).toEqual({ code: "BAD_NAME", max: 20 });
  });

  it("given a full room, refuses", async () => {
    const { d, code } = await lobby(deps(), 2);
    unwrap(await joinRoom(d, code, "Ana"));
    unwrap(await joinRoom(d, code, "Ben"));
    expect(failure(await joinRoom(d, code, "Cy"))).toEqual({ code: "ROOM_FULL" });
  });

  it("given a seat taken at the same moment, tries the next one", async () => {
    const { d, code } = await lobby();
    let raced = false;
    const racing: RoomRepository = {
      create: (r) => d.rooms.create(r),
      get: (c) => d.rooms.get(c),
      resize: (c, f, t) => d.rooms.resize(c, f, t),
      seats: (c) => d.rooms.seats(c),
      events: (c, a) => d.rooms.events(c, a),
      append: (c, e, ev) => d.rooms.append(c, e, ev),
      claimSeat: async (c, seat, s) => {
        if (!raced) {
          raced = true;
          await d.rooms.claimSeat(c, seat, { name: "Quick", tokenHash: "q" });
          return false;
        }
        return d.rooms.claimSeat(c, seat, s);
      },
    };
    expect(unwrap(await joinRoom({ ...d, rooms: racing }, code, "Ana")).player).toBe("Ana");
    expect((await d.rooms.seats(code)).get(1)?.name).toBe("Ana");
  });

  it("given the seat keeps being taken, gives up and says busy", async () => {
    const { d, code } = await lobby();
    const never: RoomRepository = { ...d.rooms, get: (c) => d.rooms.get(c), seats: (c) => d.rooms.seats(c), claimSeat: async () => false } as RoomRepository;
    expect(failure(await joinRoom({ ...d, rooms: never }, code, "Ana"))).toEqual({ code: "BUSY" });
  });

  it("given a started game, refuses new players", async () => {
    const { d, code } = await startedRoom();
    expect(failure(await joinRoom(d, code, "Cy"))).toEqual({ code: "ALREADY_STARTED" });
  });

  it("given an unknown room, refuses", async () => {
    expect(failure(await joinRoom(deps(), "ZZZZ", "Ana"))).toEqual({ code: "NO_SUCH_ROOM" });
  });
});

describe("Feature: the host resizing the lobby", () => {
  it("given the host, adds and removes empty seats", async () => {
    const { d, code, host } = await lobby(deps(), 3);
    expect(unwrap(await resizeRoom(d, code, host, 5))).toEqual({ seats: 5 });
    expect(unwrap(await resizeRoom(d, code, host, 2))).toEqual({ seats: 2 });
    expect((await d.rooms.get(code))?.seats).toBe(2);
  });

  it("never removes a taken seat", async () => {
    const { d, code, host } = await lobby(deps(), 4);
    unwrap(await joinRoom(d, code, "Ana"));
    unwrap(await joinRoom(d, code, "Ben"));
    unwrap(await joinRoom(d, code, "Cy"));
    expect(failure(await resizeRoom(d, code, host, 2))).toEqual({ code: "SEATS_TAKEN", taken: 3 });
    expect(unwrap(await resizeRoom(d, code, host, 3))).toEqual({ seats: 3 });
  });

  it("given someone else's token, refuses", async () => {
    const { d, code } = await lobby();
    const { token } = unwrap(await joinRoom(d, code, "Ana"));
    expect(failure(await resizeRoom(d, code, token, 5))).toEqual({ code: "NOT_HOST" });
  });

  it.each([1, 7])("given %s seats, refuses", async (n) => {
    const { d, code, host } = await lobby();
    expect(failure(await resizeRoom(d, code, host, n))).toEqual({ code: "BAD_SEAT_COUNT", min: 2, max: 6 });
  });

  it("given a started game, refuses", async () => {
    const { d, code, host } = await startedRoom();
    expect(failure(await resizeRoom(d, code, host, 4))).toEqual({ code: "ALREADY_STARTED" });
  });

  it("given a resize that lost a race, reports busy", async () => {
    const { d, code, host } = await lobby();
    const stale: RoomRepository = { ...d.rooms, get: (c) => d.rooms.get(c), seats: (c) => d.rooms.seats(c), resize: async () => false } as RoomRepository;
    expect(failure(await resizeRoom({ ...d, rooms: stale }, code, host, 5))).toEqual({ code: "BUSY" });
  });

  it("given an unknown room, refuses", async () => {
    expect(failure(await resizeRoom(deps(), "ZZZZ", "h", 3))).toEqual({ code: "NO_SUCH_ROOM" });
  });
});

describe("Feature: the host starting the game", () => {
  it("deals the board with the joined players in seat order, dropping empty seats", async () => {
    const d = deps();
    const { code, host } = await lobby(d, 5);
    unwrap(await joinRoom(d, code, "Ana"));
    unwrap(await joinRoom(d, code, "Ben"));
    expect(unwrap(await startRoom(d, code, host))).toEqual({ players: ["Ana", "Ben"] });
    const [started] = await d.rooms.events(code);
    expect(started).toMatchObject({ type: "GameStarted", players: ["Ana", "Ben"] });
  });

  it("given fewer than 2 players, refuses", async () => {
    const { d, code, host } = await lobby();
    unwrap(await joinRoom(d, code, "Ana"));
    expect(failure(await startRoom(d, code, host))).toEqual({ code: "TOO_FEW_PLAYERS", min: 2, joined: 1 });
  });

  it("given a player's token, refuses", async () => {
    const { d, code } = await lobby();
    const { token } = unwrap(await joinRoom(d, code, "Ana"));
    unwrap(await joinRoom(d, code, "Ben"));
    expect(failure(await startRoom(d, code, token))).toEqual({ code: "NOT_HOST" });
  });

  it("starts only once", async () => {
    const { d, code, host } = await startedRoom();
    expect(failure(await startRoom(d, code, host))).toEqual({ code: "ALREADY_STARTED" });
    expect(await d.rooms.events(code)).toHaveLength(1);
  });

  it("given two starts at the same instant, the second is told the game already started", async () => {
    const { d, code, host } = await lobby(deps(), 2);
    unwrap(await joinRoom(d, code, "Ana"));
    unwrap(await joinRoom(d, code, "Ben"));
    const late: RoomRepository = { ...d.rooms, get: (c) => d.rooms.get(c), seats: (c) => d.rooms.seats(c), append: async () => false } as RoomRepository;
    expect(failure(await startRoom({ ...d, rooms: late }, code, host))).toEqual({ code: "ALREADY_STARTED" });
  });
});

describe("Feature: playing from a phone", () => {
  const firstCorner = async (d: RoomDeps, code: string) => {
    const state = replayPlay(await d.rooms.events(code));
    return { player: currentPlayer(state) ?? "", vertex: legalSetupSettlements(state)[0] ?? -1 };
  };

  it("given the right token, the move is ruled on and stored", async () => {
    const { d, code, ana } = await startedRoom();
    const { player, vertex } = await firstCorner(d, code);
    expect(player).toBe("Ana");
    expect(unwrap(await runRoomCommand(d, code, ana, { type: "PlaceSetupSettlement", player, vertex }))).toEqual({ moves: 2 });
  });

  it("given the lobby, refuses moves", async () => {
    const { d, code } = await lobby();
    const { token } = unwrap(await joinRoom(d, code, "Ana"));
    expect(failure(await runRoomCommand(d, code, token, { type: "EndTurn", player: "Ana" }))).toEqual({ code: "NOT_STARTED" });
  });

  it("given another player's token, refuses and stores nothing", async () => {
    const { d, code, ben } = await startedRoom();
    const { vertex } = await firstCorner(d, code);
    expect(failure(await runRoomCommand(d, code, ben, { type: "PlaceSetupSettlement", player: "Ana", vertex }))).toEqual({
      code: "NOT_YOUR_SEAT",
      seat: "Ben",
    });
    expect((await d.rooms.get(code))?.version).toBe(1);
  });

  it("given an unknown token, refuses", async () => {
    const { d, code } = await startedRoom();
    expect(failure(await runRoomCommand(d, code, "forged", { type: "EndTurn", player: "Ana" }))).toEqual({ code: "BAD_TOKEN" });
  });

  it("given a seat claimed after the start, that phone is told it is not playing", async () => {
    const { d, code } = await startedRoom();
    await d.rooms.claimSeat(code, 2, { name: "Late", tokenHash: d.hashToken("late") });
    expect(failure(await runRoomCommand(d, code, "late", { type: "EndTurn", player: "Late" }))).toEqual({ code: "NOT_A_PLAYER" });
  });

  it("given a move the rules refuse, passes the reason on", async () => {
    const { d, code, ben } = await startedRoom();
    const result = await runRoomCommand(d, code, ben, { type: "EndTurn", player: "Ben" });
    expect(failure(result)?.code).toBe("RULES");
  });

  it("given a start command from a phone, refuses it", async () => {
    const { d, code, ana } = await startedRoom();
    expect(failure(await runRoomCommand(d, code, ana, { type: "StartGame", players: ["x", "y"], seed: 1 }))).toEqual({
      code: "NOT_ALLOWED",
      command: "StartGame",
    });
  });

  it("given an unknown room, refuses", async () => {
    expect(failure(await runRoomCommand(deps(), "ZZZZ", "t", { type: "EndTurn", player: "Ana" }))).toEqual({ code: "NO_SUCH_ROOM" });
  });

  it("given the phone's dice, ignores them and uses the server's", async () => {
    const d = deps();
    const { code, ana, ben } = await startedRoom(d);
    const tokens: Record<string, string> = { Ana: ana, Ben: ben };
    for (let i = 0; i < 8; i++) {
      const state = replayPlay(await d.rooms.events(code));
      const player = currentPlayer(state) ?? "";
      const command =
        state.pendingSettlement === null
          ? ({ type: "PlaceSetupSettlement", player, vertex: legalSetupSettlements(state)[0] ?? -1 } as const)
          : ({ type: "PlaceSetupRoad", player, edge: legalSetupRoads(state)[0] ?? -1 } as const);
      unwrap(await runRoomCommand(d, code, tokens[player] ?? "", command));
    }
    unwrap(await runRoomCommand({ ...d, random: () => 1 }, code, ana, { type: "RollDice", player: "Ana", dice: [6, 6] }));
    expect((await d.rooms.events(code)).at(-1)).toEqual({ type: "DiceRolled", player: "Ana", dice: [2, 2] });
  });

  it("given someone else moved first, re-runs the move on the new log", async () => {
    const { d, code, ana } = await startedRoom();
    const { player, vertex } = await firstCorner(d, code);
    let raced = false;
    const racing = {
      ...d.rooms,
      get: (c: string) => d.rooms.get(c),
      seats: (c: string) => d.rooms.seats(c),
      events: (c: string, a?: number) => d.rooms.events(c, a),
      append: async (c: string, expected: number, events: Parameters<RoomRepository["append"]>[2]) => {
        if (!raced) {
          raced = true;
          return false;
        }
        return d.rooms.append(c, expected, events);
      },
    } as RoomRepository;
    expect(unwrap(await runRoomCommand({ ...d, rooms: racing }, code, ana, { type: "PlaceSetupSettlement", player, vertex }))).toEqual({ moves: 2 });
  });

  it("given the log keeps moving, gives up and says busy", async () => {
    const { d, code, ana } = await startedRoom();
    const { player, vertex } = await firstCorner(d, code);
    const losing = { ...d.rooms, get: (c: string) => d.rooms.get(c), seats: (c: string) => d.rooms.seats(c), events: (c: string) => d.rooms.events(c), append: async () => false } as RoomRepository;
    expect(failure(await runRoomCommand({ ...d, rooms: losing }, code, ana, { type: "PlaceSetupSettlement", player, vertex }))).toEqual({ code: "BUSY" });
  });
});

describe("Feature: what each screen is shown", () => {
  it("given the lobby, shows the seats, who has joined, and no game yet", async () => {
    const { d, code } = await lobby(deps(), 3);
    unwrap(await joinRoom(d, code, "Ana"));
    const view = asView(unwrap(await getRoomView(d, code, null)));
    expect(view).toMatchObject({ code, started: false, host: false, you: null, version: viewVersion(0, 3, 1) });
    expect(view.seats).toEqual([
      { name: "Ana", joined: true },
      { name: null, joined: false },
      { name: null, joined: false },
    ]);
    expect(view.history).toEqual([]);
  });

  it("given the host token, says this is the host's screen", async () => {
    const { d, code, host } = await lobby();
    expect(asView(unwrap(await getRoomView(d, code, host))).host).toBe(true);
  });

  it("given a seat's token, says who the screen is playing as", async () => {
    const { d, code, ben } = await startedRoom();
    const view = asView(unwrap(await getRoomView(d, code, ben)));
    expect(view).toMatchObject({ you: "Ben", host: false, started: true });
  });

  it("given the board after the start, shows public information only", async () => {
    const { d, code } = await startedRoom();
    const view = asView(unwrap(await getRoomView(d, code, null)));
    expect(view.history).toEqual(["Game started: Ana, Ben"]);
    expect(new Set(view.state.deck)).toEqual(new Set(["knight"]));
  });

  it("given the screen is up to date, answers with only the version", async () => {
    const { d, code } = await startedRoom();
    const v = viewVersion(1, 2, 2);
    expect(unwrap(await getRoomView(d, code, null, v))).toEqual({ unchanged: true, version: v });
  });

  it("given a resize or a new player, the version changes", async () => {
    const { d, code, host } = await lobby(deps(), 3);
    const v0 = asView(unwrap(await getRoomView(d, code, null))).version;
    unwrap(await resizeRoom(d, code, host, 4));
    const v1 = asView(unwrap(await getRoomView(d, code, null, v0))).version;
    unwrap(await joinRoom(d, code, "Ana"));
    expect("unchanged" in unwrap(await getRoomView(d, code, null, v1))).toBe(false);
  });

  it("keeps moves, seats and players apart in the version", () => {
    expect(viewVersion(0, 0, 0)).toBe(0);
    expect(viewVersion(1, 0, 0)).toBeGreaterThan(viewVersion(0, 6, 6));
    expect(viewVersion(0, 1, 0)).toBeGreaterThan(viewVersion(0, 0, 6));
  });

  it("given a forged token, refuses rather than showing the board", async () => {
    const { d, code } = await lobby();
    expect(failure(await getRoomView(d, code, "forged"))).toEqual({ code: "BAD_TOKEN" });
  });

  it("given an unknown room, refuses", async () => {
    expect(failure(await getRoomView(deps(), "ZZZZ", null))).toEqual({ code: "NO_SUCH_ROOM" });
  });
});

describe("Feature: telling screens about changes", () => {
  it("given a join, a resize, the start and a move, tells the screens; a refusal tells nobody", async () => {
    const told: string[] = [];
    const d = deps({ notify: async (c) => void told.push(c) });
    const { code, host } = await lobby(d, 2);
    const ana = unwrap(await joinRoom(d, code, "Ana")).token;
    unwrap(await joinRoom(d, code, "Ben"));
    unwrap(await resizeRoom(d, code, host, 3));
    unwrap(await startRoom(d, code, host));
    expect(told).toHaveLength(4);
    await runRoomCommand(d, code, ana, { type: "EndTurn", player: "Ana" }); // refused: setup
    expect(told).toHaveLength(4);
    const vertex = legalSetupSettlements(replayPlay(await d.rooms.events(code)))[0] ?? -1;
    unwrap(await runRoomCommand(d, code, ana, { type: "PlaceSetupSettlement", player: "Ana", vertex }));
    expect(told).toHaveLength(5);
  });

  it("given the notifier fails, the move still counts", async () => {
    const d = deps({ notify: async () => Promise.reject(new Error("socket api down")) });
    const { code, ana } = await startedRoom(d);
    const vertex = legalSetupSettlements(replayPlay(await d.rooms.events(code)))[0] ?? -1;
    expect(unwrap(await runRoomCommand(d, code, ana, { type: "PlaceSetupSettlement", player: "Ana", vertex }))).toEqual({ moves: 2 });
  });
});

describe("Feature: words for room problems", () => {
  it.each([
    [{ code: "NO_SUCH_ROOM" }, /no room with that code/],
    [{ code: "BAD_SEAT_COUNT", min: 2, max: 6 }, /2 to 6 players/],
    [{ code: "SEATS_TAKEN", taken: 3 }, /3 seats are taken/],
    [{ code: "BAD_NAME", max: 20 }, /1 to 20 characters/],
    [{ code: "NAME_TAKEN", name: "Ana" }, /already called Ana/],
    [{ code: "ROOM_FULL" }, /full/],
    [{ code: "NOT_HOST" }, /created the room/],
    [{ code: "ALREADY_STARTED" }, /already started/],
    [{ code: "NOT_STARTED" }, /not started yet/],
    [{ code: "TOO_FEW_PLAYERS", min: 2, joined: 1 }, /At least 2 .*1 so far/],
    [{ code: "BAD_TOKEN" }, /not seated/],
    [{ code: "NOT_A_PLAYER" }, /joined after the game started/],
    [{ code: "NOT_YOUR_SEAT", seat: "Ana" }, /playing as Ana/],
    [{ code: "NOT_ALLOWED", command: "StartGame" }, /cannot be done from a phone/],
    [{ code: "BUSY" }, /busy/],
    [{ code: "RULES", violation: { code: "GAME_NOT_STARTED" } }, /Start a game first/],
  ] as [RoomError, RegExp][])("describes %j", (error, words) => {
    expect(describeRoomError(error)).toMatch(words);
  });
});
