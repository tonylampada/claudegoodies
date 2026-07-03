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
| Recent Done entries / shipped PRs / scout reports | column `done` |
| Ongoing discussions & experiments with the captain | column `ideas` |
| Secondmate homes (`data/secondmates.md` → its `data/backlog.md` + `state/*.meta`) | same columns, `owner: "<secondmate-id>"` |

- Every card carries `owner`: `"firstmate"` or the secondmate id. Read secondmate state from its home (read-only); never steer it via the board.
- Column titles, badges, and chrome-ish labels in ENGLISH; card prose (summary/detail_md) may be Portuguese (captain-facing content).
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
- Hand-enrichment survives: the generator never emits `detail_md` and never computes `remove`,
  so hand-written detail, threads, extra cards, and standing cards are preserved by the server's
  per-card merge. It only prints an advisory stderr line for task-shaped cards it didn't regenerate.
- `--no-secondmates` skips recursion; `--owner` relabels the home. Read-only: it never writes to
  the firstmate home.

## Cadence

- **Sync on every wake** that changes fleet state (spawn, done, PR opened/green, teardown, failure): `bridge-axi card -` with an `{upsert:[...]}` — NEVER full `sync` unless you round-trip the current doc (GET `/api/board` → modify → POST), because full sync replaces threads/chat.
- **Keep exactly one `bridge-axi poll --board fleet` running** as a harness-tracked background task, exactly like the watcher arm chain. It exits when captain feedback arrives → handle → reply → re-run the poll. Restart it after any server restart (poll dies with the connection).
- Reply targets: `say chat` for global, `say card:<id>` for card threads. Text via stdin or `--text-file`, never shell-interpolated.
- Feedback arriving on a card = captain instruction in that task's context: act through the NORMAL firstmate lifecycle (steer/dispatch/merge on word), then reflect the outcome on the card.

## Rules

- Bridge repo stays generic: no firstmate vocabulary, paths, or logic go into `claudegoodies/skills/bridge`.
- Bridge dev work runs on Fable 5 subagents (captain rule).
- The board is a MIRROR, never the source of truth — backlog/state files remain canonical; when they disagree, fix the board.
