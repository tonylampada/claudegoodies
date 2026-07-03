---
name: bridge
description: >
  Run a live "agent OS board" — a local web UI where a human watches an AI agent's internal work
  state as a kanban board and talks to the agent in context (per-card threads + global chat).
  Triggers when the user wants a live board/dashboard of agent work, wants to "open the bridge",
  or an agent needs a visual command surface for a human to follow along and steer.
---

# bridge

A local web board driven entirely by shell commands. The agent pushes its state; the human watches
it live and replies in context. Agent-agnostic: any agent with shell access can drive it.

- **Server** (`server.js`): node built-ins only, zero deps, single file. State persists in
  `~/.bridge/boards/<name>.json` and survives restarts.
- **CLI** (`bridge-axi`): the agent's whole interface. Never talk HTTP directly; use the CLI.
- **UI** (`ui.html`): dark command-bridge kanban. Responsive full-width columns (per-column
  scroll, fixed headers), SSE live updates, card drawer with markdown detail + thread, global
  chat dock, header filter (`/` focuses, Esc clears), "agent is working…" typing indicators plus
  a connectivity/activity status dot, optional voice for new agent messages.

## CLI

All subcommands take `--port <p>` (default 4777) and `--board <name>` (default `default`).
The server binds `0.0.0.0` by default, so phones/tablets on the tailnet/LAN can open `http://<machine>:<port>/`; pass `--host 127.0.0.1` to `open` to restrict to local.

```bash
bridge-axi open                      # start server if needed (idempotent), print URL
bridge-axi sync board.json           # replace whole board doc (or `-` for stdin)
bridge-axi card card.json            # upsert/remove cards: {upsert,remove}, an array, or one card
bridge-axi say chat --text-file f.md # post agent message to global chat
bridge-axi say card:fix-login-k3 --text-file f.md   # ...or to a card thread (stdin if no flag)
bridge-axi poll                      # BLOCK until user feedback; print JSON lines; exit
bridge-axi status                    # up/down, board, card count, pending feedback
bridge-axi stop                      # stop the server
```

Rules:
- Message text goes via `--text-file` or stdin — never interpolated into a shell command.
- `poll` exits after the first feedback batch and persists its cursor
  (`~/.bridge/boards/<name>.cursor`), so nothing is lost between polls. Run it as a tracked
  background task; when it exits, read its stdout lines, handle them, re-run it.
- Each feedback line: `{"seq":N,"target":"chat"|"card:<id>","text":"…","ts":"…"}`.
- The server tracks targets awaiting an agent reply (set by user feedback, cleared by `say` to
  that target). Exposed as `awaiting` in `GET /api/status` (in-memory; resets on restart) and
  streamed over SSE — the UI shows per-thread typing indicators and a global status dot from it.
  So: always answer feedback with `say <target>`, or the board keeps showing "agent is working…".

## Board doc schema

```json
{
  "title": "…", "subtitle": "…",
  "columns": [{"id": "inflight", "title": "🔨 In flight"}],
  "cards": [{
    "id": "…", "column": "inflight", "title": "…", "summary": "…", "owner": "agent-a (optional; groups/colors cards per owning agent)",
    "badges": [{"text": "CI green", "tone": "success|warn|danger|info|neutral"}],
    "labels": ["user-owned", "…"],
    "links": [{"text": "PR #123", "url": "https://…"}],
    "detail_md": "…", "thread": [{"author": "agent|user", "text": "…", "ts": "…"}]
  }],
  "chat": [{"author": "agent|user", "text": "…", "ts": "…"}]
}
```

Columns render in doc order; cards render under their `column` id. `card` upserts merge onto the
existing card and preserve its thread unless you send a new one. `updated` timestamps are set by
the server when omitted.

`badges` vs `labels`: badges are agent-owned — replace them freely on sync/upsert. `labels` is
USER-owned (edited in the card drawer, persisted in board state): never set or rewrite it. Upserts
and full `sync` docs that omit the field leave existing labels intact (the server carries them
forward by card id); only sending an explicit `labels` value overwrites. PATCH also accepts
`update: [...]` which merges onto existing cards only (404s on unknown id, never creates) — the
UI uses it for label edits.
Badges, labels, and owner names in the UI are click-to-filter (AND-composed with the text filter).

## Agent loop

1. `bridge-axi open` — print the URL to the human once.
2. On every internal state change: `bridge-axi sync` (full doc) or `bridge-axi card` (granular).
3. Keep `bridge-axi poll` running as a background task. When it exits with feedback lines:
   handle each (its `target` tells you the context), reply with
   `bridge-axi say <target> --text-file <f>`, update the board, re-run `poll`.
4. Repeat until done. `bridge-axi stop` only if the human is finished with the board.

Feedback also appears in the UI thread immediately (author `user`), so replies via `say` land in
the same visible conversation.

## Voice filter

`~/.bridge/config.json` `{"voices": ["Luciana", "Google US English"]}` — case-insensitive substring
matches trim the UI's voice dropdown; absent/empty = full list. Served at `GET /api/config`, read live.
When the user names preferred voices in chat, run `bridge-axi config voices "Luciana,Google US English"`
(`""` clears; `config show` prints the file) — the dropdown shrinks on next page load.
