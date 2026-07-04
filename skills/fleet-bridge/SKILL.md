---
name: fleet-bridge
description: How firstmate drives the generic bridge board (claudegoodies/skills/bridge) with its fleet state. Bridge knows nothing about firstmate; this skill owns the mapping.
---

# fleet-bridge

With the bridge enabled, you operate THIS way. The system is two loops meeting at you
(see [docs/api/overview.md](docs/api/overview.md) for the model, and bridge's
[docs/api/overview.md](../bridge/docs/api/overview.md) for the board itself): Loop A is
the captain's conversation with you through the board; Loop B is the feeder narrating
fleet evidence onto cards. Everything mechanical is automated. **You are the one gear
that cannot be** — the only converter between the loops. The board works exactly as
well as you play your part, and no better.

## Endpoints

- CLI: `<claudegoodies>/skills/bridge/bridge-axi`, always `--board fleet` (port 4777;
  binds 0.0.0.0, reachable from the captain's other devices).
- Board state persists in `~/.bridge/boards/fleet.json`; archived cards in
  `~/.bridge/boards/fleet.archive.jsonl`.

## A. The feeder's lane — you must NOT hand-do these

`fm-board-sync` (this skill dir) is Loop B: it reads a firstmate home's on-disk state
(read-only) and feeds the board every run. It alone handles:

- **Events** from status lines, PR state, and worker lease transitions (deduped,
  typed by kind).
- **The kinds map** — registered on every run (`PUT /api/kinds`, idempotent).
- **Worker lease** via `status.set` — evidence-based (status/turn-end mtimes), with
  server-side TTL decay to an honest `idle`; never pane sampling. A dead runtime
  window clears the lease (worker absent) even while the task record persists.
- **The `prs` list** attribute (`{url, state}` from meta and backlog Done verbs).
- **Artifacts** — the worker brief attached at card birth.
- **Card birth** for new in-flight work, and **archive on merge** (reason `merged`).
- **Resurrection**: live evidence for an archived card id calls `card.restore` — frozen
  history plus a loud level-1 event, never a blank rebirth.
- **Type migration**: leftover `discussion` cards are patched to `plan`.

Hand-doing any of these duplicates the single writer and desyncs the board. If the board
looks stale, run the sync — don't patch what the feeder owns. Run it on every wake that
changes fleet state:

```sh
fm-board-sync --home <fm-home> --apply --board fleet   # --port 4777 default; no --apply = print plan
```

For zero-token freshness between wakes, drop a silent shim so the watcher's check
mechanism runs it:

```sh
# <fm-home>/state/board-sync.check.sh — prints nothing, never wakes the agent
<this-skill-dir>/fm-board-sync --home <fm-home> --apply --board fleet >/dev/null 2>&1 || true
```

## B. Your gear — always deliberate, never automated

The system breaks if you skip any of these. The feeder is forbidden from doing them:

- **Handoffs are `card.move`.** Work ready for the captain: verify the outcome, rewrite
  the body, THEN `bridge-axi move <id> review` — the level-1 move event IS the handoff
  notification. Work finishing never auto-advances a card; the wake tells you, you decide.
- **Rewrite the body before every handoff.** The body is the deliverable the captain
  reads — always CURRENT state, never a log (history lives in events).
- **Reply in threads.** A captain message in a thread sets `owed` — the captain sees a
  waiting balloon until YOUR reply clears it. Answer every thread you owe.
- **Link dispatched work.** Before spawning work for a captain card, add a
  `data/board-aliases` line in the owner home: `<task-id> <card-id>` — that is how Loop B
  narrates onto the right card instead of minting a duplicate. Your own direct
  subagent-delegates (no on-disk task files) link with
  `fm-subagent --home <h> set <agent-id> --card <card-id> --state working` on dispatch
  (`clear` unlinks; it rides existing cards, never mints).
- **Archive beyond merge.** Merge-archive is the feeder's; every other "this is dead /
  landed / acted on" archive is your call: `bridge-axi archive <id> [--note ...]`.
- **Answer the feed — the poll discipline is the watcher discipline.** Keep exactly ONE
  `bridge-axi poll --board fleet` running as a harness-tracked background task at ALL
  times while the board is in operation. The poll is the captain's ONLY path to you from
  the board: a dead poll means his card messages sit unanswered indefinitely and NOTHING
  else wakes you. So, non-negotiable, mirroring "no turn ends blind":
  - The poll dies with every server restart and every fire. **Re-arm it in the SAME turn**
    that restarted the server or handled the fire — never defer to "next turn".
  - **No turn ends deaf**: before ending ANY turn while the board is live, if you cannot
    point to a live poll task you armed or verified this turn, arm one now.
  - Never launch it with a shell `&`; only as the harness's own tracked background task.
  On poll exit: handle each JSON line, reply, `bridge-axi ack <seq>` with the highest seq
  handled, re-run poll:
  - `message` — captain instruction in that context: act through the NORMAL firstmate
    lifecycle (steer/dispatch/merge on word), then reflect the outcome on the card.
  - `card-created` — awareness only (intake contract below). Ack it.
  - `card-moved` — to `peer`: hands-off (captain territory). Out of `peer`: handback,
    resume. Anywhere else: captain reprioritized; reconcile.

  Ack only after handling. Delivery is at-least-once: unacked lines re-offer on every
  poll, so a dead poller drops nothing; repeats (same `seq`) mean the previous handling
  never acked — dedupe by `seq`, never re-act.

## C. Contracts

**Columns and territory.** `💡 Ideas → 🔨 Working → 👀 Your review → 🤝 Peer review`
(ids: `ideas working review peer`). No Done: cards leave by archive. Up to and including
Your review the card is yours — move it freely as work progresses. Once the captain moves
a card to Peer review it is the CAPTAIN's: do not move or rewrite it. Moving it back out
is a handback. **Merge-kill exception**: a merge is objective and terminal — archive from
ANY column, including Peer review. Columns are owned state, never computed: the feeder
NEVER moves cards; every transition is a deliberate act by captain or you.

**Card types** (the `type` attribute; bridge renders the emoji):

| Type | Emoji | Body deliverable |
|---|---|---|
| `plan` | 🧠 | the plan to validate |
| `implementation` | 🔥 | what changes + why; PRs ride the `prs` attribute |
| `investigation` | 🕵️‍♂️ | findings (scout report essence) |

There is no `discussion` type — `plan` covers it (a conversation IS early planning), and
`plan` is the default for captain-created cards. Standard attributes: `type`, `repo`,
`owner` (`firstmate` or the secondmate id), `prs`, `artifacts` (`{uri, label}`, e.g. the
worker brief as `file://...`).

**Captain-card intake: creating a card is not a demand.** A captain-created card is the
captain organizing thought. The `card-created` feed item is awareness only — no reply is
owed, no work is implied. Act only when the captain speaks, in the card's thread or main
chat; a thread "go" becomes dispatched work on the SAME card (never a duplicate), linked
via `data/board-aliases` before spawning.

**Questions ride threads, never cards.** Ask in the relevant card's thread
(`bridge-axi say card:<id>`) plus a level-1 `question` event; a question with no card
rides main chat (`say chat`).

**English only**, everything on the board: titles, bodies, events, chat replies. The
captain's native-language conversation stays in the agent chat. Captain-facing language
rules apply (outcomes, not machinery; full PR URLs).

**Event kinds and levels.** The feeder registers the fleet kinds map every run;
levels resolve from it (bridge structural kinds — created, handoff, landed, … — stay
built-in). Level 1 = bell-worthy: `done` ✅, `failed` 💥, `needs-you` ✋, `blocked` 🚧,
plus handoffs (your moves) and merge/kill archives. Level 2 = timeline only, behind
the "· N events ·" expanders: `progress` 📣 (any other status line), `pr-opened` 🔀,
`pr-merged` 🟣 (the attribute note before the merge-archive's `landed` bell),
`worker-linked` 🔗 / `worker-gone` 💤 (lease transitions, fired once per change).

**Worker briefs narrate milestones.** When this skill is active, every ship/scout brief
you write gets one instruction added to its task section: append a one-line
`working: <headline>` status at meaningful milestones — branch created, approach decided,
implementation committed, tests green, PR opened, review round addressed. One short
headline per milestone (every 10-30 min of real progress, not per-edit chatter). The
watcher absorbs no-verb `working:` lines at zero cost while the worker is provably
working, and the feeder turns each one into a 📣 `progress` event — this is what keeps a
green card telling the captain what its worker is actually doing. This is a brief-content
rule of THIS skill, not a change to the firstmate template's scaffold.

**Preferences become memory.** When the captain expresses a durable preference in a board
conversation (how work ships, what plans must spell out, reply style), record it in the
captain's memory (`data/captain.md`) in the same turn — the skill applies it now, the
memory keeps it applied when this skill is the only context that saw it.

**Board = mirror.** Firstmate's files stay canonical; when they disagree, fix the board.

**Placement test.** Makes sense for any agent running a board → `bridge`. Requires
knowing what a crewmate, PR, or backlog is → here. No firstmate vocabulary, paths, or
logic ever lands in `claudegoodies/skills/bridge`.

**Fleet-private data** (board aliases, board name choice) stays in the firstmate home's
`data/`, never in this public repo.

Text via `--text-file`/`--body-file` or stdin, never shell-interpolated.
