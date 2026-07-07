---
name: fleet-bridge
description: How firstmate drives the bridge kanban board with its fleet state. Use whenever the captain's board is in operation. Requires the separate generic `bridge` skill (installed by the user); bridge knows nothing about firstmate — this skill owns the mapping.
---

# fleet-bridge

**The story.** The captain runs a kanban board in his browser — the **bridge** — as his
main surface for delegation-heavy work: one card per piece of fleet work, per-card chat
threads, typed timeline events, a notification bell. He glances to see, types to steer.
The board is a separate generic app shipped as the `bridge` skill (zero-dep node server +
web UI + `bridge-axi` CLI) and knows NOTHING about firstmate; THIS skill is the firstmate
side. Two loops meet at you: Loop A = the captain talking to you through the board,
Loop B = the feeder narrating fleet evidence onto cards. Everything mechanical is
automated — you are the only gear that cannot be. Model:
[docs/api/overview.md](docs/api/overview.md); the board itself: the bridge skill's own
`docs/api/overview.md`.

## Setup

- The user installs both skills, by name (`bridge`, `fleet-bridge`). `bridge-axi` lives
  in the installed bridge skill's dir (e.g. `~/.claude/skills/bridge/bridge-axi`).
- One server hosts many boards; every call names one via `--board`. The fleet uses a
  single board — named `fleet` in every example here. Port 4777. State:
  `~/.bridge/boards/fleet.json`; archive: `fleet.archive.jsonl`.
- Network exposure is the user's machine-private config (`"host"` in
  `~/.bridge/config.json`), default localhost-only. Never set or document a bind host
  yourself.
- Server startup is by captain's order only, never automatic. The order:
  **"Captain on the bridge"** (or any clear ask for the board). Then:
  `bridge-axi open --board fleet` (idempotent, prints URL) → wire the push hook, arm the
  poll, and run the sync → hand him the URL, nothing else. A board already running stays
  running.

## The feeder's lane — never hand-do these

`fm-board-sync` (this skill dir) reads a firstmate home read-only and feeds the board.
It alone owns: events (status lines, PR state, worker-lease transitions — deduped, typed
by kind), the kinds map, the worker lease (evidence-based, server-side TTL decay to
`idle`), the `prs` attribute, brief artifacts, card birth for new in-flight work, archive
on merge, resurrection of archived ids, type migration.

- Board looks stale → run the sync. Never patch what the feeder owns.
- Run it on every wake that changes fleet state:
  `fm-board-sync --home <fm-home> --apply --board fleet` (no `--apply` = print plan).
- The fast path — push, not poll: firstmate's generic, opt-in `config/event-hook`
  (docs/configuration.md "Event hooks" in the firstmate repo) fires on a spawn,
  teardown, PR-state change, or status/turn-end write. Point it at this skill's
  `fm-board-sync-hook`, which just re-runs the same sync above immediately instead of
  waiting out a poll:

  ```sh
  # <fm-home>/config/event-hook — one line, written once per home
  <this-skill-dir>/fm-board-sync-hook
  ```

  Wire this the same session you first run the sync for a home. It never replaces the
  poll shim below — a consumer that misses an event (hook not yet wired, a cold board
  server) still catches up on the next poll.
- Zero-token freshness between wakes — silent watcher shim, the reconciler/fallback for
  whatever the push hook misses:

  ```sh
  # <fm-home>/state/board-sync.check.sh — prints nothing, never wakes the agent
  <this-skill-dir>/fm-board-sync --home <fm-home> --apply --board fleet >/dev/null 2>&1 || true
  ```

## Your gear — deliberate, never automated

- Handoff = `bridge-axi move <id> review`. Verify the outcome, rewrite the body, THEN
  move; the level-1 move event IS the notification. Finished work never auto-advances a
  card — the wake tells you, you decide.
- The body is the deliverable. Rewrite it to CURRENT state before every handoff; never a
  log (history lives in events).
- Answer every thread you owe. A captain thread message sets `owed`; only your reply
  clears his waiting balloon.
- Link before spawning. Work for a captain card: add a `data/board-aliases` line
  `<task-id> <card-id>` in the owner home BEFORE spawn — that is how the feeder narrates
  onto the right card instead of minting a duplicate. Direct subagents (no on-disk task):
  `fm-subagent --home <h> set <agent-id> --card <card-id> --state working` on dispatch
  (`clear` unlinks; rides existing cards, never mints).
- Archive beyond merge is your call: `bridge-axi archive <id> [--note ...]` when work is
  dead, landed, or acted on. Merge-archive is the feeder's.

## The poll — non-negotiable

- Keep exactly ONE `bridge-axi poll --board fleet` alive as a harness-tracked background
  task the whole time the board is up. It is the captain's ONLY path to you from the
  board; a dead poll = his messages sit unanswered and nothing wakes you.
- The poll dies with every server restart and every fire. Re-arm it in the SAME turn.
- No turn ends deaf: if you cannot point to a live poll you armed or verified this turn,
  arm one now, before ending the turn.
- Never launch it with a shell `&`.
- On fire: handle each JSON line → reply → `bridge-axi ack <highest seq handled>` →
  re-run the poll. Ack only after handling. A repeated `seq` was handled but never
  acked: dedupe by `seq`, never re-act.
- `message` = captain instruction in that context. Act through the NORMAL firstmate
  lifecycle, then reflect the outcome on the card.
- `card-created` = awareness only: ack it, no reply owed, no work implied. Act only when
  the captain speaks; a thread "go" becomes work on the SAME card, linked before spawn.
- `card-moved` to `peer` = hands-off. Out of `peer` = handback, resume. Anywhere else =
  captain reprioritized; reconcile.

## Board rules

- Columns: `💡 Ideas → 🔨 Working → 👀 Your review → 🤝 Peer review`
  (ids: `ideas working review peer`). No Done — cards leave by archive.
- Through Your review the card is yours; move it freely. In Peer review it is the
  CAPTAIN's: never move or rewrite it; him moving it out = handback.
- Exception: a merge is objective and terminal — archive from ANY column.
- The feeder never moves cards. Every move is the captain's drag or your deliberate act.
- Types: `plan` 🧠 (default for captain cards; covers discussion) · `implementation` 🔥 ·
  `investigation` 🕵️‍♂️. Attributes: `type`, `repo`, `owner`, `prs`, `artifacts`.
- Questions ride threads, never cards: `bridge-axi say card:<id>` + a level-1 `question`
  event; no card → `say chat`.
- English only, everything on the board. Outcomes, not machinery; full PR URLs. The
  captain's native-language conversation stays in the agent chat.
- Levels: 1 = bell — `done` ✅, `failed` 💥, `needs-you` ✋, `blocked` 🚧, handoffs,
  merge/kill archives. 2 = timeline only — `progress` 📣, `pr-opened` 🔀, `pr-merged` 🟣,
  `worker-linked` 🔗, `worker-gone` 💤. The feeder registers the kinds map every run;
  bridge structural kinds stay built-in.
- Board = mirror. Firstmate's files stay canonical; on disagreement, fix the board.
- Text via `--text-file`/`--body-file` or stdin, never shell-interpolated.

## Standing habits while this skill is active

- Every ship/scout brief you write gets one added instruction: append a one-line
  `working: <headline>` status at real milestones — branch created, approach decided,
  implementation committed, tests green, PR opened. Every 10-30 min of progress, not
  per-edit chatter. The feeder turns each into a 📣 `progress` event: a green card that
  says what its worker is doing. Brief-content rule of THIS skill, never a change to the
  firstmate template.
- The captain states a durable preference on the board → record it in `data/captain.md`
  the same turn.

## Placement

- Makes sense for any board-running agent → `bridge`. Needs crewmate/PR/backlog
  vocabulary → here. No firstmate vocabulary, paths, or logic ever lands in the `bridge`
  skill.
- Fleet-private data (board aliases, board name choice) stays in the firstmate home's
  `data/`, never inside either skill (both may live in public repos).
