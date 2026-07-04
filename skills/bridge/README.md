# bridge

A zero-dependency agent board: node stdlib server + vanilla-ES-module web UI + `bridge-axi`
CLI. An AI agent feeds cards, events, and chat; a human follows along live and steers.
See `SKILL.md` for the agent-facing guide; this file documents the HTTP API.

```
server.js       the server (node server.js --port 4777 --board default --host 0.0.0.0)
bridge-axi      agent CLI (run with no args for usage)
ui/             static UI (index.html + app.css + js/ ES modules), served by the server
migrate-v1.js   one-shot v1 → v2 board converter
```

State: `~/.bridge/boards/<name>.json` (board), `<name>.archive.jsonl` (killed cards,
append-only), `<name>.feedback.jsonl` (human→agent queue), `<name>.feedback.ack`
(committed ack cursor; `<name>.cursor` is the legacy CLI cursor, read once at upgrade),
`~/.bridge/config.json` (user config, e.g. TTS voice filter).

## Data model (v2)

```jsonc
{
  "title": "…", "subtitle": "…", "seq": 42,          // seq: global event counter
  "columns": [{"id": "todo", "title": "📌 Todo"}],    // owned state, ordered
  "cards": [{
    "id": "fix-login", "title": "Fix login", "column": "todo",
    "labels": ["urgent"],                              // USER-owned
    "attributes": {"type": "implementation", "owner": "agent-a", "pr": "https://…"},
    "body": "## Current state\n…",                    // markdown, rewritten as work evolves
    "created": "…", "updated": "…", "threadStart": "…", // threadStart: fixed chat anchor
    "status": {"worker": {"id": "fix-1", "state": "working", "expires": "…"}}, // lease; only status.set writes it
    "events": [{"seq": 7, "ts": "…", "level": 1, "kind": "handoff", "text": "…", "actor": "agent"}],
    "thread": [{"author": "agent|user", "text": "…", "ts": "…"}]
  }],
  "chat":   [{"author": "agent|user", "text": "…", "ts": "…"}],
  "events": [ /* board-level events (no card, or archived-card records) */ ],
  "labels": [{"name": "urgent", "color": "#e06c75"}],  // USER-owned registry
  "reads":  {"user": {"notifSeq": 0, "notifSeqs": [], "threads": {"chat": "…"}}}
}
```

Events are append-only with a global monotonic `seq`. The unified stream = board events +
all card events ordered by seq; notifications are its level-1 slice. Event kinds:
`alert` 🚨 `question` ❓ `handoff` 👀 `success` ✅ `info` 💡.

## API

All bodies are JSON. Errors: `{"error": "…"}` with 4xx.

### Read

| Route | Returns |
|---|---|
| `GET /` , `GET /ui/*` | the web UI |
| `GET /api/board` | full board doc; every card carries a derived `status` (see Status) |
| `GET /api/cards/<id>` | one card, with derived `status` |
| `GET /api/status` | `{board, port, cards, seq, feedback_seq, feedback_ack, awaiting, stale, pid}` |
| `GET /api/archive?limit=N` | last N archived records, newest first |
| `GET /api/notifications?user=U` | level-1 events with read flags, `{items, unread}` |
| `GET /api/config` | user config (voice filter) |
| `GET /api/events` | SSE: `board` (full doc on every change) + `status` (`{awaiting, stale}`) |
| `GET /api/poll[?since=N][&nowait=1]` | long-poll the human→agent feedback queue |
| `POST /api/poll/ack` | `{seq}` — commit the ack cursor (see Feedback queue) |

### Cards

| Route | Body | Notes |
|---|---|---|
| `POST /api/cards` | `{title, id?, column?, labels?, attributes?, body?, actor?}` | create; default column = first; id slugged from title; records a "created" event. `actor` ≠ `agent` also pushes a `card-created` feedback so the agent wakes. 409 on existing id. |
| `PATCH /api/cards/<id>` | `{title?, body?, labels?, attributes?}` | attributes merge per key; value `null` deletes a key. No event is emitted — pair with an explicit event when the change is signal-worthy. |
| `POST /api/cards/<id>/move` | `{column, actor?, level?, kind?}` | records a timeline event with the actor. Default level: agent move = 1 (notifies the human), user move = 2. User moves push `card-moved` feedback. |
| `POST /api/cards/<id>/events` | `{text, level?, kind?, actor?}` | append event (default level 2 / kind info) |
| `POST /api/cards/<id>/archive` | `{actor?, reason?, level?, kind?}` | kill = archive: snapshot to the archive file, remove from board, level-1 ✅ board event by default |
| `POST /api/cards/<id>/status` | `{worker: {id, state} \| null, ttl?}` | `status.set` — link a worker to the card as a lease. `state` ∈ `absent\|idle\|working\|needs-you`; `ttl` in seconds (default 600; `BRIDGE_WORKER_TTL_SECS`). `null` worker or state `absent` unlinks. |

### Status

Every card goes out with one derived `status` object — `{worker: {id, state}, owed, unread}`:

- `worker` — the lease written by `status.set`. Past its TTL, `working`/`needs-you` decays to
  `idle` at read time (the expiry timestamp is persisted; no timers, so decay survives a
  restart). No worker linked → `{id: null, state: "absent"}`.
- `owed` — server-derived, nobody writes it: true iff the latest thread message is the user's
  with no agent reply after it.
- `unread` — server-derived: true iff a level-1 event or an agent reply landed after the
  user's last read of the card (`POST /api/read`).

The `awaiting`/`stale` arrays on `GET /api/status` and the SSE `status` event are a legacy
mapping derived from `owed` (kept for the current UI; retired at the API cut).

### Board

| Route | Body | Notes |
|---|---|---|
| `PUT /api/columns` | `[{id, title}]` | replace the column frame; identical frame = no-op (idempotent) |
| `PATCH /api/board` | `{title?, subtitle?}` | board meta |
| `POST /api/events` | `{text, level?, kind?, actor?}` | board-level event (free-form notification, default level 1) |
| `POST /api/labels` | `{create:{name,color?}}` \| `{rename:{from,to}}` \| `{recolor:{name,color}}` \| `{delete:{name}}` | label registry; rename/delete cascade to cards |

### Chat and read state

| Route | Body | Notes |
|---|---|---|
| `POST /api/message` | `{target, text\|text_md, author?}` | agent → human. Target `chat` or `card:<id>`. A main-chat agent message also emits a level-1 💡 event (free-form notification). Clears the target's "awaiting" flag. |
| `POST /api/feedback` | `{target, text}` | human → agent: appends to the thread, queues a durable `message` feedback, sets "awaiting" (typing indicator). A target awaiting longer than the stale threshold (180s; `BRIDGE_AWAITING_STALE_SECS` overrides) is also reported `stale` — the UI shows a "may be stuck" warning instead of healthy typing. |
| `POST /api/notifications/read` | `{user?, seqs?[], all?}` | persist notification read state |
| `POST /api/read` | `{user?, target, ts?}` | persist a thread read marker (unread badges) |

### Feedback queue (at-least-once)

`GET /api/poll` blocks up to 60s and returns
`{events: [{seq, ts, kind, target, text, …}], cursor, ack}`. Kinds: `message`,
`card-created` (+`column`), `card-moved` (+`from`, `column`). Without `?since=N` it
serves everything past the server's **committed ack cursor** — and polling never
advances that cursor. Delivery is committed only by `POST /api/poll/ack {seq}`
(`bridge-axi ack <seq>`), sent after the agent has handled the feedback; until then
every poll re-offers the same events, so an agent/poller killed mid-handling loses
nothing (duplicates are possible — dedupe by `seq`). The queue is durable jsonl; the
ack cursor persists in `<name>.feedback.ack` (initialized once from the legacy
`<name>.cursor` on upgrade).

## UI notes

Desktop: chat panel left (always open), board right. The main chat feed interleaves
messages with card-thread bubbles anchored at the point each card conversation started
(fixed anchor; new activity lights the bubble's unread badge, never re-anchors). Clicking
a bubble, a tile's talk entry, or a detail's "💬 talk" switches the whole chat window into
that card's thread ("← back" returns). Mobile (≤760px): bottom Chat/Board tabs, snap-scroll
columns, long-press a tile for the move/archive menu. `Enter` sends, `Shift+Enter`
newline, `/` focuses the filter, `Esc` closes things.
