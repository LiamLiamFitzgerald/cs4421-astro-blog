/**
 * Room view benchmark (#151). For game logs of growing length it measures what
 * one screen's view costs the server:
 *
 *   - time to build the view (replaying the log and describing it), median of runs
 *   - DynamoDB read capacity units (RCU) for that view, modelled the way DynamoDB
 *     bills strongly consistent reads (4 KB per unit, per item for GetItem, per
 *     query total for Query), using the real adapter on a metered table
 *   - the size of the JSON sent to the screen
 *
 *   npx jiti scripts/bench-rooms.ts [--json out.json]
 *
 * Logs come from bots playing through the real rules, so they look like games.
 */
import { writeFileSync } from "node:fs";
import { DynamoDbRoomRepository, type Item, MemoryTable, type Table } from "../src/lib/adapters/dynamodb-room-repository";
import { getRoomView, type RoomDeps, viewVersion } from "../src/lib/app/rooms";
import { botMove } from "../src/lib/games/catan-play/bot";
import { decide } from "../src/lib/games/catan-play/decide";
import type { PlayEvent } from "../src/lib/games/catan-play/events";
import { evolve } from "../src/lib/games/catan-play/evolve";
import { actingPlayer } from "../src/lib/games/catan-play/queries";
import { initialPlayState } from "../src/lib/games/catan-play/state";
import { viewFor, withServerRandomness } from "../src/lib/games/catan-play/views";

const PLAYERS = ["Ana", "Ben", "Cy", "Dee"];
const LENGTHS = [50, 150, 300, 600];
const RUNS = 30;
/** Read units the rooms table is provisioned with (ADR-019). */
const TABLE_RCU = 10;
const SCREENS = PLAYERS.length + 1;

/** A bot game through the real rules, as long as it lasts up to `max` events. */
function botGame(max: number, seed = 20261027): PlayEvent[] {
  let state = initialPlayState;
  const log: PlayEvent[] = [];
  const start = decide(state, { type: "StartGame", players: PLAYERS, seed });
  if (!start.ok) throw new Error("start refused");
  let i = 0;
  const random = (n: number) => (Math.imul(i++ + 1, 2654435761) >>> 0) % n;
  const apply = (events: readonly PlayEvent[]) => {
    for (const e of events) state = evolve(state, e);
    log.push(...events);
  };
  apply(start.value);
  while (log.length < max && !state.winner) {
    const me = actingPlayer(state);
    const command = me ? botMove(viewFor(state, me).state, me) : null;
    if (!me || !command) break;
    const decision = decide(state, withServerRandomness(command, state, random));
    if (!decision.ok) throw new Error(`bot move refused: ${JSON.stringify(decision.error)}`);
    apply(decision.value);
  }
  return log.slice(0, max);
}

/** Counts read units the way DynamoDB bills strongly consistent reads. */
class MeteredTable implements Table {
  rcu = 0;
  items = 0;
  constructor(private readonly inner: Table) {}
  private size = (item: Item) => Buffer.byteLength(JSON.stringify(item));
  reset() {
    this.rcu = 0;
    this.items = 0;
  }
  async get(pk: string, sk: string) {
    const item = await this.inner.get(pk, sk);
    this.rcu += Math.max(1, Math.ceil((item ? this.size(item) : 0) / 4096));
    this.items += item ? 1 : 0;
    return item;
  }
  async query(pk: string, prefix: string, after?: string) {
    const items = await this.inner.query(pk, prefix, after);
    const bytes = items.reduce((n, i) => n + this.size(i), 0);
    this.rcu += Math.max(1, Math.ceil(bytes / 4096));
    this.items += items.length;
    return items;
  }
  putIfAbsent = (item: Item) => this.inner.putIfAbsent(item);
  delete = (pk: string, sk: string) => this.inner.delete(pk, sk);
  updateIf = (pk: string, sk: string, set: Record<string, unknown>, when: Record<string, unknown>) =>
    this.inner.updateIf(pk, sk, set, when);
  appendAt = (pk: string, e: number, n: number, items: Item[]) => this.inner.appendAt(pk, e, n, items);
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

async function measure(length: number) {
  const table = new MeteredTable(new MemoryTable());
  const rooms = new DynamoDbRoomRepository(table, () => new Date("2026-10-27T12:00:00Z"));
  const deps: RoomDeps = {
    rooms,
    random: () => 0,
    now: () => new Date("2026-10-27T12:00:00Z"),
    newToken: () => "t",
    hashToken: (t) => `#${t}`,
  };
  await rooms.create({ code: "BNCH", seats: PLAYERS.length, hostTokenHash: "#host", createdAt: "2026-10-27T12:00:00Z", expiresAt: 4102444800 });
  for (const [i, name] of PLAYERS.entries()) await rooms.claimSeat("BNCH", i, { name, tokenHash: `#${name}` });
  const log = botGame(length);
  await rooms.append("BNCH", 0, log);

  const times: number[] = [];
  let bytes = 0;
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now();
    const view = await getRoomView(deps, "BNCH", "Ana");
    times.push(performance.now() - t0);
    if (!view.ok) throw new Error(JSON.stringify(view.error));
    bytes = Buffer.byteLength(JSON.stringify(view.value));
  }
  table.reset();
  await getRoomView(deps, "BNCH", "Ana");
  const fullRcu = table.rcu;
  const fullItems = table.items;
  table.reset();
  await getRoomView(deps, "BNCH", null, viewVersion(log.length, PLAYERS.length, PLAYERS.length));
  const unchangedRcu = table.rcu;
  return { events: log.length, ms: median(times), fullRcu, fullItems, unchangedRcu, kb: bytes / 1024 };
}

const results = [];
for (const length of LENGTHS) results.push(await measure(length));

const lines = [
  "| Events in the log | Build one view (ms, median) | Read units per full view | Items read | Read units for \"nothing new\" | View size (KB) | Read units per move, 5 screens | Seconds of table capacity per move |",
  "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...results.map(
    (r) =>
      `| ${r.events} | ${r.ms.toFixed(2)} | ${r.fullRcu} | ${r.fullItems} | ${r.unchangedRcu} | ${r.kb.toFixed(1)} | ${r.fullRcu * SCREENS} | ${((r.fullRcu * SCREENS) / TABLE_RCU).toFixed(1)} |`,
  ),
];
console.log(lines.join("\n"));
const out = process.argv.indexOf("--json");
if (out > 0 && process.argv[out + 1]) writeFileSync(process.argv[out + 1] as string, JSON.stringify(results, null, 2));
