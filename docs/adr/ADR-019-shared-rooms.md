# ADR-019: Shared rooms with a server-authoritative game log

- **Status:** Proposed (2026-10-23)
- **Deciders:** Liam Fitzgerald
- **Issues:** #124 (core), #125 (API), #126 (screens), #127 (cost ceilings), #128 (push)
- **Builds on:** ADR-004 (event sourcing), ADR-006 (event store port), ADR-010
  (Lambda), ADR-011 (randomness from the caller), ADR-014 (game log in error
  handling), ADR-015 (alarms)

## Context

A played game lives in one browser and is passed round one device. The goal is
**rooms**: a shared screen shows the board, each player joins on their own phone
with a room code, and the phone is that player's controller, showing their
private hand and cards.

That needs a log every screen can reach, someone to rule on moves, a way to keep
hidden information hidden, and a way for screens to learn about new moves. The
project has **no reliable AWS budget** (ADR-010), so cost is a design constraint,
not an afterthought: the aim is a system that can be left alone for months and
opened whenever someone wants to play.

## Decision

1. **The server is the arbiter.** Phones and the board send *commands*, never
   events. The Lambda loads the room's log, runs the existing pure `decide`, and
   appends the resulting events. The rules modules do not change.
2. **The log lives in DynamoDB**, through a new adapter for the existing
   `EventStore` port:
   - One table: partition key `ROOM#<code>`, sort key `EVT#<seq>` (zero-padded,
     so events come back in order). A `META` item per room holds the seats,
     hashed player tokens, the creation time and an expiry.
   - **Optimistic concurrency:** each append is a conditional write ("only if
     event `seq` does not exist yet"). If two players act at the same instant,
     one wins and the other is retried against the new state.
   - **Provisioned capacity inside the always-free allowance**, not on-demand, so
     the database is a hard cost ceiling: too much traffic is throttled, not
     billed.
   - **TTL** deletes every room 24 hours after its last move.
3. **Randomness comes from the server.** Dice, steals and the board seed are
   generated in the Lambda and stored as event facts (as ADR-011 requires). A
   phone cannot choose its roll.
4. **Players are identified by tokens, not accounts.** Joining a seat returns a
   random token, which the phone keeps in `localStorage` so a refresh or reopen
   rejoins the same seat. Commands without the matching token are refused. Only a
   hash of each token is stored.
5. **Hidden information is projected on the server.** The board receives a
   *public view* (board, pieces, card counts, scores without hidden victory
   points); each phone receives the public view plus *its own* hand and
   development cards. No response ever contains another player's private cards or
   the deck order.
6. **Updates are pushed, with polling as the fallback**, behind a `RoomFeed`
   port:
   - Every screen loads and catches up with `GET /api/rooms/<code>/view?since=<version>`,
     which answers "nothing new" when the version is unchanged.
   - Screens connect to an API Gateway WebSocket. After a move is appended, each
     connection in the room is sent a small "changed to version N" notice and
     fetches its own view. Private cards never travel over the broadcast.
   - When the socket is down, a screen polls every 1.5 s while visible and
     active, backs off to 10 s after a minute without moves, and stops while the
     tab is hidden; it reconnects with back-off.
   - Rooms ship with polling first and push second, so there is never a point
     without a working game.
7. **The endpoints** run on the existing Lambda: create a room (board), join a
   seat (phone), send a command, get the view. The room code is 4 letters from an
   unambiguous alphabet.
8. **Guardrails, so it can be left alone:** an optional reserved concurrency
   cap (`MAX_CONCURRENCY`; accounts whose total Lambda limit is 10 cannot reserve
   any and are capped at 10 by AWS); limits on room creation and request rates;
   one-week log retention (ADR-015); a throttling alarm on the table; and a
   **kill switch**: a monthly budget (`BUDGET_USD`, default 5 dollars) notifies a
   function that sets the app's concurrency to 0 and emails the alarm topic.
   `revive` in the App Environment workflow turns the site back on.
9. **Local and test setup:** a memory adapter for local development and e2e
   tests; the DynamoDB adapter passes the shared `EventStore` contract tests
   against an in-memory stand-in that enforces the same conditional writes.

## Cost model

One 1-hour game: a board plus 4 phones, about 300 moves.

| Resource | Use per game | Always-free allowance | Free games / month | Beyond free |
| --- | --- | --- | --- | --- |
| Lambda requests, polling only | 6,000 to 12,000 | 1M requests | about 80 to 160 | about $0.002 |
| Lambda requests, with push | about 1,800 (moves and view fetches) | 1M requests | about 500 | about $0.0004 |
| WebSocket messages and connection minutes | about 1,500 and 300 | none assumed | n/a | about $0.002 |
| Lambda compute | about 100 to 300 GB-s | 400k GB-s | over 1,000 | about $0.005 |
| DynamoDB | about 300 writes, a few thousand reads | provisioned free units | unlimited (throttled, never billed) | $0 |
| CloudFront | the same requests | 10M requests | about 800 | small |
| CloudWatch logs | 1 to 3 MB | 5 GB | about 2,000 | small |

**Bottlenecks, in order:**

1. **Lambda requests from polling.** Push removes most of them, which is why it
   follows straight after.
2. **CloudWatch log volume**, because every request writes a log line.
3. **Fixed costs that grow without games:** an image left in ECR by every deploy
   (about $0.10 per GB-month) and S3 asset files. Clean up with `cdk gc` or a
   lifecycle rule.

**Expected cost: free for hundreds of games a month with push, roughly a cent per
game beyond that.**

## Consequences

- Moves are ruled on by the server; nobody can cheat and hidden cards stay hidden.
- A game survives the board tab closing; any screen can rejoin.
- Ports and adapters pay off: the same rules over a new store and a new feed, with
  no rule changes.
- ADR-014 improves: the log is on the server, so a report only needs the room id.
- **Costs:** a cold start makes the first request after a quiet spell take 1 to 3
  seconds; polling, while it is the fallback, is the main cost driver.
- **New risks:** a public API that writes to a database. It needs rate limits,
  size limits, token checks and TTL, all specified above.

## Alternatives considered

- **Board as arbiter, AWS as a relay.** Cheap and disposable, but it needs the
  WebSocket infrastructure from day one, the game pauses if the board tab closes,
  and the board owner could cheat.
- **Peer to peer (WebRTC).** Almost no server traffic, but university and mobile
  networks often block device-to-device connections, which is a real risk for a
  live demo, and the fallback relays cost money.
- **Browsers reading and writing the database directly.** Would need AWS
  credentials in the browser: anyone could forge events or read everyone's cards.
- **Push only, no polling.** Fewer moving parts on paper, but sockets drop
  (phones sleep, API Gateway closes idle connections after 10 minutes), so a
  catch-up path is needed anyway; polling is that path.
- **On-demand DynamoDB.** No capacity planning, but no ceiling. Provisioned
  capacity inside the free allowance turns overuse into throttling, not a bill.
