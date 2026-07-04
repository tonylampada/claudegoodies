# bridge — Conceptual API (DNA)

> **Draft target spec.** The upcoming rebuild implements this; current code predates it.

bridge is a generic agent kanban board: a zero-dep node server, a vanilla JS UI for the user, and a CLI for the agent. It knows nothing about any particular agent system — it stores structure, derives a few signals, and delivers messages. The **meaning** of the values a client writes (`type`, custom attributes, worker ids) is the client agent's business.

Columns are **board configuration**, not a fixed set. A client defines whatever columns its workflow needs; the board just holds them.

## Entities

### Card — the unit of work

| attribute | values | meaning |
|---|---|---|
| `title` | text | the face; short, imperative |
| `column` | one of the board's configured columns | owned state — changes ONLY by deliberate `card.move`, never computed |
| `type` | client-defined label | sets the icon and what the body is expected to deliver; semantics belong to the client |
| `tags` | Tag list | free labels for grouping/filtering |
| attributes | client-defined, e.g. `prs`, `artifacts`, `repo`, `owner` | generic renderable structure — link lists `{url, state}`, resource lists `{uri, label}` (`file://...`, images, docs), plain strings. The board renders them; the client gives them meaning |
| `body` | markdown | **the deliverable** — always rewritten to current state; never a log (history lives in events) |
| `status` | Status | the one work signal (below) — first-class, not a loose attribute |
| `events` | Event list | the timeline |
| `thread` | Message list | conversation scoped to this card |

### Event — one timeline entry

| attribute | values | meaning |
|---|---|---|
| `text` | one line | what happened |
| `level` | `1` \| `2` | 1 = rings the user's bell; 2 = timeline only (behind the "· N events" expander) |
| `actor` | `user` \| `agent` \| `feeder` | who caused it — every entry is attributable |

### Message — one chat utterance

| attribute | values | meaning |
|---|---|---|
| `target` | `main` \| card | main chat or a card's thread |
| `author` | `user` \| `agent` | direction |
| `text` | markdown | the content |
| `seq` | ordinal | delivery key — what `feed.ack` commits; the at-least-once contract |

### Status — the ONE work signal

Two separate things, never conflated: **the worker attached to the card** (may not exist) and **the conversation state** (does the agent owe the user a reply). Each signal has a single writer and a defined way back to quiet:

| signal | values | who sets it | how it clears |
|---|---|---|---|
| `worker.id` | opaque id, or none | the client agent, when work is dispatched/linked to the card | work ends or is unlinked → none |
| `worker.state` | `absent` \| `idle` \| `working` \| `needs-you` | the client agent, as a **lease with expiry** — what counts as evidence is the client's policy | lease expires → `idle` (honest "not working", not a guess); no worker → `absent` |
| `owed` | yes/no | **server-derived**: latest thread message is the user's with no agent reply after it | the agent replies |
| `unread` | yes/no | **server-derived**: level-1 event or agent reply landed after the user's last read of the card | the user opens the card |

`worker.*` answers "who is working this card and are they alive?" (no dispatched work = `absent`); `owed` answers "is the agent being responsive in this thread?". Independent — a worker can be `working` while the agent owes a reply, and vice versa.

UI mapping (draft): `worker.state` → stripe (green pulsing = working, gray = idle, amber = needs-you, none = absent); `owed` → "agent owes you a reply" marker; `unread` → badge/bold. No other status source exists.

### Tag — a shared label

| attribute | values | meaning |
|---|---|---|
| `name` | short text | the label; exists once per board |
| `color` | color | stable visual identity — same tag, same color everywhere |

Born on first use (`card.patch` with a new tag name creates it); no dedicated lifecycle operations.

### Archive — where cards go to rest

| attribute | values | meaning |
|---|---|---|
| `card` | frozen Card snapshot | full state at archive time |
| `reason` | client-defined, e.g. `merged` \| `killed` | why it left; the client decides WHEN to archive |
| `actor` | `user` \| `agent` | who archived |

Append-only. Nothing is ever deleted. Cards leave the board only by archive.

## Operations

The callable surface; callers are the user's UI and the client agent.

### card
- `card.create(column, title, type, attrs) → card`
- `card.move(card, column)` — deliberate act only (user drag / agent decision); records actor
- `card.patch(card, {title?, body?, attrs?})`
- `card.archive(card)` — the only way off the board

### event
- `event.append(card, text, level)`

### chat
- `chat.say(target: main|card, text)` — both directions (user UI / agent CLI)

### feed (agent side)
- `feed.poll() → [message | card-created | card-moved]` — blocks; at-least-once
- `feed.ack(seq)` — commit cursor; unacked re-offers

### status (agent side)
- `status.set(card, worker{id, state})` — only `worker` is writable, as an evidence-based lease; `owed` and `unread` are server-derived, nobody writes them

## Conversation delivery

The user acts on the UI; the agent listens and answers:

```mermaid
sequenceDiagram
  actor U as User UI
  participant B as Board
  participant A as Agent
  U->>B: chat.say · card.create · card.move · reads card — clears unread
  B->>A: feed.poll — at-least-once
  A->>A: handles — acts outside the board if needed
  A->>B: chat.say — clears owed · card.patch · card.move · card.archive
  A->>B: feed.ack — commits, unacked re-offers
```

Poll → handle → reply → ack. Ack only after handling: the at-least-once contract means an unacked item is re-offered, so a crash between handle and ack duplicates work but never loses it.
