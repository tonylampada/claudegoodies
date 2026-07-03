---
name: fleet-bridge
description: How firstmate drives the generic bridge board (claudegoodies/skills/bridge) with its fleet state. Bridge knows nothing about firstmate; this skill owns the mapping.
---

# fleet-bridge

Firstmate-specific usage of the generic `bridge` skill. The bridge is agent-agnostic (JSON board + CLI); ALL firstmate knowledge lives here, never in the bridge.

## Endpoints

- CLI: `<claudegoodies>/skills/bridge/bridge-axi`, always `--board fleet` (server port 4777; binds 0.0.0.0, so reachable over the tailnet at `http://<machine>:4777/`).
- Board state persists in `~/.bridge/boards/fleet.json` — survives server and firstmate restarts.

## Mapping (firstmate state → board)

| Firstmate source of truth | Board |
|---|---|
| `data/backlog.md` In flight + live `state/<id>.meta` | column `inflight`, card id = task id |
| PRs green awaiting captain merge (incl. brain merge-queue doc) | column `waiting` |
| Recent Done entries still awaiting action (shipped PRs, scout reports) | column `done`; merged work is OFF the board |
| Ongoing discussions & experiments with the captain | column `ideas` |
| Secondmate homes (`data/secondmates.md` → its `data/backlog.md` + `state/*.meta`) | same columns, `owner: "<secondmate-id>"` |

- Every card carries `owner`: `"firstmate"` or the secondmate id. Read secondmate state from its home (read-only); never steer it via the board.
- EVERYTHING on the board is ENGLISH — column titles, badges, card prose (summary/detail_md), chat and card-thread replies. The captain's native-language conversation stays in the agent chat, never on the bridge.
- Captain-facing language rules apply (outcomes, not machinery; full PR URLs in links).
- Standing cards: `merge-queue` (main fleet PR queue), `sm-merge-queue` (secondmate PR queue), `bridge-v1` (the experiment's own feedback card).

## Deterministic sync

`fm-board-sync` (this skill dir) is a zero-dep node generator that reads a firstmate home's
on-disk state (`data/backlog.md`, `state/*.meta`, `data/secondmates.md` + each secondmate home)
and emits `{upsert,remove}` card upserts — the board's mechanical skeleton, no agent judgment.

- Run on every wake: `fm-board-sync --home <fm-home> --apply --board fleet` (`--port 4777` default).
  Without `--apply` it prints the JSON to stdout for inspection.
- Mapping: In flight backlog + live meta → `inflight`; "PR ready / awaiting merge" sections and
  pr=-recorded tasks whose window is gone → `waiting`; recent Done (`--done`, default 5) → `done`.
  Card ids are `<owner>:<task-id>` per secondmate, bare task id for owner `firstmate` (back-compat).
- **Done column = delivered-awaiting-action; merged = off the board.** Done entries with verb
  `merged` (fully finished, nothing actionable left) never emit, in every home; `shipped`,
  `reported`, `fixed`, etc still do. The generator never emits removes, so a merged card already
  on the board is removed manually once: `bridge-axi card - <<< '{"remove":["<id>"]}'`.
- Hand-enrichment survives: the generator never emits `detail_md` and never computes `remove`,
  so hand-written detail, threads, extra cards, and standing cards are preserved by the server's
  per-card merge. It only prints an advisory stderr line for task-shaped cards it didn't regenerate.
- Sticky curation (`--apply` only): cards already on the board get `title`/`summary` stripped from
  the upsert, so a human retouch persists across syncs — retouch once, it sticks; new cards are
  seeded with the generated text. Stdout mode (no `--apply`) is raw: full cards, no board diff.
- `--no-secondmates` skips recursion; `--owner` relabels the home. Read-only: it never writes to
  the firstmate home.
- **Follow-up tasks on an existing card** (e.g. a fix task amending a PR another card already
  represents): alias it in the owner home's `data/board-aliases` — plain `<task-id> <card-id>`
  lines (`#` comments ok; task id is home-local, card id is the final board id, owner-prefixed
  for secondmates). Add the line BEFORE spawning the follow-up so no duplicate card is ever
  created; if one already exists, remove it once via `bridge-axi card - <<< '{"remove":["<id>"]}'`.
  The aliased task emits no card; while it is in flight the target card is forced to `inflight`
  (its own title/summary/badges stay per sticky curation), and when it finishes the target falls
  back to its own record. Unknown targets are advisory-only — never invented (board-only targets
  are verified under `--apply`).

## Cadence

- **Zero-token auto-refresh**: drop a silent shim in the firstmate home so the existing watcher's
  per-task check mechanism keeps the board fresh between agent wakes — no new daemon, no LLM cost:

  ```sh
  # <fm-home>/state/board-sync.check.sh  — prints nothing, so it never wakes the agent
  <this-skill-dir>/fm-board-sync --home <fm-home> --apply --board fleet >/dev/null 2>&1 || true
  ```

- **Sync on every wake** that changes fleet state (spawn, done, PR opened/green, teardown, failure): run `fm-board-sync --apply`, then curate with `bridge-axi card -` `{upsert:[...]}` where prose matters (once per card — it sticks). NEVER full `sync` unless you round-trip the current doc (GET `/api/board` → modify → POST), because full sync replaces threads/chat.
- **Keep exactly one `bridge-axi poll --board fleet` running** as a harness-tracked background task, exactly like the watcher arm chain. It exits when captain feedback arrives → handle → reply → re-run the poll. Restart it after any server restart (poll dies with the connection).
- Reply targets: `say chat` for global, `say card:<id>` for card threads. Text via stdin or `--text-file`, never shell-interpolated.
- Feedback arriving on a card = captain instruction in that task's context: act through the NORMAL firstmate lifecycle (steer/dispatch/merge on word), then reflect the outcome on the card.

## Rules

- Bridge repo stays generic: no firstmate vocabulary, paths, or logic go into `claudegoodies/skills/bridge`.
- Bridge dev work runs on Fable 5 subagents (captain rule).
- The board is a MIRROR, never the source of truth — backlog/state files remain canonical; when they disagree, fix the board.
