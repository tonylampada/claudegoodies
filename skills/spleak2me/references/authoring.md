# Authoring `content.js`

This is the only file you write per input. Everything else (index.html, styles.css, app.js) is a
fixed shell. `content.js` sets `window.DOC` — the whole reorganized piece as data.

## Table of contents
- [Shape](#shape)
- [Fields](#fields)
- [Rich text in `overview` / `body`](#rich-text)
- [Writing narration (the audio aid)](#narration)
- [Authoring principles](#principles)
- [Compact worked example](#example)

## Shape
```js
window.DOC = {
  meta: { /* title, subtitle, lang, ... */ },
  sections: [            // L1 — the macro theses (aim 5–8)
    {
      id, kicker, title, tagline,
      overview,          // L1 rich-text summary card (HTML)
      narration,         // L1 audio aid
      children: [        // L2 — cards inside this thesis (aim 3–7)
        { id, title, body /*HTML*/, narration, detail? }
      ]
    }
  ]
};
```
Two levels are the spine (thesis → card). A **third** level is optional per card: `detail` renders an
inline expandable block — use it for code/JSON/tables/fine print, not for prose.

## Fields
**meta**
- `id` — stable slug; namespaces localStorage progress. Required-ish (defaults to title).
- `title`, `subtitle` — header.
- `lang` — BCP-47-ish, e.g. `"en"`, `"pt"`. **Drives the TTS voice** and `<html lang>`. Default `"en"`.
- `source` — optional URL; shows a "source ↗" link.
- `ui` — optional map to localize UI micro-labels so they match `lang`. Keys (all optional):
  `eyebrow, understood, gotIt, gotItQ, whyItMatters, viewJson, viewDetail, back, hint, reset, resetConfirm, sourceLabel, bigPicture, speedLabel`.
- Each audio player has a **playback-speed** button (cycles `1× → 1.2× → 1.5× → 2×`). The choice is global
  (all players) and persisted in `localStorage`; no authoring needed. `speedLabel` sets its aria-label.
- `rate` (edge-tts, e.g. `"+6%"`) / `wpm` (say, e.g. `180`) / `voice` (raw backend voice override) — optional.

**section (L1)**
- `id` — unique slug (also a progress checkbox).
- `kicker` — tiny uppercase eyebrow (e.g. `"Principle 1"`, `"Why"`).
- `title` — the thesis, short.
- `tagline` — one punchy line under the title.
- `overview` — HTML: the macro summary of the thesis. Shown as the first card ("🧭 The big picture").
- `narration` — audio aid for the thesis.
- `children` — array of L2 cards.

**child (L2)**
- `id`, `title` — unique slug + card heading (lead with an emoji, e.g. `"🔀 Target & Binding"`).
- `body` — HTML: **the primary content**. This is where the reader actually reads.
- `narration` — audio aid for this card.
- `detail` — optional `{ lang: "json"|"text", code: "..." }` inline expandable (L3). `json` gets light highlighting.

## Rich text
`overview` and `body` accept a **small** HTML subset, already styled: `<p>`, `<ul><li>` (nesting ok),
`<b>`, `<i>`, `<code>`, `<blockquote>`. No custom classes/scripts. Keep it scannable.

## Narration
The audio is an **aid, not the content** — never a reading of `body`. It's a colleague explaining the
same idea out loud, informally, adding the *why* and the intuition.
- Keep each clip **under ~90 seconds** (~180–210 words). One idea per clip.
- Write it **spoken-ready**: spell out things TTS mangles — `V0` → "V zero", `FAT` → "F A T",
  `JSON` → "jay-son", `A/B` → "A B". (The generator only strips markdown/URLs; it does not expand abbreviations.)
- Match `meta.lang`. Conversational, a little opinionated, no filler.

## Principles
1. **Top-down.** Lead with the biggest ideas; let the reader drill down. L1 = the theses someone should
   walk away remembering; L2 = the substance; L3 = the receipts (code/data).
2. **Text is the primary medium.** Cards are short readable articles, not one-liners. Audio is secondary.
3. **Give it room to breathe.** Sections, bullets, sub-bullets, a `<blockquote>` for the money line.
4. **Emojis with intent.** One per bullet/concept as a scannable anchor and a light interpretive layer —
   not confetti. Skip them where they'd cheapen the point.
5. **Be faithful.** Reorganize and compress, don't invent. If the source has exact code/JSON/numbers,
   preserve them in `detail`.
6. **Input is anything.** A dense doc, a link, a transcript, a spec, notes. The output format is the
   point; the input just supplies the ideas.

## Example
```js
window.DOC = {
  meta: { id: "otel-primer", title: "OpenTelemetry, quickly",
          subtitle: "Field notes", lang: "en" },
  sections: [
    {
      id: "why", kicker: "The thesis", title: "One pipeline for all signals",
      tagline: "Traces, metrics, logs — one SDK, one wire format",
      overview: "<p>OTel's bet: stop wiring a separate agent per signal. <b>One</b> SDK emits" +
                " everything in <b>OTLP</b>, and a <b>Collector</b> fans it out to any backend.</p>" +
                "<ul><li>📡 <b>Instrument once</b></li><li>🔀 <b>Swap backends freely</b></li></ul>",
      narration: "The whole pitch of open telemetry is: stop running a different agent for traces, " +
                 "metrics, and logs. You instrument once, everything speaks one wire format called " +
                 "O T L P, and a collector in the middle routes it wherever you want. Swap Datadog " +
                 "for Grafana and your app code doesn't change. That decoupling is the entire point.",
      children: [
        {
          id: "collector", title: "🔀 The Collector",
          body: "<p>A standalone process: <b>receive → process → export</b>.</p>" +
                "<ul><li>📥 receivers (OTLP, Prometheus…)</li><li>🧪 processors (batch, redact)</li>" +
                "<li>📤 exporters (any backend)</li></ul>" +
                "<blockquote>Your app talks only to the Collector — never to a vendor SDK.</blockquote>",
          narration: "The collector is just a little pipeline you run yourself: receive, process, export. " +
                     "Receivers take data in, processors batch or scrub it, exporters ship it out. The " +
                     "trick is your app only ever talks to the collector, so switching vendors is a config change.",
          detail: { lang: "yaml", code: "exporters:\n  otlp:\n    endpoint: collector:4317" }
        }
      ]
    }
  ]
};
```
