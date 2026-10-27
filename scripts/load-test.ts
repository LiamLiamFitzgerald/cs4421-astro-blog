/**
 * Load test (#151): real traffic against a running site, local or deployed.
 *
 *   npx jiti scripts/load-test.ts --url https://catan.example.com --scenario rooms --rooms 2 --minutes 2 --think 2000
 *   npx jiti scripts/load-test.ts --url http://127.0.0.1:4321 --scenario pages --visitors 20 --minutes 1
 *
 * rooms: bots create rooms, join, start and play over the API exactly as the
 *        screens do: a board and one phone per player, each polling for its view
 *        with `since`, and each phone moving when the rules say it is its turn.
 * pages: visitors load /catan and every stylesheet and script it links, again
 *        and again, recording latency and whether CloudFront served it from cache.
 *
 * Prints a Markdown report (also to GITHUB_STEP_SUMMARY when set) and writes raw
 * numbers with --out. Everything runs from one address, so the per-client limits
 * (ADR-019) apply: 429s in the report are those limits, not failures.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import type { RoomView } from "../src/lib/app/rooms";
import { botMove } from "../src/lib/games/catan-play/bot";

type Kind = "create" | "join" | "start" | "view-full" | "view-unchanged" | "view-refused" | "command" | "page" | "asset";
interface Sample {
  kind: Kind;
  status: number;
  ms: number;
  cache?: string;
}

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]?.replace(/^--/, "") ?? "", process.argv[i + 1] ?? "");
const BASE = (args.get("url") ?? process.env["TARGET_URL"] ?? "http://127.0.0.1:4321").replace(/\/$/, "");
const SCENARIO = args.get("scenario") ?? "rooms";
const MINUTES = Number(args.get("minutes") ?? "1");
const ROOMS = Number(args.get("rooms") ?? "2");
const PLAYERS = Number(args.get("players") ?? "4");
const VISITORS = Number(args.get("visitors") ?? "10");
const POLL_MS = Number(args.get("poll") ?? "1500");
/** How long a bot "thinks" before each move; 0 is a stress test, a few seconds is closer to people. */
const THINK_MS = Number(args.get("think") ?? "2000");
const OUT = args.get("out");

const samples: Sample[] = [];
const deadline = Date.now() + MINUTES * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function timed(kind: Kind, path: string, init?: RequestInit & { token?: string | null }): Promise<{ status: number; body: unknown }> {
  const t0 = performance.now();
  try {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.token ? { "x-room-token": init.token } : {}), ...(init?.headers ?? {}) },
    });
    const text = await response.text();
    const sample: Sample = { kind, status: response.status, ms: performance.now() - t0 };
    const cache = response.headers.get("x-cache");
    if (cache) sample.cache = cache;
    samples.push(sample);
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // A page or an asset.
    }
    return { status: response.status, body };
  } catch {
    samples.push({ kind, status: 0, ms: performance.now() - t0 });
    return { status: 0, body: null };
  }
}

const post = (kind: Kind, body: unknown, token: string | null = null) =>
  timed(kind, "/api/rooms", { method: "POST", body: JSON.stringify(body), token });

// ------------------------------------------------------------ rooms

let moves = 0;
let finishedGames = 0;

async function screen(code: string, token: string, me: string | null) {
  let version: number | null = null;
  while (Date.now() < deadline) {
    const res = await timed("view-full", `/api/rooms?code=${code}${version === null ? "" : `&since=${version}`}`, { token });
    const last = samples.at(-1);
    if (last) {
      last.kind = res.status !== 200 ? "view-refused" : res.body && typeof res.body === "object" && "unchanged" in res.body ? "view-unchanged" : "view-full";
    }
    if (res.status === 200 && res.body && typeof res.body === "object" && !("unchanged" in res.body)) {
      const view = res.body as RoomView;
      version = view.version;
      if (view.state.winner) {
        if (me === null) finishedGames += 1;
        return;
      }
      const command = me ? botMove(view.state, me) : null;
      if (command) {
        if (THINK_MS > 0) await sleep(THINK_MS);
        const done = await post("command", { action: "command", code, command }, token);
        if (done.status === 200) moves += 1;
        continue; // look again straight away, as a phone redraws after its own move
      }
    }
    await sleep(POLL_MS);
  }
}

async function room(n: number) {
  const created = await post("create", { action: "create", seats: PLAYERS });
  if (created.status !== 201) return;
  const { code, hostToken } = created.body as { code: string; hostToken: string };
  const seats: { name: string; token: string }[] = [];
  for (let p = 0; p < PLAYERS; p++) {
    const joined = await post("join", { action: "join", code, name: `Bot${n}-${p + 1}` });
    if (joined.status === 201) seats.push({ name: (joined.body as { player: string }).player, token: (joined.body as { token: string }).token });
  }
  const started = await post("start", { action: "start", code }, hostToken);
  if (started.status !== 200) return;
  await Promise.all([screen(code, hostToken, null), ...seats.map((s) => screen(code, s.token, s.name))]);
}

// ------------------------------------------------------------ pages

async function visitor() {
  while (Date.now() < deadline) {
    const page = await timed("page", "/catan");
    const html = typeof page.body === "string" ? page.body : "";
    const assets = [...new Set(html.match(/\/_astro\/[^"']+\.(?:css|js)/g) ?? [])];
    await Promise.all(assets.map((a) => timed("asset", a)));
    await sleep(250);
  }
}

// ------------------------------------------------------------ report

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
};

function report(seconds: number): string {
  const kinds = [...new Set(samples.map((s) => s.kind))];
  const rows = kinds.map((kind) => {
    const of = samples.filter((s) => s.kind === kind);
    const ms = of.map((s) => s.ms);
    const statuses = [...new Set(of.map((s) => s.status))].sort().map((st) => `${st}×${of.filter((s) => s.status === st).length}`);
    return `| ${kind} | ${of.length} | ${pct(ms, 50).toFixed(0)} | ${pct(ms, 95).toFixed(0)} | ${pct(ms, 99).toFixed(0)} | ${Math.max(...ms).toFixed(0)} | ${statuses.join(", ")} |`;
  });
  const total = samples.length;
  const failed = samples.filter((s) => s.status === 0 || s.status >= 500).length;
  const limited = samples.filter((s) => s.status === 429).length;
  const lines = [
    `## Load test: ${SCENARIO} against ${BASE}`,
    "",
    `${total} requests in ${seconds.toFixed(0)} s (${(total / seconds).toFixed(1)}/s). Server errors or no answer: ${failed}. Rate-limited (429): ${limited}.`,
    "",
    "| Request | Count | p50 ms | p95 ms | p99 ms | max ms | Statuses |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows,
  ];
  if (SCENARIO === "rooms") {
    const requests = samples.filter((s) => s.kind !== "create" && s.kind !== "join" && s.kind !== "start").length;
    lines.push(
      "",
      `${ROOMS} rooms of ${PLAYERS} bots, screens polling every ${POLL_MS} ms, thinking ${THINK_MS} ms per move. Moves made: ${moves} (${(moves / (seconds / 60)).toFixed(0)} a minute). Games finished: ${finishedGames}.`,
      `Requests per move: ${moves ? (requests / moves).toFixed(1) : "n/a"}. Requests per room per hour at this rate: ${((requests / ROOMS / seconds) * 3600).toFixed(0)}.`,
    );
  } else {
    const cached = samples.filter((s) => s.cache?.toLowerCase().startsWith("hit")).length;
    const withHeader = samples.filter((s) => s.cache).length;
    lines.push("", `${VISITORS} visitors. Served from CloudFront's cache: ${withHeader ? `${cached} of ${withHeader}` : "no CloudFront headers (local run)"}.`);
  }
  return lines.join("\n");
}

const t0 = Date.now();
if (SCENARIO === "pages") await Promise.all(Array.from({ length: VISITORS }, () => visitor()));
else await Promise.all(Array.from({ length: ROOMS }, (_, n) => room(n + 1)));
const markdown = report((Date.now() - t0) / 1000);
console.log(markdown);
if (process.env["GITHUB_STEP_SUMMARY"]) appendFileSync(process.env["GITHUB_STEP_SUMMARY"], `${markdown}\n`);
if (OUT) writeFileSync(OUT, JSON.stringify({ scenario: SCENARIO, base: BASE, moves, finishedGames, samples }, null, 2));
