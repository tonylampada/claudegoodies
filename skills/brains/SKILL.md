---
name: brains
description: >
  Create, maintain, and query "second brains" — structured knowledge maps that mirror slices of reality.
  Triggers when the user mentions "brain", "map", "second brain", or wants to ingest, organize, query,
  or generate reports from a knowledge base.
---

# Brain — Maps of Meaning for Your Life

This skill borrows from Jordan Peterson's *Maps of Meaning* framework: reality is navigated through maps —
simplified, pragmatic representations that encode what matters and how to act. A map that stops being updated
becomes dangerous: it gives you confidence without accuracy. The unknown must be acknowledged, not hidden.

A brain is exactly this: a structured folder of files that mirrors a slice of reality you care about.
It is not the territory, but a tool for navigating it — and it must evolve as reality changes.

## Core Concepts

### The Map (a brain directory)

Each brain is a regular directory containing text files (mostly Markdown and JSON). The folder structure itself
is an ontology — it encodes how you think about that domain. A brain about a child's therapy might have folders
for `medications/`, `therapies/`, `school/`, `milestones/`. A work brain might have `projects/`, `people/`,
`decisions/`, `weekly/`.

### The Meta-Map (MAP.md)

Every brain has a `MAP.md` at its root. This is the map of the map — it describes:

- What domain this brain covers
- How the folders and files are organized, and why
- What each section contains
- Where the boundaries of the known territory are (what's well-documented vs. what has gaps)

The meta-map is the first thing you read when entering a brain, and you update it whenever the structure changes.

**MAP.md never grows with events.** It is an index, not a log. If you are about to append a dated entry, a daily/weekly digest, an ingest summary, an incident note, or a "last updated" line — stop. That content belongs in the corresponding domain file (`weekly/`, `bugs/`, `decisions/`, etc.), in `_reports/`, or in the commit message. A healthy MAP.md is roughly the same size today as it was a month ago; if it is growing, something is being logged into it that shouldn't be.

### Territory Types (from Maps of Meaning)

When working with a brain, think of its contents in three categories:

- **Known territory** — well-documented areas with current, reliable information. Navigate confidently.
- **Explored but outdated** — information that was captured but may no longer reflect reality. Flag for review.
- **Unknown territory** — gaps in the map. Areas where you know the domain exists but haven't captured knowledge yet. Acknowledge openly rather than pretending the gap doesn't exist.

## Progressive Disclosure

Navigation uses three levels, just like skills — read only what you need:

1. **MAP.md** — the meta-map. Read this first. It describes the full structure and what each section contains. This is enough to know where to look.
2. **File frontmatter** — every content file has YAML frontmatter with `title`, `description`, and `updated`. Use the frontmatter scanner (`scripts/frontmatter.js`) to survey files or directories without reading full content.
3. **Full content** — read the complete file only when you're sure it's relevant.

This matters because brains grow. Don't read everything — navigate the map, scan frontmatter, then dive in.

### Scanning Frontmatter

Use the bundled script to scan frontmatter without reading full file contents:

```bash
# Single file
~/.claude/skills/brains/scripts/frontmatter.js medications/risperidona.md

# Directory (immediate .md files only)
~/.claude/skills/brains/scripts/frontmatter.js medications/

# Directory recursive (all .md files in all subfolders)
~/.claude/skills/brains/scripts/frontmatter.js -r medications/
```

Use this to quickly survey what's in a section of the brain before deciding what to read in full.

### File Frontmatter Format

Every content file in a brain should have this header:

```markdown
---
title: Short descriptive title
description: One-line summary of what this file contains
updated: YYYY-MM-DD
source: where this information came from (optional)
---
```

The `description` field is the key — it's what you read to decide whether to open the file. Write it as if someone will use it to decide "do I need to read this right now?"

### Links Between Documents

Use Obsidian-style `[[links]]` to connect related documents. This creates a second navigation layer beyond the folder structure: folders organize by category, links connect by relevance.

When writing or updating a file, add `[[links]]` whenever it references something that exists (or should exist) elsewhere in the brain. Use the filename without extension:

```markdown
Started [[risperidona]] 0.5mg today. Dr. [[silva]] recommended monitoring for 2 weeks.
See also [[sessao-2026-03-15]] for context on why we switched medications.
```

When querying, follow links as a navigation path — if the answer isn't fully in the current file, the links point to where related context lives.

To find links and backlinks, use the bundled script:

```bash
# Show all links FROM a file
~/.claude/skills/brains/scripts/links.js medications/risperidona.md

# Show all files that link TO a file (backlinks, always recursive)
~/.claude/skills/brains/scripts/links.js --backlinks risperidona medications/
```

## Brain Structure

```
my-brain/
├── MAP.md                  # Meta-map: index and guide to this brain
├── _inbox/                 # Landing zone for new, unprocessed information
│   └── 2026-03-28.md       # Raw ingestion, timestamped
├── _processed/             # Inbox items already ingested into the brain
│   └── 2026-03-27.md       # Moved here after processing (kept for provenance)
├── <domain-folders>/       # Organized by the brain's ontology
│   ├── topic-a/
│   │   ├── overview.md
│   │   └── entries/
│   │       └── 2026-03-28-event.md
│   └── topic-b/
│       └── ...
└── _reports/               # Generated outputs (summaries, reports)
    └── weekly-2026-w13.md
```

Key conventions:
- `_inbox/` is a staging area. Information lands here first, then gets sorted into the right place.
- Folders prefixed with `_` are operational (inbox, reports, archives). Domain folders have no prefix.
- Date-stamped files use `YYYY-MM-DD` format for natural sorting.
- Each domain folder can have an `overview.md` that summarizes the current state of that topic.

## Operations

### 1. Create a New Brain

When the user wants to create a new brain:

0. **Do not create files, commits, repos, or cron jobs before the user has approved the MAP.md/ontology.** Present the proposed structure in chat first; materialize only after explicit approval.

1. **Interview the user exhaustively.** This is the most important step. Don't accept a vague "I want a brain for work" — dig deep. Ask about:
   - What slice of reality does this brain cover?
   - What are the main topics, categories, or dimensions of this domain?
   - What kind of information will flow in? From where? How often?
   - What does the user need to get OUT of the brain? (reports, summaries, lookups, decisions?)
   - What are the actors/entities involved? (people, institutions, processes)
   - What changes over time vs. what is relatively stable?
   - Are there recurring cycles? (weekly, monthly, per-session, per-visit)

   Keep asking follow-up questions until you have a rich understanding of the domain. Don't rush to propose a structure — a bad map built on shallow understanding will need to be rebuilt later.

2. **Iterate on the MAP.md with the user.** Based on the interview, draft a MAP.md and present it. This is a conversation, not a delivery — expect to go back and forth. The user might say "no, that's not how I think about it" or "you're missing a whole area". Refine until the user is happy with how their reality is represented.

3. **Plan the granularity.** Think about how information will grow over time. If events happen weekly, plan one file per week from the start — don't let it all pile into one file. If a topic has many entries (medications, sessions, meetings), plan a folder with one file per entry rather than a single long list. The goal is that no individual file should grow past ~200 lines. Design the structure so that growth creates new files, not bigger files.

4. **Create the directory.** Once the user approves the MAP.md, set up the folders: `_inbox/`, `_processed/`, `_reports/`.

#### MAP.md Template

```markdown
# [Brain Name]

> One-paragraph description of what domain this brain covers and its purpose.

## Sources

Where information flows in from:
- [Source 1]: description and frequency
- [Source 2]: description and frequency

## Structure

    brain-name/
    ├── folder-a/    — what this contains
    ├── folder-b/    — what this contains
    ├── _inbox/      — unprocessed incoming information
    └── _processed/  — inbox items already ingested

## Gaps

Known areas not yet covered:
- [Gap 1]
- [Gap 2]
```

### 2. Ingest Information

Ingestion is how the map gets updated to match reality. Two modes:

#### Manual Ingestion (conversation)

The user tells you something in natural language. Your job:

1. **Read the MAP.md** of the relevant brain to understand the current structure.
2. **Determine where it belongs.** Does it fit an existing folder/file? Does it need a new entry?
3. **Write or update the appropriate file(s).** Every file must have YAML frontmatter (title, description, updated). Preserve existing content — append or merge, don't overwrite unless correcting outdated info. Update the `updated` field when modifying.
4. **Update overview files** if the new information changes the overall picture of a topic.
5. **Update MAP.md only if the structure changed in a way that isn't already described.** The MAP.md describes patterns, not individual files. If a folder is documented as "one file per week, format `YYYY-Www.md`", adding a new weekly file does not require a MAP.md update — the pattern already covers it. Update the MAP.md when you create new folders, change the organization, or discover new gaps — not when you add routine entries that follow an existing pattern.

If a file is approaching ~200 lines after your edit, split it. Extract older or less-relevant content into a separate file (e.g., `topic-archive-2026-q1.md`) or break it into one-file-per-entry in a subfolder. Update MAP.md to reflect the new structure.

When in doubt about where something goes, put it in `_inbox/` with a clear timestamp and context, and tell the user. Better to capture imperfectly than to lose information.

After processing an inbox item — once its information has been written to the appropriate files with `source` set in frontmatter — **move it from `_inbox/` to `_processed/`**. An empty inbox means nothing is pending. The raw data is preserved in `_processed/` for provenance and debugging.

#### Batch Ingestion (from external sources)

The user provides a dump of data from an external source (Slack messages, WhatsApp conversations, medical records, etc.). Your job:

1. **Read the MAP.md** to understand the current structure.
2. **Process the raw data.** Extract the meaningful information — facts, decisions, events, changes in status. Discard noise (greetings, off-topic chatter, logistics).
3. **Organize by topic.** Group extracted information by which part of the map it belongs to.
4. **Write to the appropriate locations.** For each topic, either append to existing files or create new dated entries. Set `source` in frontmatter to record where the information came from (e.g., `source: whatsapp terapeutas 2026-03-23`).
5. **Move processed inbox items.** If the raw data was staged in `_inbox/`, move it to `_processed/` once all information has been extracted and written to the right places.
6. **Update overview files and MAP.md** if the structure changed beyond existing patterns (see manual ingestion step 5 for when MAP.md updates are needed).

Important: when processing batch data, preserve key details (dates, names, dosages, decisions, who said what). Summarize the noise, but keep the signal intact. When in doubt, keep more rather than less.

### 3. Query the Brain

When the user asks a question about a domain covered by a brain:

1. **Read the MAP.md** to understand where to look.
2. **Scan frontmatter** of candidate folders using `scripts/frontmatter.js` to narrow down which files are relevant.
3. **Read full content** only of the files you actually need.
4. **Synthesize an answer** from what you find. Be clear about what the map says vs. what might be outdated or missing.
5. **Acknowledge gaps.** If the map doesn't have the answer, say so. Don't fabricate information to fill gaps — that defeats the purpose of having a map.

#### Quick personal-data lookups for forms

When using a personal-information brain to fill a reservation, check-in, travel, hotel, school, medical, or registration form:

1. Read the relevant brain's `MAP.md`, then only the minimum files needed for the named people (usually `documentos.md`, `enderecos.md`, `contatos.md`).
2. Return a copy/paste-ready message. Do not include extra provenance, attachments, or unrelated private details.
3. If a required field is absent, use an explicit placeholder rather than guessing.
4. If the user later sends the corrected final form, treat corrections as new source data and update the brain immediately: identity data in `documentos.md`, current address in `enderecos.md` with the prior current address moved to history, and phone/email in `contatos.md`.
5. Preserve provenance in frontmatter (`source: ... form/message from user on YYYY-MM-DD`) and update `updated`.

### 4. Generate Reports

When the user wants a summary, report, or status update:

1. **Understand the scope.** What time period? What topics? What format do they need?
2. **Read the MAP.md** and then the relevant files.
3. **Generate the report.** Pull together information across the relevant sections of the brain.
4. **Save to `_reports/`** with a descriptive filename (e.g., `weekly-2026-w13.md`, `medication-history.md`).
5. **Present to the user** — both save it and show it in the conversation.

### 5. Evolve the Structure

Over time, the initial structure won't fit anymore. Topics grow, new categories emerge, old ones become irrelevant. This is natural — the map must evolve with the territory.

Signs that the structure needs to evolve:
- `_inbox/` items keep being hard to place — you're unsure where they belong
- A folder has grown to contain too many unrelated things
- You keep having to explain where to put things because the categories are ambiguous
- New topics have emerged that don't have a home

When evolving:
1. Propose the structural change to the user before making it.
2. Move files to their new locations.
3. Update MAP.md to reflect the new structure.

## Multiple Brains & Repo Convention

A **brains repo** is a git repository containing one or more brains plus automation config. Structure:

```
my-brains-repo/
├── .brains.json          # ["brain-a", "brain-b"] — list of brain directories
├── .brainsrc             # Env setup (PATH, tokens) — sourced by heartbeat before tasks
├── brain-a/
│   ├��─ MAP.md
│   ├���─ heartbeat.json    # Scheduled tasks for this brain (optional)
│   └── ...
├── brain-b/
│   ├── MAP.md
│   ├── heartbeat.json
│   └── ...
```

Each brain is independent — its own directory, its own MAP.md, its own domain. When the user wants to work with a brain, they should specify which one (by name or domain). If it's ambiguous, ask.

### .brains.json

Simple JSON array of brain directory names. Used by heartbeat to discover brains.

### .brainsrc

Bash script sourced by heartbeat before running any task. Sets up the environment: PATH, API tokens (from `.env`), helper functions (`run`, `run_capture`, `setup_log`). Uses `export -f` so functions are available in child processes (the task scripts). This file is repo-specific and typically gitignored.

### Heartbeat

Heartbeat is optional. If the user's environment has its own scheduling (cron/jobs), use that instead. Record the choice in `MAP.md` under Automation to avoid parallel schedulers.

The heartbeat (`scripts/heartbeat.js` in this skill) is a cron-driven task dispatcher:

```bash
# Cron entry (hourly):
13 * * * * /path/to/node /path/to/skill/scripts/heartbeat.js /path/to/brains-repo
```

It reads `.brains.json` to discover brains, then reads each brain's `heartbeat.json` for task definitions. Tasks run based on day-of-week, hour, and cooldown rules. State is tracked in `.heartbeat-state.json` at the repo root.

#### heartbeat.json

Each brain can have a `heartbeat.json` at its root. It's a JSON array of tasks:

```json
[
  {
    "name": "ingest-today",
    "command": "brain-a/scripts/ingest-today.sh",
    "dow": [1,2,3,4,5,6,7],
    "hours": [19],
    "cooldownHours": 20
  }
]
```

- **name**: task identifier (namespaced as `<brain>/<name>` in state)
- **command**: shell command, run from repo root with `.brainsrc` already sourced
- **dow**: days of week (1=Mon..7=Sun)
- **hours**: hours (0-23) when the task can trigger
- **cooldownHours**: minimum hours between executions

Estado em `.heartbeat-state.json` (gitignored).

### Diagnosing heartbeat-backed reports vs source freshness

When a user asks whether a brain report is using fresh external data, verify the exact pipeline before assuming the source is stale:

1. Check the scheduler entry (`crontab -l`) for the heartbeat command and repo path.
2. Inspect the brain's `heartbeat.json` to identify which task generates the report.
3. Read the task script and its common helpers to see which sources/chats/channels it actually ingests.
4. Compare that source directly with a fresh read from the relevant CLI/API.
5. Read the task log near the latest run to confirm message counts, publish/send status, and failures.

Pitfall: a direct 1:1 chat being stale does not mean WhatsApp/MCP ingestion is stale. Brain reports may read group chats or other sources. For Isaac, daily reports have historically read group JIDs from `isaac/scripts/ingest-day.js` (`TERAPEUTAS`, `ESCOLA`) rather than the direct Samantha chat.

Pitfall: text ingestion and media download can fail independently. If messages are fresh but media downloads fail, report that as a partial media-download issue, not as "WhatsApp stopped updating".

### Adding new heartbeat-backed brain automation

When designing or modifying a brain automation, **inspect the existing repo patterns before proposing architecture**. Do not start with a greenfield plan if the repo already has heartbeat tasks, inbox processing, prompts, or event-driven ingesters.

Checklist:

1. Run the date command first if the task is date/time based.
2. Inspect `.brains.json`, existing `<brain>/heartbeat.json` files, relevant `scripts/*ingest*`, prompts, `.brainsrc`, and `heartbeat.log`.
3. Identify which existing pattern fits best:
   - **Batch daily** pattern (e.g. ingest → `_inbox` → prompt → brain files → report → publish → `git_sync`) for domains that need a durable daily history.
   - **Event-driven/filter** pattern (e.g. package → prompt with structured `RESULT` block → shell decides notification → `git_sync`) for selective relevance filtering.
4. Prefer extending the established pattern over inventing a parallel scheduler, state file format, or folder convention.
5. Keep raw/staged inputs auditable in `_inbox`/`_processed`, and commit generated changes with the same `git_sync` style used by the repo.

Pitfall: `markProcessed.sh` expects files to live directly under `_inbox/` and moves them to the sibling `_processed/`. If you stage files under nested paths like `_inbox/whatsapp/...`, either adjust the helper/prompt deliberately or use a flat filename such as `_inbox/YYYYMMDD-HHMM-whatsapp-mind-candidates.md`.

#### `Mind.md` as a derived hot-cache

For a live radar file such as `diario/Mind.md` or `roboflow/Mind.md`, treat it as a **materialized view of current attention**, not as the data store or a daily report.

Good automation pattern:

```
external source → flat _inbox package → conservative prompt → only edit Mind.md if attention changes → markProcessed → git_sync
```

Good conversational pattern:

```
Tony says what changed → read current Mind.md → remove/update/add radar items → renumber → rebuild/publish HUD → verify generated data contains the change
```

Rules:
- Do not write WhatsApp/raw source data straight into `Mind.md`.
- Use a prompt with a structured `RESULT` block (`mind_update: yes|no`, `notify: yes|no`, `added/updated/removed`, `reason`) so logs are auditable.
- Keep phase boundaries explicit. If the agreed phase is “Mind only,” do not create `pessoas/`, `eventos/`, `arquivo/`, or historical/domain files as side effects.
- Prefer updating/removing existing radar lines over appending new lines; stale hot-cache items are worse than missing low-value ones.
- Notifications should be opt-in and controlled by the shell from structured output, not sent directly by the prompt unless the workflow explicitly says so.

#### Conversation-driven OQTR updates

When Tony uses a dedicated “what's going on / o que tá rolando” chat to maintain current attention:

1. Treat the chat as high-quality source material for the relevant `Mind.md`/HUD hot-cache, but still read the current file before editing.
2. For removals, delete the stale radar line and renumber the remaining visible items; do not leave “done” clutter in the hot-cache unless Tony explicitly wants a completed/history section.
3. For changed workstreams, rewrite the existing item into the new operating mode instead of appending a near-duplicate. If Tony says it should become “another item,” add it as a separate pushing item.
4. Rebuild/publish the HUD after edits and verify the generated `dashboard/site/data.json` contains the expected new item and no removed stale item.
5. If the update implies a real reminder (for example “remind me in 25 days”), create a one-shot scheduled job in addition to updating the brain; the brain file is not a notification mechanism by itself.

- After conversational Mind edits, rebuild/publish the dashboard if it is the user-facing projection, then verify the generated artifact (`dashboard/site/data.json` or live data) for both removals and additions.
- Notifications should be opt-in and controlled by the shell from structured output, not sent directly by the prompt unless the workflow explicitly says so.

See also `references/mind-hud-chat-ops.md` for a compact worked pattern from a Telegram/HUD maintenance session.

### Brain HUDs and generated audio summaries

When building or maintaining a static HUD/dashboard over brain hot-caches:

- Keep the brain files (`Mind.md`, JSONL stores, etc.) as the source of truth; the HUD is a projection.
- **Identify which HUD the user means before editing.** Brain2 has multiple published views (for example Isaac's clinical site under `isaac/_site` and the cross-brain Brain2 HUD under `dashboard/`). If the user says “HUD” while showing/using the Brain2 radar UI, update `dashboard/scripts/build-dashboard-data.js` + `dashboard/site/data.json` and publish with `dashboard/scripts/publish-dashboard.sh`, not the Isaac clinical site.
- HUD panels should show **things that need attention now**, not historical negatives. Do not add “inactive/suspended/not active” lists to the live HUD just to explain absence; keep that history in the underlying brain files.
- For Isaac supplements, `compras.jsonl` is historical purchase/estimate data. The Brain2 HUD stock panel should be driven by the operational active-attention list (`isaac/clinica/prescricoes/controle-estoque-atual.md` in this environment) so inactive historical purchases do not reappear as cards.
- When Tony reports a supplement arrived or gives a new duration, record the stock event via the prescription stock CLI (`add-stock-purchase.js` / `update-stock-purchase.js`) rather than editing `compras.jsonl` manually; update `controle-estoque-atual.md` with the operational next action, expected empty date, and open questions for unknown active items; run `scripts/validate.py` before publishing.
- If Tony asks for a future reorder reminder, create a one-shot scheduled reminder for the requested lead time. Do not rely on `alert_at`/HUD presence alone to notify him.
- After publishing a HUD change, verify the published artifact and actual panel content, not only the source file. Prefer the live URL/fetched `data.json`; if the site is authenticated and direct fetch returns 403, verify the generated local `dashboard/site/data.json` plus the publish output URL/auth mode. Confirm expected items appeared/disappeared before reporting success.
- For the Brain2 dashboard specifically, the normal refresh path is `source /home/ai/repos/brain2/.brainsrc && bash dashboard/scripts/publish-dashboard.sh` from the repo root. This rebuilds `data.json`, regenerates section audio, and publishes the stable here.now slug; commit the generated dashboard artifacts when the user asks to commit/push.
- If the repo is dirty when committing/pushing a conversational Mind/HUD update, inspect `git status` and `git diff --stat`, then stage only the source file(s) changed for the request plus the directly generated dashboard/audio artifacts. Do not sweep unrelated local brain changes into the commit just because the user said “git push.”
- If adding audio summaries, make them **per section/panel**, not one global mixed audio file. Example: work/Roboflow gets its own English summary; personal/diary gets its own Portuguese summary.
- Audio summary text must be TTS-friendly: strip raw URLs, Markdown links, backticks, and symbol-heavy artifacts before synthesis. Never let `https://...` be spoken aloud.
- Match the TTS voice to the section language. Do not use a multilingual English voice for Portuguese personal summaries if it causes language switching; prefer a native Portuguese voice for Portuguese sections.
- In the UI, treat an audio summary as a normal radar/list item. The row should contain the player; selecting it should reveal the spoken transcript in the same detail pane/accordion behavior as other items.
- For automation, rebuild audio only when the transcript hash or voice changes, then publish the stable site slug from heartbeat. Verify both generated files and live URLs.


## Date Awareness

LLMs are notoriously bad at knowing the current date, day of the week, and week number — often off by a day or more. Since many brains organize information by week or date, getting this wrong means filing things in the wrong place.

**MANDATORY: before ANY operation that involves dates** (ingesting, querying by time period, generating reports), you MUST run:

```bash
date '+%Y-%m-%d %A (week %V)'
```

No exceptions. Do not guess. Do not rely on your internal sense of what day it is. Do not assume you know the current date, day of the week, or week number. Run the command, read the output, and use that. Every single time.

## Guiding Principles

1. **Capture first, organize later.** When information arrives, getting it into `_inbox/` quickly is better than spending time finding the perfect spot. You can sort it later.

2. **The map is not the territory.** Always be aware that the brain is a simplified model. Flag when you suspect the map might be outdated.

3. **Shallow structure, deep content.** Prefer fewer, well-organized folders over deeply nested hierarchies. The meaning is in the content, not the folder depth.

4. **Preserve provenance.** Always note where information came from and when. This is what makes the brain trustworthy over time.

5. **Evolve, don't revolutionize.** Change the structure incrementally. Radical reorganizations are disorienting and risk losing information in the process.
