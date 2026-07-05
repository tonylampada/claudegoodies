---
name: bridge
description: >
  Run a live "agent board" — a local web UI where a human follows an AI agent's work as a
  kanban of cards with timelines and notifications, and talks to the agent in context
  (unified chat with per-card threads). Triggers when the user wants a live board/dashboard
  of agent work, wants to "open the bridge", or an agent needs a visual command surface for
  a human to follow along and steer.
---

# bridge

A local web board driven entirely by shell commands. The agent feeds cards, events, and
messages; the human watches live, replies in context, and moves cards. Agent-agnostic:
any agent with shell access can drive it.

- **Server** (`server.js`): node built-ins only, zero deps. State persists in
  `~/.bridge/boards/<name>.json`; archived cards append to `<name>.archive.jsonl`.
- **CLI** (`bridge-axi`): the agent's whole interface. Never talk HTTP directly; run
  `bridge-axi` with no args for full usage. All commands take `--port` (default 4777)
  and `--board` (default `default`).
- **UI** (`ui/`): vanilla ES modules, no build step. Chat on the left (full height),
  board on the right; collapses to Chat/Board tabs on phones. Card detail shows
  attributes + markdown body + event timeline; the "💬 talk" button switches the chat
  window into that card's thread. Notification bell, drag&drop, long-press move menu,
  filters, label registry, optional TTS voice.

## Core model

- **Columns are owned state**, ordered, set via `bridge-axi columns` (idempotent). A card
  sits in exactly one column; every move is a deliberate act that records a timeline event
  with its actor. Automated feeders must never move cards.
- **Cards**: `{id, title, column, labels, attributes, body, events, thread}`.
  - `attributes`: generic key/value pairs (URLs render as links). Well-known keys the UI
    understands: `type` (sets the tile emoji: plan 🧠, implementation 🔥,
    investigation 🕵️‍♂️; unknown types get a neutral marker), `emoji` (explicit override),
    `owner` (colored, groupable, click-to-filter), `prs` (list of
    `{url, state: open|merged|closed}` — state-colored chips), `artifacts` (list of
    `{uri, label}` — resources hung on the card).
  - `body`: markdown, the card's CURRENT state — rewrite it as work evolves.
  - `events`: append-only timestamped timeline. Level 2 = timeline only; level 1 = also a
    notification. `kind` is an open token: a board can register its own kinds map with
    `bridge-axi kinds <file.json|->` (`{"<kind>": {"emoji": "…", "level": 1|2}}`,
    idempotent replace like `columns`; bare `bridge-axi kinds` prints the effective map).
    Built-ins ship for the bridge's own operations, overridable by the registered map:
    `created` 🐣 2, `moved` 🔁 2, `handoff` 👀 1, `landed` 🏁 1, `killed` 🪦 2,
    `resurrected` 🧟 1, `question` 🙋 1. On append, an explicit `--level` wins, else the
    kind's level from the effective map, else 2; a kind in neither map is stored as-is
    (opaque token, no emoji).
  - `labels`: USER-owned (edited in the UI, managed registry with colors). Agents never
    set or rewrite them.
- **Unified event stream**: board-level events + every card's events, one global sequence.
  The notification queue is the level-1 slice; suppressed level-2 events expand inline in
  the bell dropdown. Per-user read state persists server-side in the board file.
- **Kill = archive**: `bridge-axi archive <id>` snapshots the card to the append-only
  archive file and removes it from the board. No destructive delete; `bridge-axi archived`
  lists recent kills. The board event is typed by reason: `merged` → `landed` 🏁 (level 1),
  `killed` → `killed` 🪦 (level 2 — the human's own act, no bell). An archived card can be
  restored: `bridge-axi restore <id>` brings the most recent snapshot back in full (body,
  events, thread, frozen column) with a loud level-1 `resurrected` 🧟 event; the archive
  record stays, so **the board is truth for liveness** — an
  archive record never by itself means the card is off the board. A card restored into a
  column that has since been removed from the frame won't render until moved.

## Agent loop

1. `bridge-axi open` — start the server if needed (idempotent), print the URL once.
   Binds `127.0.0.1` by default (localhost-only). To reach the board from other devices,
   the user sets `"host"` in `~/.bridge/config.json` (e.g. a VPN/tailnet interface IP) —
   machine-private config, never baked into commands or docs; `--host` overrides for one
   run. A non-loopback bind also listens on `127.0.0.1` so local CLI calls keep working.
2. Feed reality: `create` new cards, `patch` bodies/attributes as state evolves, `event`
   for timeline signals (level 1 only for things the human must see), `move` for real
   state transitions (an agent move defaults to a `handoff` that notifies; pass
   `--kind moved` for a quiet reshuffle), `archive` when work is dead or landed,
   `restore` to resurrect an archived card, `say` to talk.
3. Keep `bridge-axi poll` running as a tracked background task. It BLOCKS until human
   input, prints JSON lines, and exits; handle each line, reply with
   `bridge-axi say <target> --text-file <f>`, then `bridge-axi ack <seq>` (highest seq
   handled), re-run poll. Lines carry `kind`:
   - `message` — human message; `target` is `chat` or `card:<id>`.
   - `card-created` — the human made a card in the UI (`target` names it). Awareness
     only: creating a card is not a demand — a card with an empty thread owes nothing.
     Act when the human speaks in its thread or main chat.
   - `card-moved` — the human moved a card (`from`/`column` fields): a handoff or a
     handback, act accordingly.
4. Always answer feedback with `say` to the same target — the UI shows "agent is working…"
   until the reply lands, and flips to an amber "may be stuck" warning if no reply comes
   within ~3 minutes (`BRIDGE_AWAITING_STALE_SECS` on the server overrides).

Rules:
- Message/body text goes via `--text-file`/`--body-file` or stdin — never interpolated
  into a shell command.
- Delivery is at-least-once: feedback counts as delivered only when `ack`ed, never by
  being polled. An unacked line is re-offered by every poll — so a poller killed
  mid-handling loses nothing, and a repeated line (same `seq`) just means the previous
  handling never acked; dedupe by `seq`. Ack only what you have actually handled.
- Cards are for units of work, not for questions — ask questions in a thread (`say`) plus
  a level-1 `question` event on the card the question belongs to.

## Notifications and read state

The bell is a derived view of everything the human hasn't seen yet — one read-state
mechanism, two scopes: level-1 events (signal emojis) UNION unseen agent thread replies
(kind `reply`; no seq of their own, so they ride the per-thread read marker and show the
💡 fallback emoji — the "· N events ·" gap dividers skip them). Opening a card clears its
unread (events and replies alike); "mark all" marks the event items read AND advances the
thread read markers of cards with unseen replies, so it also clears those cards' unread.
Read state lives in the board JSON per user (default user `user`), so it survives reloads
and devices. Thread unread badges (chat bubbles, tiles) use the same per-thread read
markers, also server-side.

## Voice

`~/.bridge/config.json` `{"voices": ["Some Voice", "Another"]}` — case-insensitive
substring filter for the UI's TTS voice dropdown; absent/empty = full list. Manage with
`bridge-axi config voices "a,b"` / `config show`. The 🔊 toggle persists per browser and
speaks new agent messages (emojis stripped).

## Migration

`node migrate-v1.js <v1-board.json> [out.json]` converts a v1 board doc (columns/cards
with summary/detail_md/badges/links, threads, chat, labels) to the v2 model. It never
writes in place and never touches a server: stop the server, convert, move the file into
`~/.bridge/boards/` yourself.

See `README.md` for the HTTP API reference.
