---
name: spleak2me
description: >
  Turn any content (a document, a link, a transcript, notes, a spec — whatever) into a top-down,
  progressively-disclosed HTML reading site: macro "theses" you click to drill into cards, rich
  scannable text as the primary medium, an optional short spoken audio aid per card, and self-declared
  "got it?" progress saved in the browser. Triggers on "/spleak2me", or when the user wants a friendlier
  way to read/understand/absorb some content, an interactive explainer, a guided-reading page, or a
  "speak to me / explain this" version of dense material. Output is HTML on disk; only publish if asked.
---

# spleak2me

Reshape any input into a **top-down guided-reading** web page. The input can be anything; the value is
the **output format**:

- **Left:** the macro theses (L1) — the big ideas someone should walk away with.
- **Click a thesis → right panel:** its cards (L2) with the actual, scannable content; optional inline
  L3 `detail` for code/JSON/tables.
- **🎧 Audio (optional, on by default):** one short, informal clip per card that *explains* the idea —
  an aid, never a reading of the text.
- **Progress:** a "got it?" toggle per card, a global bar, per-thesis mini-bars — all in `localStorage`.

Responsive: two-pane on desktop, full-screen drill-down on mobile. Works opened straight from disk
(`file://`) — no server or network needed.

## Files

A finished site is a folder:
```
site/
├── index.html          # fixed shell (from template)
├── styles.css          # fixed shell
├── app.js              # fixed shell (renders window.DOC, uses window.AUDIO)
├── audio-manifest.js   # window.AUDIO = {}  (rewritten by gen-audio.js)
├── content.js          # ← YOU author this: window.DOC = {...}
└── audio/              # ← generated clips (only if audio enabled)
```
`content.js` is the only creative artifact. The shell is generic and never edited per input.

## Workflow

1. **Get the content.** If the user pasted it, use it. If it's a link/file, fetch/read it first. Read
   enough to genuinely restructure it — don't skim.
2. **Scaffold the shell** into an output dir (default: a sensible slug under the cwd, or where the user
   says):
   ```bash
   scripts/scaffold.sh <output-dir>
   ```
3. **Author `content.js`.** This is the work. Reorganize top-down into `window.DOC` (theses → cards →
   optional detail), write rich scannable `body`/`overview` HTML, and — unless audio is off — a
   spoken-ready `narration` per node. **Read [references/authoring.md](references/authoring.md)** for the
   schema, the allowed HTML, and the authoring principles (top-down, text-first, breathe, emojis with
   intent, faithful). Language defaults to the **input's language**; set `meta.lang` and, for non-English,
   `meta.ui` labels.
4. **Generate audio** (default on; skip only if the user opted out):
   ```bash
   node scripts/gen-audio.js <output-dir>
   ```
   It auto-detects a TTS backend (`edge-tts`, else macOS `say`), picks a voice from `meta.lang`, runs
   clips **in parallel**, and rewrites `audio-manifest.js`. If no backend exists it just skips audio and
   the site stays text-only (players don't render). Flags: `--concurrency N`, `--backend edge|say`,
   `--voice <raw>`, `--save-voice`. User prefs (default backend/voice) come from `~/.spleak2me.json` —
   see Audio notes.
5. **Verify.** Open `<output-dir>/index.html` (or serve it) and sanity-check: theses render, a card
   drills in, a player plays, "got it?" ticks the progress bar. Fix `content.js` and re-run step 4 if
   audio text needed changes.
6. **Deliver the path.** The deliverable is the HTML on disk. **Do not publish** anywhere unless the user
   asks — if they do, that's a separate step (e.g. the `here-now` skill / their own hosting).

## Audio notes

- Backends are tried in order: `EDGE_TTS_BIN` / `edge-tts` on PATH → macOS `say`. `say` output is
  converted to mp3 (ffmpeg) or m4a (afconvert) when available, else left as aiff.
- Keep each `narration` under ~90s and **spoken-ready** (spell out `V0`, `FAT`, `JSON`, `A/B`…); the
  generator only strips markdown/URLs, it does not expand abbreviations.
- Audio is driven entirely by `audio-manifest.js`: a card shows a player only if its clip was generated.
  To ship text-only, just don't run step 4.
- **User prefs — `~/.spleak2me.json`:** an optional config in the home dir holding a preferred default
  backend and per-backend/per-language voices. Missing or malformed file = ignored (warns to stderr,
  never crashes), so the no-config path is unchanged. Schema:
  ```json
  {
    "backend": "say",
    "voices": {
      "say":  { "en": "Zoe (Premium)" },
      "edge": {}
    }
  }
  ```
  - **Voice precedence** (highest first): `--voice` flag → `voices[backend][lang]` from config →
    built-in default map.
  - **Backend precedence** (highest first): `--backend` flag → config `backend` (only if that backend
    is actually available) → auto-detect (`edge` if present, else `say`).
  - The startup log line notes `config: loaded`/`config: none` and appends `(from ~/.spleak2me.json)`
    after the voice when it came from config.

- **Voice preference is Claude-managed — the user never touches flags or the config file.** The user
  just talks to you; you handle the file on their behalf.
  - **First time you generate audio for a user** (no `~/.spleak2me.json`, or it has no voice for this
    backend/lang): after delivering, tell them plainly which voice you picked and that they can change
    it just by asking — e.g. *"I used the **Zoe (Premium)** voice — if you'd rather a different one, just
    tell me and I'll switch it in your config."* Keep it to one line; don't lecture about the mechanism.
  - **When the user asks for a different voice:** resolve the exact backend voice name (for `say`,
    `say -v '?'` lists them), then persist it and regenerate. Persist via the internal `--save-voice`
    flag (`node scripts/gen-audio.js <site> --voice "<name>" --save-voice`) or by editing
    `~/.spleak2me.json` directly — either is fine. Do **not** ask the user to run flags or hand-edit the
    file themselves.
  - Once a voice is saved, stay quiet about it on later runs — it's their default now; only mention it
    again if they ask or you couldn't honor it.

## Scope reminders

- The **format** is the product. Don't tailor the shell to one kind of input.
- Faithful reorganization, not invention. Preserve exact code/data in `detail`.
- Output = files on disk. Publishing is opt-in, per user request, and out of this skill.
