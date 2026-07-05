# bridge

A zero-dependency agent board: node stdlib server + vanilla-ES-module web UI + `bridge-axi`
CLI. An AI agent feeds cards, events, and chat; a human follows along live and steers.
See `SKILL.md` for the agent-facing guide; this file documents the HTTP API.

```
server.js       the server (node server.js --port 4777 --board default; bind host:
                --host > "host" in ~/.bridge/config.json > 127.0.0.1)
bridge-axi      agent CLI (run with no args for usage)
ui/             static UI (index.html + app.css + js/ ES modules), served by the server
migrate-v1.js   one-shot v1 → v2 board converter
```

State: `~/.bridge/boards/<name>.json` (board), `<name>.archive.jsonl` (archived cards,
append-only), `<name>.feedback.jsonl` (human→agent queue), `<name>.feedback.ack`
(the committed ack cursor — the only cursor), `~/.bridge/config.json` (user config).

## User config (`~/.bridge/config.json`)

Machine-private; never passed on the command line by agents.

```jsonc
{
  "host": "100.x.y.z",              // bind host. Default 127.0.0.1 (localhost-only).
                                    // Set to a VPN/tailnet interface IP to reach the
                                    // board from other devices without exposing it to
                                    // the LAN. A non-loopback bind also listens on
                                    // 127.0.0.1 so local CLI calls keep working.
                                    // Precedence: --host flag > this key > 127.0.0.1.
  "voices": ["Samantha", "Karen"]   // optional TTS voice filter for the UI 🔊 toggle
}
```

## Data model (v2)

```jsonc
{
  "title": "…", "subtitle": "…", "seq": 42,          // seq: global event counter
  "columns": [{"id": "todo", "title": "📌 Todo"}],    // owned state, ordered
  "cards": [{
    "id": "fix-login", "title": "Fix login", "column": "todo",
    "labels": ["urgent"],                              // USER-owned
    "attributes": {"type": "implementation", "owner": "agent-a",
                   "prs": [{"url": "https://…", "state": "open"}]},
    "body": "## Current state\n…",                    // markdown, rewritten as work evolves
    "created": "…", "updated": "…", "threadStart": "…", // threadStart: fixed chat anchor
    "status": {"worker": {"id": "fix-1", "state": "working", "expires": "…"}}, // lease; only status.set writes it
    "events": [{"seq": 7, "ts": "…", "level": 1, "kind": "handoff", "text": "…", "actor": "agent"}],
    "thread": [{"author": "agent|user", "text": "…", "ts": "…"}]
  }],
  "chat":   [{"author": "agent|user", "text": "…", "ts": "…"}],
  "events": [ /* board-level events (no card, or archived-card records) */ ],
  "labels": [{"name": "urgent", "color": "#e06c75"}],  // USER-owned registry
  "kinds":  {"deploy": {"emoji": "🚀", "level": 1}},    // registered kinds map (overrides built-ins)
  "reads":  {"user": {"notifSeq": 0, "notifSeqs": [], "threads": {"chat": "…"}}}
}
```

Events are append-only with a global monotonic `seq`. The unified stream = board events +
all card events ordered by seq; notifications are its level-1 slice.

A `kind` is an open token. A board may register its own kinds map (`PUT /api/kinds`,
`bridge-axi kinds`): `{"<kind>": {"emoji": "…", "level": 1|2}}`. The bridge ships
built-in defaults only for the kinds its own operations emit, merged UNDER the
registered map (registered entries override): `created` 🐣 2, `moved` 🔁 2,
`handoff` 👀 1, `landed` 🏁 1, `killed` 🪦 2, `resurrected` 🧟 1, `question` 🙋 1.
Level resolution on append: an explicit `level` wins; else the kind's level from the
effective map; else the route default (2 for card events, 1 for board-level events).
A kind in neither map is stored as-is — an opaque token, no emoji. The served board
doc carries the EFFECTIVE map in `kinds`; the file persists only the registered map.

## API

All bodies are JSON. Errors: `{"error": "…"}` with 4xx.

### Read

| Route | Returns |
|---|---|
| `GET /` , `GET /ui/*` | the web UI |
| `GET /api/board` | full board doc; every card carries a derived `status` (see Status) |
| `GET /api/cards/<id>` | one card, with derived `status` |
| `GET /api/status` | `{board, port, cards, seq, feedback_seq, feedback_ack, pid}` |
| `GET /api/archive?limit=N` | last N archived records, newest first |
| `GET /api/kinds` | `{kinds, registered}` — the effective kinds map (built-ins merged under registered) and the registered map alone |
| `GET /api/notifications?user=U` | `{items, unread}` — level-1 events (read flags from notification read state) UNION agent card-thread replies (kind `reply`, no seq; read flag from the thread read marker), newest first. Main chat is excluded: an agent main-chat message already rides its level-1 event |
| `GET /api/config` | user config (voice filter) |
| `GET /api/events` | SSE: `board` (full doc on every change) |
| `GET /api/poll[?since=N][&nowait=1]` | long-poll the human→agent feedback queue |
| `POST /api/poll/ack` | `{seq}` — commit the ack cursor (see Feedback queue) |

### Cards

| Route | Body | Notes |
|---|---|---|
| `POST /api/cards` | `{title, id?, column?, labels?, attributes?, body?, actor?}` | create; default column = first; id slugged from title; records a "created" event. `actor` ≠ `agent` also pushes a `card-created` feedback so the agent wakes. 409 on existing id. |
| `PATCH /api/cards/<id>` | `{title?, body?, labels?, attributes?}` | attributes merge per key; value `null` deletes a key. No event is emitted — pair with an explicit event when the change is signal-worthy. |
| `POST /api/cards/<id>/move` | `{column, actor?, level?, kind?}` | records a timeline event with the actor. Default kind: agent move = `handoff` (level 1 — notifies the human), any other actor = `moved` (level 2); `kind` overrides (e.g. `moved` for a quiet agent move), levels from the effective kinds map. User moves push `card-moved` feedback. |
| `POST /api/cards/<id>/events` | `{text, level?, kind?, actor?}` | append event (kind optional, open token; level: explicit > kind's map level > 2) |
| `POST /api/cards/<id>/archive` | `{actor?, reason?, note?, level?, kind?}` | kill = archive: snapshot to the archive file, remove from board, board event typed by reason — `merged` → `landed` 🏁 (level 1), `killed` → `killed` 🪦 (level 2, no bell). `reason` is the validated enum `merged \| killed` (default `killed`; anything else is a 400); optional free-text `note` is preserved on the record |
| `POST /api/cards/<id>/restore` | `{actor?, text?, kind?, level?}` | resurrection: bring the most recent archived snapshot for the id back onto the board — frozen body/events/thread/attributes/column restored in full, worker lease starting absent. Appends a loud `resurrected` 🧟 level-1 event (`text` default `resurrected`). The archive log is untouched (append-only; the original record remains). 404 if never archived, 409 if already on the board. |
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

`card.status` is the single read source for worker/owed/unread — nothing is mirrored into
attributes, and `status.set` is the only writer. The one remaining compatibility path is
load-time data migration: a stored pre-status-model `attributes.worker` value in an old
board file is adopted as a lease when the board loads (default TTL; worker id = existing
lease id or the card id).

### Board

| Route | Body | Notes |
|---|---|---|
| `PUT /api/columns` | `[{id, title}]` | replace the column frame; identical frame = no-op (idempotent) |
| `PUT /api/kinds` | `{"<kind>": {"emoji": "…", "level": 1\|2}}` | replace the registered kinds map; identical map = no-op (idempotent). Registered entries override the built-ins; `{}` clears back to built-ins only |
| `PATCH /api/board` | `{title?, subtitle?}` | board meta |
| `POST /api/events` | `{text, level?, kind?, actor?}` | board-level event (free-form notification, default level 1) |
| `POST /api/labels` | `{create:{name,color?}}` \| `{rename:{from,to}}` \| `{recolor:{name,color}}` \| `{delete:{name}}` | label registry; rename/delete cascade to cards |

### Chat and read state

| Route | Body | Notes |
|---|---|---|
| `POST /api/message` | `{target, text\|text_md, author?}` | agent → human. Target `chat` or `card:<id>`. A main-chat agent message also emits a level-1 event (free-form notification). An agent reply clears the target's derived `owed`. |
| `POST /api/feedback` | `{target, text}` | human → agent: appends to the thread and queues a durable `message` feedback. The latest-message-is-the-user's rule flips the target's derived `owed` (the UI's "agent owes you a reply" balloon; owed unanswered past ~180s renders as "may be stuck", derived client-side). |
| `POST /api/notifications/read` | `{user?, seqs?[], all?}` | persist notification read state. `all` also advances the thread read marker of every card with unseen agent replies (clearing is reading — reply items have no seq to mark) |
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
ack cursor persists in `<name>.feedback.ack`, the only cursor.

## UI notes

Desktop: chat panel left (always open), board right. The main chat feed interleaves
messages with card-thread bubbles anchored at the point each card conversation started
(fixed anchor; new activity lights the bubble's unread badge, never re-anchors). Clicking
a bubble, a tile's talk entry, or a detail's "💬 talk" switches the whole chat window into
that card's thread ("← back" returns). Mobile (≤760px): bottom Chat/Board tabs, snap-scroll
columns, long-press a tile for the move/archive menu. `Enter` sends, `Shift+Enter`
newline, `/` focuses the filter, `Esc` closes things.
