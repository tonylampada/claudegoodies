#!/usr/bin/env node
// bridge server — generic agent board. Node built-ins only, zero deps.
// Usage: node server.js --port 4777 --board default --host 0.0.0.0
//
// Data model v2 (one JSON file per board, ~/.bridge/boards/<name>.json):
//   board = { title, subtitle, updated, seq,
//             columns: [{id, title}],                       // owned state, ordered
//             cards:   [{id, title, column, labels[], attributes{}, body,
//                        created, updated, threadStart,
//                        events: [{seq, ts, level, kind, text, actor}],
//                        thread: [{author, text, ts}] }],
//             chat:    [{author, text, ts}],
//             events:  [{seq, ts, level, kind, text, actor, card?, cardTitle?}], // board-level
//             labels:  [{name, color}],                     // user-owned registry
//             reads:   { <user>: { notifSeq, notifSeqs[], threads: {<target>: ts} } } }
//
// Events are append-only and carry a global monotonic seq. The unified stream =
// board.events + every card's events, ordered by seq. Notifications are the
// level-1 slice of that stream; read state persists in board.reads (server-side).
// Kill = archive: the card is snapshotted to <name>.archive.jsonl (append-only)
// and removed from the board. No destructive delete.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------- args ----------
function parseArgs(argv) {
  const o = { port: 4777, board: 'default', host: '0.0.0.0' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') o.port = parseInt(argv[++i], 10);
    else if (argv[i] === '--board') o.board = argv[++i];
    else if (argv[i] === '--host') o.host = argv[++i];
  }
  if (!Number.isInteger(o.port) || o.port <= 0) { console.error('bad --port'); process.exit(1); }
  if (!o.host) { console.error('bad --host'); process.exit(1); }
  if (!/^[\w.-]+$/.test(o.board)) { console.error('bad --board (use [A-Za-z0-9_.-])'); process.exit(1); }
  return o;
}
const opts = parseArgs(process.argv.slice(2));

// ---------- paths ----------
// State root: $BRIDGE_DIR when set (tests point it at a temp dir), else ~/.bridge.
const BRIDGE_DIR = process.env.BRIDGE_DIR || path.join(os.homedir(), '.bridge');
const BOARDS_DIR = path.join(BRIDGE_DIR, 'boards');
const BOARD_FILE = path.join(BOARDS_DIR, opts.board + '.json');
const ARCHIVE_FILE = path.join(BOARDS_DIR, opts.board + '.archive.jsonl');
const FEEDBACK_FILE = path.join(BOARDS_DIR, opts.board + '.feedback.jsonl');
const PID_FILE = path.join(BRIDGE_DIR, 'server-' + opts.port + '.pid');
const CONFIG_FILE = path.join(BRIDGE_DIR, 'config.json');
const UI_DIR = path.join(__dirname, 'ui');
fs.mkdirSync(BOARDS_DIR, { recursive: true });

// ---------- user config (~/.bridge/config.json; read per-request, defensive) ----------
function userConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (c && typeof c === 'object' && Array.isArray(c.voices)) {
      const voices = c.voices.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
      if (voices.length) return { voices };
    }
  } catch (e) {}
  return { voices: null };
}

// ---------- pidfile: single instance per port ----------
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
if (fs.existsSync(PID_FILE)) {
  const old = parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10);
  if (old && pidAlive(old)) process.exit(0); // live server already on this port
}
fs.writeFileSync(PID_FILE, String(process.pid));
function cleanup() {
  try { if (parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10) === process.pid) fs.unlinkSync(PID_FILE); } catch (e) {}
}
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(0); });

// ---------- board state ----------
function now() { return new Date().toISOString(); }
function defaultBoard() {
  return {
    title: opts.board, subtitle: '', updated: now(), seq: 0,
    columns: [], cards: [], chat: [], events: [], labels: [], reads: {},
  };
}
function normalizeBoard(doc) {
  const b = Object.assign(defaultBoard(), doc);
  if (!Array.isArray(b.columns)) b.columns = [];
  if (!Array.isArray(b.cards)) b.cards = [];
  if (!Array.isArray(b.chat)) b.chat = [];
  if (!Array.isArray(b.events)) b.events = [];
  if (!Array.isArray(b.labels)) b.labels = [];
  if (!b.reads || typeof b.reads !== 'object') b.reads = {};
  for (const c of b.cards) {
    if (!Array.isArray(c.events)) c.events = [];
    if (!Array.isArray(c.thread)) c.thread = [];
    if (!Array.isArray(c.labels)) c.labels = [];
    if (!c.attributes || typeof c.attributes !== 'object') c.attributes = {};
  }
  // seq must top every stored event (defensive after hand edits)
  let max = b.seq || 0;
  for (const e of b.events) if (e.seq > max) max = e.seq;
  for (const c of b.cards) for (const e of c.events) if (e.seq > max) max = e.seq;
  b.seq = max;
  return b;
}
function loadBoard() {
  try { return normalizeBoard(JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8'))); }
  catch (e) { return defaultBoard(); }
}
let board = loadBoard();
function saveBoard() {
  board.updated = now();
  const tmp = BOARD_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(board, null, 2));
  fs.renameSync(tmp, BOARD_FILE);
}

// ---------- events ----------
const KINDS = ['alert', 'question', 'handoff', 'success', 'info'];
function mkEvent(body, defaults) {
  const level = body.level === 2 ? 2 : body.level === 1 ? 1 : (defaults.level || 2);
  let kind = KINDS.includes(body.kind) ? body.kind : (defaults.kind || 'info');
  return {
    seq: ++board.seq, ts: now(), level, kind,
    text: String(body.text || '').slice(0, 2000),
    actor: String(body.actor || defaults.actor || 'agent').slice(0, 60),
  };
}

// ---------- label registry (user-owned; persisted in board json) ----------
const LABEL_PALETTE = ['#4cc2ff', '#2fbf71', '#e2b93b', '#c678dd', '#e2795b', '#56b6c2', '#98c379', '#e06c75'];
function validColor(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null; }
function labelIndex(name) { return board.labels.findIndex((l) => l && l.name === name); }
function registerCardLabels() {
  for (const c of board.cards) {
    for (const n of c.labels || []) {
      if (typeof n === 'string' && n && labelIndex(n) < 0) {
        board.labels.push({ name: n, color: LABEL_PALETTE[board.labels.length % LABEL_PALETTE.length] });
      }
    }
  }
}

// ---------- feedback queue (user -> agent; durable jsonl, monotonic seq) ----------
let feedback = [];
try {
  feedback = fs.readFileSync(FEEDBACK_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
} catch (e) {}
let fseq = feedback.length ? feedback[feedback.length - 1].seq : 0;
function pushFeedback(rec) {
  const ev = Object.assign({ seq: ++fseq, ts: now() }, rec);
  feedback.push(ev);
  fs.appendFileSync(FEEDBACK_FILE, JSON.stringify(ev) + '\n');
  flushPollers();
  return ev;
}

// ---------- committed ack cursor (at-least-once delivery) ----------
// Feedback <= ackSeq has been HANDLED by the agent, not merely delivered. Poll
// serves everything past it and never advances it; only POST /api/poll/ack does.
// So a poller that dies before the agent handles its lines re-offers the same
// feedback on the next poll — duplicates are possible, loss is not (dedupe by seq).
const ACK_FILE = path.join(BOARDS_DIR, opts.board + '.feedback.ack');
const LEGACY_CURSOR_FILE = path.join(BOARDS_DIR, opts.board + '.cursor');
function loadAck() {
  try { return parseInt(fs.readFileSync(ACK_FILE, 'utf8'), 10) || 0; }
  catch (e) {}
  // first run after upgrade: adopt the CLI's old local poll cursor so feedback
  // already delivered under the old at-most-once model is not re-offered
  try { return parseInt(fs.readFileSync(LEGACY_CURSOR_FILE, 'utf8'), 10) || 0; }
  catch (e) { return 0; }
}
let ackSeq = loadAck();
function commitAck(n) {
  if (n <= ackSeq) return;
  ackSeq = n;
  fs.writeFileSync(ACK_FILE, String(ackSeq));
}

// ---------- long-poll waiters ----------
let pollers = []; // {since, res, timer}; since=null means "the committed ack cursor"
function feedbackSince(since) { return feedback.filter((e) => e.seq > since); }
function pollerSince(p) { return p.since == null ? ackSeq : p.since; }
function flushPollers() {
  pollers = pollers.filter((p) => {
    const evs = feedbackSince(pollerSince(p));
    if (!evs.length) return true;
    clearTimeout(p.timer);
    sendJson(p.res, 200, { events: evs, cursor: fseq, ack: ackSeq });
    return false;
  });
}

// ---------- SSE clients ----------
const sseClients = new Set();
function broadcast() {
  const payload = 'event: board\ndata: ' + JSON.stringify(board) + '\n\n';
  for (const res of sseClients) res.write(payload);
}
setInterval(() => { for (const res of sseClients) res.write(': ping\n\n'); }, 25000).unref();

// ---------- awaiting-agent tracking (transient typing indicator) ----------
// target -> epoch ms it ENTERED awaiting (kept at the oldest unanswered message).
// Past AWAITING_STALE_SECS (default 180; env-overridable for tests) a target is
// also reported "stale": the UI swaps the healthy typing animation for a distinct
// "no response yet — may be stuck" state, so a dropped message can't look like
// healthy typing forever.
const AWAITING_STALE_SECS = parseInt(process.env.BRIDGE_AWAITING_STALE_SECS, 10) || 180;
const awaiting = new Map(); // targets with user feedback not yet answered by an agent message
function staleTargets() {
  const cutoff = Date.now() - AWAITING_STALE_SECS * 1000;
  return Array.from(awaiting).filter(([, t]) => t <= cutoff).map(([k]) => k);
}
function statusEvent() {
  return 'event: status\ndata: ' + JSON.stringify({ awaiting: Array.from(awaiting.keys()), stale: staleTargets() }) + '\n\n';
}
let lastStaleKey = '';
function broadcastStatus() {
  lastStaleKey = staleTargets().join('\n');
  const payload = statusEvent();
  for (const res of sseClients) res.write(payload);
}
function setAwaiting(target, on) {
  const changed = on ? !awaiting.has(target) : awaiting.delete(target);
  if (on && !awaiting.has(target)) awaiting.set(target, Date.now()); // repeats keep the original entry time
  if (changed) broadcastStatus();
}
function pruneAwaiting() {
  let changed = false;
  for (const t of Array.from(awaiting.keys())) if (!threadFor(t)) { awaiting.delete(t); changed = true; }
  if (changed) broadcastStatus();
}
// Staleness develops with time, not with events — push a status when a target
// crosses the threshold (or a stale one clears), without rebroadcasting otherwise.
setInterval(() => {
  if (staleTargets().join('\n') !== lastStaleKey) broadcastStatus();
}, 5000).unref();

// ---------- helpers ----------
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 8e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
function findCard(id) { return board.cards.find((c) => c.id === id); }
function threadFor(target) {
  if (target === 'chat') return board.chat;
  const m = /^card:(.+)$/.exec(target || '');
  if (m) {
    const card = findCard(m[1]);
    if (card) return (card.thread = card.thread || []);
  }
  return null;
}
function columnTitle(id) {
  const c = board.columns.find((k) => k.id === id);
  return c ? c.title : id;
}
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'card';
}
function newCardId(title) {
  const base = slug(title);
  if (!findCard(base)) return base;
  for (let i = 2; ; i++) if (!findCard(base + '-' + i)) return base + '-' + i;
}
function userReads(user) {
  const u = String(user || 'user').slice(0, 60);
  if (!board.reads[u]) board.reads[u] = { notifSeq: 0, notifSeqs: [], threads: {} };
  const r = board.reads[u];
  if (!Array.isArray(r.notifSeqs)) r.notifSeqs = [];
  if (!r.threads || typeof r.threads !== 'object') r.threads = {};
  return r;
}
// The unified stream: board-level events + every card's events, by seq.
function allEvents() {
  const out = [];
  for (const e of board.events) out.push(e);
  for (const c of board.cards) for (const e of c.events) out.push(Object.assign({ card: c.id, cardTitle: c.title }, e));
  out.sort((a, b) => a.seq - b.seq);
  return out;
}

// ---------- card mutations ----------
function createCard(body, actorDefault) {
  const title = String(body.title || '').trim();
  if (!title) return { error: 'title required' };
  const id = body.id ? String(body.id) : newCardId(title);
  if (!/^[\w][\w.:-]*$/.test(id)) return { error: 'bad card id (use [A-Za-z0-9_.:-])' };
  if (findCard(id)) return { error: 'card exists: ' + id, code: 409 };
  const column = body.column ? String(body.column) : (board.columns[0] && board.columns[0].id);
  if (!column || !board.columns.some((c) => c.id === column)) return { error: 'unknown column: ' + column };
  const actor = String(body.actor || actorDefault || 'agent').slice(0, 60);
  const card = {
    id, title: title.slice(0, 200), column,
    labels: Array.isArray(body.labels) ? body.labels.filter((l) => typeof l === 'string' && l) : [],
    attributes: (body.attributes && typeof body.attributes === 'object') ? body.attributes : {},
    body: typeof body.body === 'string' ? body.body : '',
    created: now(), updated: now(), threadStart: null,
    events: [], thread: [],
  };
  card.events.push(mkEvent({ text: 'created in ' + columnTitle(column), actor, level: 2 }, { kind: 'info' }));
  board.cards.push(card);
  registerCardLabels();
  if (actor !== 'agent') {
    pushFeedback({ kind: 'card-created', target: 'card:' + id, text: title, column });
    setAwaiting('card:' + id, true);
  }
  return { card };
}

function moveCard(card, body, actorDefault) {
  const column = String(body.column || '');
  if (!board.columns.some((c) => c.id === column)) return { error: 'unknown column: ' + column };
  const actor = String(body.actor || actorDefault || 'agent').slice(0, 60);
  if (column === card.column) return { ok: true, unchanged: true };
  const from = card.column;
  card.column = column;
  card.updated = now();
  // A move is a deliberate act: it always lands on the timeline. Default level:
  // an agent move notifies the human (level 1 handoff); a human's own move is level 2.
  const ev = mkEvent(
    { level: body.level, kind: body.kind, actor, text: columnTitle(from) + ' → ' + columnTitle(column) },
    { level: actor === 'agent' ? 1 : 2, kind: 'handoff' });
  card.events.push(ev);
  if (actor !== 'agent') pushFeedback({ kind: 'card-moved', target: 'card:' + card.id, text: card.title, from, column });
  return { ok: true, event: ev };
}

function patchCard(card, body) {
  if (body.title !== undefined) card.title = String(body.title).slice(0, 200);
  if (body.body !== undefined) card.body = String(body.body);
  if (Array.isArray(body.labels)) card.labels = body.labels.filter((l) => typeof l === 'string' && l);
  if (body.attributes && typeof body.attributes === 'object') {
    for (const [k, v] of Object.entries(body.attributes)) {
      if (v === null) delete card.attributes[k];
      else card.attributes[k] = v;
    }
  }
  card.updated = now();
  registerCardLabels();
}

function archiveCard(card, body, actorDefault) {
  const actor = String((body && body.actor) || actorDefault || 'agent').slice(0, 60);
  const reason = String((body && body.reason) || '').slice(0, 500);
  const rec = { ts: now(), actor, reason, card };
  fs.appendFileSync(ARCHIVE_FILE, JSON.stringify(rec) + '\n');
  board.cards = board.cards.filter((c) => c.id !== card.id);
  // The kill lands on the board-level stream (the card is gone) with a card reference.
  const ev = mkEvent(
    { level: body && body.level, kind: body && body.kind, actor, text: reason || 'archived: ' + card.title },
    { level: 1, kind: 'success' });
  ev.card = card.id; ev.cardTitle = card.title; ev.archived = true;
  board.events.push(ev);
  return { ok: true, event: ev };
}

// ---------- static ui ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
};
function serveStatic(res, rel) {
  const file = path.normalize(path.join(UI_DIR, rel));
  if (!file.startsWith(UI_DIR + path.sep) && file !== path.join(UI_DIR, 'index.html')) {
    return sendJson(res, 404, { error: 'not found' });
  }
  let data;
  try { data = fs.readFileSync(file); } catch (e) { return sendJson(res, 404, { error: 'not found' }); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(data);
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const route = req.method + ' ' + p;
  try {
    // ----- ui -----
    if (route === 'GET /') return serveStatic(res, 'index.html');
    if (req.method === 'GET' && p.startsWith('/ui/')) return serveStatic(res, p.slice(4));

    // ----- reads -----
    if (route === 'GET /api/board') return sendJson(res, 200, board);
    if (route === 'GET /api/config') return sendJson(res, 200, userConfig());
    if (route === 'GET /api/status') {
      return sendJson(res, 200, {
        board: opts.board, port: opts.port, cards: board.cards.length, seq: board.seq,
        feedback_seq: fseq, feedback_ack: ackSeq, awaiting: Array.from(awaiting.keys()),
        stale: staleTargets(), pid: process.pid,
      });
    }
    if (route === 'GET /api/archive') {
      let recs = [];
      try { recs = fs.readFileSync(ARCHIVE_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (e) {}
      const n = parseInt(url.searchParams.get('limit') || '50', 10) || 50;
      return sendJson(res, 200, { archive: recs.slice(-n).reverse() });
    }
    if (route === 'GET /api/notifications') {
      const r = userReads(url.searchParams.get('user'));
      const items = allEvents().filter((e) => e.level === 1).reverse()
        .map((e) => Object.assign({}, e, { read: e.seq <= r.notifSeq || r.notifSeqs.includes(e.seq) }));
      return sendJson(res, 200, { items, unread: items.filter((e) => !e.read).length });
    }

    // ----- cards -----
    if (route === 'POST /api/cards') {
      const body = JSON.parse(await readBody(req) || '{}');
      const r = createCard(body);
      if (r.error) return sendJson(res, r.code || 400, { error: r.error });
      saveBoard(); broadcast();
      return sendJson(res, 200, { ok: true, card: r.card });
    }
    const cardRoute = /^\/api\/cards\/([^/]+)(\/(move|events|archive))?$/.exec(p);
    if (cardRoute) {
      const card = findCard(decodeURIComponent(cardRoute[1]));
      if (!card) return sendJson(res, 404, { error: 'unknown card: ' + decodeURIComponent(cardRoute[1]) });
      const sub = cardRoute[3];
      if (!sub && req.method === 'GET') return sendJson(res, 200, card);
      if (!sub && req.method === 'PATCH') {
        patchCard(card, JSON.parse(await readBody(req) || '{}'));
        saveBoard(); broadcast();
        return sendJson(res, 200, { ok: true, card });
      }
      if (sub === 'move' && req.method === 'POST') {
        const r = moveCard(card, JSON.parse(await readBody(req) || '{}'));
        if (r.error) return sendJson(res, 400, { error: r.error });
        saveBoard(); broadcast();
        return sendJson(res, 200, r);
      }
      if (sub === 'events' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        if (!String(body.text || '').trim()) return sendJson(res, 400, { error: 'text required' });
        const ev = mkEvent(body, { level: 2, kind: 'info' });
        card.events.push(ev);
        card.updated = now();
        saveBoard(); broadcast();
        return sendJson(res, 200, { ok: true, event: ev });
      }
      if (sub === 'archive' && req.method === 'POST') {
        const r = archiveCard(card, JSON.parse(await readBody(req) || '{}'));
        saveBoard(); broadcast(); pruneAwaiting();
        return sendJson(res, 200, r);
      }
      return sendJson(res, 405, { error: 'method not allowed' });
    }

    // ----- board-level events (free-form notify) -----
    if (route === 'POST /api/events') {
      const body = JSON.parse(await readBody(req) || '{}');
      if (!String(body.text || '').trim()) return sendJson(res, 400, { error: 'text required' });
      const ev = mkEvent(body, { level: 1, kind: 'info' });
      board.events.push(ev);
      saveBoard(); broadcast();
      return sendJson(res, 200, { ok: true, event: ev });
    }

    // ----- columns (owned state; idempotent replace) -----
    if (route === 'PUT /api/columns') {
      const cols = JSON.parse(await readBody(req) || 'null');
      if (!Array.isArray(cols) || !cols.every((c) => c && typeof c.id === 'string' && typeof c.title === 'string')) {
        return sendJson(res, 400, { error: 'columns must be [{id:string,title:string}]' });
      }
      const next = cols.map((c) => ({ id: c.id, title: c.title }));
      if (JSON.stringify(next) === JSON.stringify(board.columns)) {
        return sendJson(res, 200, { ok: true, columns: board.columns.length, unchanged: true });
      }
      board.columns = next;
      saveBoard(); broadcast();
      return sendJson(res, 200, { ok: true, columns: board.columns.length });
    }

    // ----- board meta (title/subtitle) -----
    if (route === 'PATCH /api/board') {
      const body = JSON.parse(await readBody(req) || '{}');
      if (body.title !== undefined) board.title = String(body.title).slice(0, 120);
      if (body.subtitle !== undefined) board.subtitle = String(body.subtitle).slice(0, 300);
      saveBoard(); broadcast();
      return sendJson(res, 200, { ok: true });
    }

    // ----- chat -----
    if (route === 'POST /api/message') { // agent -> human
      const body = JSON.parse(await readBody(req) || '{}');
      const target = body.target || 'chat';
      const thread = threadFor(target);
      if (!thread) return sendJson(res, 404, { error: 'unknown target: ' + target });
      const text = String(body.text_md || body.text || '');
      if (!text.trim()) return sendJson(res, 400, { error: 'text required' });
      const msg = { author: String(body.author || 'agent').slice(0, 60), text, ts: now() };
      thread.push(msg);
      const m = /^card:(.+)$/.exec(target);
      if (m) {
        const card = findCard(m[1]);
        if (card) { card.updated = now(); if (!card.threadStart) card.threadStart = msg.ts; }
      } else {
        // A free-form agent message in the main chat is a level-1 notification.
        const ev = mkEvent({ text: text.slice(0, 200), actor: msg.author, level: body.level, kind: body.kind }, { level: 1, kind: 'info' });
        board.events.push(ev);
      }
      saveBoard(); broadcast(); setAwaiting(target, false);
      return sendJson(res, 200, { ok: true });
    }
    if (route === 'POST /api/feedback') { // human -> agent
      const body = JSON.parse(await readBody(req) || '{}');
      const target = body.target || 'chat';
      const thread = threadFor(target);
      if (!thread) return sendJson(res, 404, { error: 'unknown target: ' + target });
      const text = String(body.text || '');
      if (!text.trim()) return sendJson(res, 400, { error: 'text required' });
      const msg = { author: 'user', text, ts: now() };
      thread.push(msg);
      const m = /^card:(.+)$/.exec(target);
      if (m) {
        const card = findCard(m[1]);
        if (card) { card.updated = now(); if (!card.threadStart) card.threadStart = msg.ts; }
      }
      const ev = pushFeedback({ kind: 'message', target, text });
      saveBoard(); broadcast(); setAwaiting(target, true);
      return sendJson(res, 200, { ok: true, seq: ev.seq });
    }

    // ----- read state (persisted server-side, per user) -----
    if (route === 'POST /api/notifications/read') {
      const body = JSON.parse(await readBody(req) || '{}');
      const r = userReads(body.user);
      if (body.all) { r.notifSeq = board.seq; r.notifSeqs = []; }
      else if (Array.isArray(body.seqs)) {
        for (const s of body.seqs) if (Number.isInteger(s) && s > r.notifSeq && !r.notifSeqs.includes(s)) r.notifSeqs.push(s);
      }
      saveBoard(); broadcast();
      return sendJson(res, 200, { ok: true });
    }
    if (route === 'POST /api/read') { // thread read marker: {user?, target, ts?}
      const body = JSON.parse(await readBody(req) || '{}');
      const r = userReads(body.user);
      const target = String(body.target || '');
      if (!/^(chat|card:.+)$/.test(target)) return sendJson(res, 400, { error: 'bad target' });
      r.threads[target] = body.ts || now();
      saveBoard(); broadcast();
      return sendJson(res, 200, { ok: true });
    }

    // ----- labels registry -----
    if (route === 'POST /api/labels') {
      const b = JSON.parse(await readBody(req) || '{}');
      if (b.create) {
        const name = String(b.create.name || '').trim();
        if (!name) return sendJson(res, 400, { error: 'label name required' });
        const color = validColor(b.create.color);
        const i = labelIndex(name);
        if (i >= 0) { if (color) board.labels[i].color = color; }
        else board.labels.push({ name, color: color || LABEL_PALETTE[board.labels.length % LABEL_PALETTE.length] });
      } else if (b.rename) {
        const from = String(b.rename.from || ''), to = String(b.rename.to || '').trim();
        const i = labelIndex(from);
        if (i < 0) return sendJson(res, 404, { error: 'unknown label: ' + from });
        if (!to) return sendJson(res, 400, { error: 'new name required' });
        if (to !== from && labelIndex(to) >= 0) return sendJson(res, 400, { error: 'label exists: ' + to });
        board.labels[i].name = to;
        for (const c of board.cards) {
          if (Array.isArray(c.labels)) c.labels = c.labels.map((n) => (n === from ? to : n)).filter((n, k, a) => a.indexOf(n) === k);
        }
      } else if (b.recolor) {
        const i = labelIndex(String(b.recolor.name || ''));
        const color = validColor(b.recolor.color);
        if (i < 0) return sendJson(res, 404, { error: 'unknown label: ' + String(b.recolor.name || '') });
        if (!color) return sendJson(res, 400, { error: 'color must be #rrggbb' });
        board.labels[i].color = color;
      } else if (b.delete) {
        const name = String(b.delete.name || '');
        const i = labelIndex(name);
        if (i < 0) return sendJson(res, 404, { error: 'unknown label: ' + name });
        board.labels.splice(i, 1);
        for (const c of board.cards) {
          if (Array.isArray(c.labels)) c.labels = c.labels.filter((n) => n !== name);
        }
      } else {
        return sendJson(res, 400, { error: 'expected create|rename|recolor|delete' });
      }
      saveBoard(); broadcast();
      return sendJson(res, 200, { ok: true, labels: board.labels });
    }

    // ----- agent long-poll (no ?since = everything past the committed ack cursor) -----
    if (route === 'GET /api/poll') {
      const sinceParam = url.searchParams.get('since');
      const since = sinceParam == null || sinceParam === '' ? null : (parseInt(sinceParam, 10) || 0);
      const evs = feedbackSince(since == null ? ackSeq : since);
      if (evs.length) return sendJson(res, 200, { events: evs, cursor: fseq, ack: ackSeq });
      if (url.searchParams.get('nowait')) return sendJson(res, 200, { events: [], cursor: fseq, ack: ackSeq });
      const poller = { since, res, timer: null };
      poller.timer = setTimeout(() => {
        pollers = pollers.filter((x) => x !== poller);
        sendJson(res, 200, { events: [], cursor: fseq, ack: ackSeq });
      }, 60000);
      req.on('close', () => { clearTimeout(poller.timer); pollers = pollers.filter((x) => x !== poller); });
      pollers.push(poller);
      return;
    }

    // ----- agent ack: commit the cursor AFTER the feedback was handled -----
    if (route === 'POST /api/poll/ack') {
      const body = JSON.parse(await readBody(req) || '{}');
      const seq = parseInt(body.seq, 10);
      if (!Number.isInteger(seq) || seq < 0) return sendJson(res, 400, { error: 'seq required (integer)' });
      if (seq > fseq) return sendJson(res, 400, { error: 'seq ' + seq + ' beyond queue head ' + fseq });
      commitAck(seq);
      return sendJson(res, 200, { ok: true, ack: ackSeq });
    }

    // ----- SSE -----
    if (route === 'GET /api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('event: board\ndata: ' + JSON.stringify(board) + '\n\n');
      res.write(statusEvent());
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    sendJson(res, 400, { error: String(e.message || e) });
  }
});

server.on('error', (e) => { console.error('server error: ' + e.message); cleanup(); process.exit(1); });
server.listen(opts.port, opts.host, () => {
  console.log('bridge server up: http://localhost:' + opts.port + '/ host=' + opts.host + ' board=' + opts.board + ' pid=' + process.pid);
});
