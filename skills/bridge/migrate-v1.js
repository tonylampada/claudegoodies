#!/usr/bin/env node
// migrate-v1.js — convert a v1 bridge board JSON to the v2 data model.
// Usage: node migrate-v1.js <v1-board.json> [out.json]
// Prints the v2 doc to stdout (or writes out.json). NEVER writes in place and
// never touches a live server — stop the server, convert, move the file yourself.
//
// Mapping:
//   columns                  -> kept as-is (owned state)
//   card.title/column/labels -> kept
//   card.summary + detail_md -> body (summary becomes the lead paragraph)
//   card.owner               -> attributes.owner
//   card.links               -> attributes.<link-text> = url (first link also attributes.link)
//   card.badges              -> dropped (v2 has attributes + events instead); badge texts
//                               are recorded as one "migrated badges: ..." level-2 event
//   card.thread / chat       -> kept
//   labels registry          -> kept
'use strict';

const fs = require('fs');

const src = process.argv[2];
if (!src) { console.error('usage: node migrate-v1.js <v1-board.json> [out.json]'); process.exit(1); }
const v1 = JSON.parse(fs.readFileSync(src, 'utf8'));

const now = new Date().toISOString();
let seq = 0;

function attrKey(text, i) {
  const k = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return k || 'link_' + (i + 1);
}

const cards = (v1.cards || []).map((c) => {
  const attributes = {};
  if (c.owner) attributes.owner = c.owner;
  (c.links || []).forEach((l, i) => {
    if (!l || !l.url) return;
    if (i === 0) attributes.link = l.url;
    attributes[attrKey(l.text, i)] = l.url;
  });
  const bodyParts = [];
  if (c.summary) bodyParts.push(c.summary);
  if (c.detail_md) bodyParts.push(c.detail_md);
  const events = [];
  const badgeTexts = (c.badges || []).map((b) => b && b.text).filter(Boolean);
  if (badgeTexts.length) {
    events.push({ seq: ++seq, ts: c.updated || now, level: 2, kind: 'info', text: 'migrated badges: ' + badgeTexts.join(', '), actor: 'migrate-v1' });
  }
  const thread = Array.isArray(c.thread) ? c.thread : [];
  return {
    id: c.id, title: c.title || c.id, column: c.column,
    labels: Array.isArray(c.labels) ? c.labels : [],
    attributes,
    body: bodyParts.join('\n\n'),
    created: c.updated || now, updated: c.updated || now,
    threadStart: thread.length ? thread[0].ts : null,
    events, thread,
  };
});

const v2 = {
  title: v1.title || 'bridge', subtitle: v1.subtitle || '', updated: now, seq,
  columns: (v1.columns || []).map((c) => ({ id: c.id, title: c.title })),
  cards,
  chat: Array.isArray(v1.chat) ? v1.chat : [],
  events: [],
  labels: Array.isArray(v1.labels) ? v1.labels : [],
  reads: {},
};

const out = JSON.stringify(v2, null, 2) + '\n';
if (process.argv[3]) { fs.writeFileSync(process.argv[3], out); console.error('wrote ' + process.argv[3]); }
else process.stdout.write(out);
