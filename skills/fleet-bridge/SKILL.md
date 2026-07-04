---
name: fleet-bridge
description: How firstmate drives the generic bridge board (claudegoodies/skills/bridge) with its fleet state. Bridge knows nothing about firstmate; this skill owns the mapping.
---

# fleet-bridge

Firstmate-specific usage of the generic `bridge` skill. The bridge is agent-agnostic;
ALL firstmate knowledge lives here, never in the bridge. The board is a **flow machine**:
work is born as a card, moves through handoffs, reaches the captain, comes back or
advances, and leaves the board when it lands. Board = view of the present, never
long-term history.

## Endpoints

- CLI: `<claudegoodies>/skills/bridge/bridge-axi`, always `--board fleet` (port 4777;
  binds 0.0.0.0, reachable from the captain's other devices).
- Board state persists in `~/.bridge/boards/fleet.json`; killed cards in
  `~/.bridge/boards/fleet.archive.jsonl`.

## Columns and territory

`💡 Ideas → 🔨 Working → 👀 Your review → 🤝 Peer review` (ids: `ideas working review peer`)

- **No Done column. Kill = archive**: when work fully lands (PR merged, local merge,
  report delivered and acted on), `bridge-axi archive <id>` — the card leaves the board
  instantly, preserved in the archive file. Never delete.
- **Territory rule**: up to and including 👀 Your review the card is FIRSTMATE's — move it
  freely as work progresses. Once the captain moves a card to 🤝 Peer review it is the
  CAPTAIN's: firstmate must not move or rewrite it. The captain moving it back out of
  Peer review is a handback — firstmate acts on it again.
- **Merge-kill exception**: a merge is objective and terminal — firstmate archives the
  card from ANY column, including Peer review (the archive posts the ✅ notification).
- **Column = owned state, never computed.** The sync feeder NEVER moves cards; every
  transition is a deliberate act (captain drag&drop, or firstmate `bridge-axi move`) and
  records a timeline event with its actor.

## Card types

The `type` attribute (bridge renders the emoji). Work flows captain → firstmate, never up.

| Type | Emoji | Body deliverable |
|---|---|---|
| `plan` | 📋 | the plan to validate |
| `implementation` | 🔧 | what changes + why; PRs in the `prs` attribute |
| `investigation` | 🔍 | findings (scout report essence) |
| `discussion` | 💬 | free text; default for captain-created cards |

- Standard attributes: `type`, `repo`, `owner` (`firstmate` or the secondmate id),
  `prs` (list of `{url, state: open|merged|closed}`) when PRs exist, `artifacts`
  (list of `{uri, label}`, e.g. the worker brief as `file://...`).
- The **body is the deliverable**: markdown, rewritten by firstmate to always show
  CURRENT state — it is what the captain reads at handoff. Timeline events carry the
  history; never turn the body into a log.
- **A firstmate question is NEVER a card.** Ask in the relevant card's thread
  (`bridge-axi say card:<id>`) plus a level-1 `question` event; a question with no card
  rides main chat (`say chat`). Existing pseudo-cards become legitimate 💬 discussion cards.
- **English only**, everything on the board: titles, bodies, events, chat replies. The
  captain's native-language conversation stays in the agent chat, never on the bridge.
  Captain-facing language rules apply (outcomes, not machinery; full PR URLs).

## Captain-card intake contract

A captain-created card (born in 💡 Ideas via the UI) wakes firstmate through the poll
(`kind: card-created`). Respond in that card's thread — intake conversation happens there.
Work is dispatched only on the captain's explicit "go"; then the SAME card moves to
🔨 Working (never a duplicate card). Link the dispatched task to the card by adding a
`data/board-aliases` line in the owner home BEFORE spawning: `<task-id> <card-id>` — the
feeder then feeds that task's events/attributes onto the captain's card.

## Event levels (notification policy)

Level 1 = handoff-worthy, lands in the captain's bell: done / failed / needs-decision /
blocked signals, moves by firstmate (handoffs), merges/kills, free-form main-chat
messages. Level 2 = everything else (working notes, PR opened, created) — timeline only,
visible behind the "· N events ·" expanders.

## Sync: fm-board-sync (event/attribute feeder)

`fm-board-sync` (this skill dir) reads a firstmate home's on-disk state — `data/backlog.md`
sections, `state/*.meta`, `state/*.status`, `data/board-aliases`, `state/subagents.json`,
`data/secondmates.md` + each secondmate home (read-only, never written) — and FEEDS the
board:

- **Card creation for NEW work only**: an in-flight task with no card yet is born in
  `working` with `type`/`repo`/`owner` attributes and a seed title/body. After birth the
  feeder never touches title, body, or labels again — firstmate curates those by hand
  (`bridge-axi patch`), and the captain's retouches stick.
- **Resurrection on live evidence**: when live work maps to a card id that is not on the
  board but IS in the archive (most recent record), the feeder calls `card.restore`
  instead of minting — frozen history intact plus a loud level-1 "resurrected — work is
  still running" event, never a blank rebirth. Birth is only for ids never archived; the
  kill record stays in the append-only archive log (the board is truth for liveness).
  Alias targets in the archive restore too; the subagent registry never mints and never
  restores.
- **Event appends**, deduped by exact text: `PR opened <url>` (level 2), status-file lines
  (`done:`/`failed:`/`needs-decision:`/`blocked:` → level 1; other lines → level 2).
- **Attribute updates**: the `prs` list (`{url, state}` — meta-recorded PRs `open`,
  Done-verb `merged` marked before archive) and additive `artifacts` (the worker brief
  `data/<task-id>/brief.md` as `file://...` — appended if missing, an existing list is
  never overwritten). Old `pr`/`pr_state` attributes are migrated into `prs` and deleted.
- **Worker lease via `status.set`** (the bridge UI's left-edge stripe reads
  `card.status.worker`; the `worker` attribute is never written). Evidence-based only,
  never screen/pane sampling: last status line `needs-decision:`/`blocked:` →
  `needs-you`; else recent activity (mtime of `state/<id>.status` or
  `state/<id>.turn-ended` within `FM_SYNC_FRESH_SECS`, default 600) → `working`; else
  meta still present → `idle`; meta gone (torn down) → one `status.set` with worker
  null (the unlink), then no more assertions. The lease is re-asserted every run with
  ttl `FM_SYNC_WORKER_TTL_SECS` (default 600, 2× the sync cadence): a dead feeder's
  `working`/`needs-you` decays server-side to an honest `idle`. Worker id = task id;
  secondmate-owned cards get their lease from their own home's evidence.
  - **Subagent-delegates ride a card**: firstmate's own direct subagent-delegates (no
    on-disk task files) lease the card they are linked to, worker id = agent id.
    `fm-subagent --home <h> set <agent-id> --card <card-id> --state <working|idle|needs-you>`
    on dispatch asserts the lease immediately AND records `state/subagents.json` so
    fm-board-sync re-asserts it each run; `clear` unlinks and removes the entry;
    `list` to inspect. The feeder leases the linked card **only if it already exists**
    (it rides, never mints).
  - **Lease priority per card, highest wins**: `registry > alias > crew-task`. Exactly
    one lease decision per card per run — a registry-owned card is never clobbered or
    unlinked by crew-task evidence or the unlink sweep.
- **Merged detection → archive**: a backlog Done entry with verb `merged` archives the
  card with reason enum `merged` (the PR url / `local main` rides as `note`; one ✅
  notification). Nothing else ever removes a card.
- **NEVER moves columns.** The canonical column frame above lives in the `COLUMNS`
  constant and is pushed idempotently every run.

Run it on every wake that changes fleet state:
`fm-board-sync --home <fm-home> --apply --board fleet` (`--port 4777` default; without
`--apply` it prints the plan without sending). For zero-token freshness between wakes,
drop a silent shim in the firstmate home so the watcher's check mechanism runs it:

```sh
# <fm-home>/state/board-sync.check.sh — prints nothing, never wakes the agent
<this-skill-dir>/fm-board-sync --home <fm-home> --apply --board fleet >/dev/null 2>&1 || true
```

## Firstmate loop

- **Keep exactly one `bridge-axi poll --board fleet` running** as a harness-tracked
  background task (like the watcher arm chain). On exit, handle each JSON line, reply,
  then **`bridge-axi ack <seq> --board fleet`** with the highest `seq` handled, re-run
  poll:
  - `message` — captain instruction in that context: act through the NORMAL firstmate
    lifecycle (steer/dispatch/merge on word), then reflect the outcome on the card.
  - `card-created` — intake contract above.
  - `card-moved` — to `peer`: hands-off (captain territory). Out of `peer`: handback,
    resume. To anywhere else: captain reprioritized; reconcile.
- **Ack only after handling.** Delivery is at-least-once: the server re-offers every
  unacked line on the next poll, so a poll task that dies mid-handling drops nothing.
  A line you've already handled can therefore repeat — dedupe by `seq`, never re-act.
  Never ack a line you haven't answered/acted on yet.
- Lifecycle acts firstmate performs on the board (the feeder never does): move to
  `review` when work is ready for the captain (the level-1 👀 move event is the handoff
  notification), rewrite the body to current state before every handoff, archive on merge,
  answer threads.
- Reply targets: `say chat` global, `say card:<id>` per card. Text via `--text-file` or
  stdin, never shell-interpolated.
- The board is a MIRROR, never the source of truth — backlog/state files remain
  canonical; when they disagree, fix the board.

## Rules

- Bridge repo stays generic: no firstmate vocabulary, paths, or logic in
  `claudegoodies/skills/bridge`. Placement test: "does this make sense for a
  non-firstmate agent running a board?" Yes → bridge. No → here.
- Fleet-private data (board aliases, board name choice) stays in the firstmate home's
  `data/`, never in this public repo.
