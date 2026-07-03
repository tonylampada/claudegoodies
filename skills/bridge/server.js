#!/usr/bin/env node
// bridge server — agent OS board. Node built-ins only, no deps.
// Usage: node server.js --port 4777 --board default --host 0.0.0.0
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------- args ----------
function parseArgs(argv) {
  const opts = { port: 4777, board: 'default', host: '0.0.0.0' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') opts.port = parseInt(argv[++i], 10);
    else if (argv[i] === '--board') opts.board = argv[++i];
    else if (argv[i] === '--host') opts.host = argv[++i];
  }
  if (!Number.isInteger(opts.port) || opts.port <= 0) { console.error('bad --port'); process.exit(1); }
  if (!opts.host) { console.error('bad --host'); process.exit(1); }
  if (!/^[\w.-]+$/.test(opts.board)) { console.error('bad --board (use [A-Za-z0-9_.-])'); process.exit(1); }
  return opts;
}
const opts = parseArgs(process.argv.slice(2));

// ---------- paths ----------
const BRIDGE_DIR = path.join(os.homedir(), '.bridge');
const BOARDS_DIR = path.join(BRIDGE_DIR, 'boards');
const BOARD_FILE = path.join(BOARDS_DIR, opts.board + '.json');
const FEEDBACK_FILE = path.join(BOARDS_DIR, opts.board + '.feedback.jsonl');
const PID_FILE = path.join(BRIDGE_DIR, 'server-' + opts.port + '.pid');
const CONFIG_FILE = path.join(BRIDGE_DIR, 'config.json');
const UI_FILE = path.join(__dirname, 'ui.html');
fs.mkdirSync(BOARDS_DIR, { recursive: true });

// ---------- user config (~/.bridge/config.json, read per-request; defensive parse) ----------
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
  return { title: opts.board, subtitle: '', updated: now(), columns: [], cards: [], chat: [], labels: [] };
}
function loadBoard() {
  try { return Object.assign(defaultBoard(), JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8'))); }
  catch (e) { return defaultBoard(); }
}
let board = loadBoard();
function saveBoard() {
  board.updated = now();
  const tmp = BOARD_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(board, null, 2));
  fs.renameSync(tmp, BOARD_FILE);
}

// ---------- label registry (user-owned, like card labels; persisted in board json) ----------
const LABEL_PALETTE = ['#4cc2ff', '#2fbf71', '#e2b93b', '#c678dd', '#e2795b', '#56b6c2', '#98c379', '#e06c75'];
function validColor(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null; }
function labelIndex(name) {
  if (!Array.isArray(board.labels)) board.labels = [];
  return board.labels.findIndex((l) => l && l.name === name);
}
// Auto-register unknown card label names with a default palette color.
function registerCardLabels() {
  if (!Array.isArray(board.labels)) board.labels = [];
  for (const c of board.cards) {
    for (const n of c.labels || []) {
      if (typeof n === 'string' && n && labelIndex(n) < 0) {
        board.labels.push({ name: n, color: LABEL_PALETTE[board.labels.length % LABEL_PALETTE.length] });
      }
    }
  }
}

// ---------- feedback queue (durable jsonl, monotonic seq) ----------
let feedback = [];
try {
  feedback = fs.readFileSync(FEEDBACK_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
} catch (e) {}
let seq = feedback.length ? feedback[feedback.length - 1].seq : 0;
function pushFeedback(target, text) {
  const ev = { seq: ++seq, target, text, ts: now() };
  feedback.push(ev);
  fs.appendFileSync(FEEDBACK_FILE, JSON.stringify(ev) + '\n');
  flushPollers();
  return ev;
}

// ---------- long-poll waiters ----------
let pollers = []; // {since, res, timer}
function feedbackSince(since) { return feedback.filter((e) => e.seq > since); }
function flushPollers() {
  pollers = pollers.filter((p) => {
    const evs = feedbackSince(p.since);
    if (!evs.length) return true;
    clearTimeout(p.timer);
    sendJson(p.res, 200, { events: evs, cursor: seq });
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

// ---------- awaiting-agent tracking ----------
// In-memory by design: "awaiting reply" is a transient UI signal. A restart clears it,
// while the durable feedback jsonl still carries the messages themselves.
const awaiting = new Set(); // targets with user feedback not yet answered by an agent message
function statusEvent() {
  return 'event: status\ndata: ' + JSON.stringify({ awaiting: Array.from(awaiting) }) + '\n\n';
}
function broadcastStatus() { const payload = statusEvent(); for (const res of sseClients) res.write(payload); }
function setAwaiting(target, on) {
  const changed = on ? !awaiting.has(target) : awaiting.delete(target);
  if (on) awaiting.add(target);
  if (changed) broadcastStatus();
}
function pruneAwaiting() { // drop targets whose card/thread no longer exists
  let changed = false;
  for (const t of Array.from(awaiting)) if (!threadFor(t)) { awaiting.delete(t); changed = true; }
  if (changed) broadcastStatus();
}

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
function threadFor(target) {
  if (target === 'chat') return board.chat;
  const m = /^card:(.+)$/.exec(target || '');
  if (m) {
    const card = board.cards.find((c) => c.id === m[1]);
    if (card) return (card.thread = card.thread || []);
  }
  return null;
}
function touchCard(target) { // thread activity refreshes the card's recency stamp
  const m = /^card:(.+)$/.exec(target || '');
  const card = m && board.cards.find((c) => c.id === m[1]);
  if (card) card.updated = now();
}
// Change-aware recency: deep-compare cards ignoring volatile fields (updated, thread),
// key-order-insensitive, so identical mirror syncs never bump "updated".
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]);
    return o;
  }
  return v;
}
function sameCardContent(a, b) {
  const strip = (c) => {
    const o = Object.assign({}, c);
    delete o.updated; delete o.thread;
    return o;
  };
  return JSON.stringify(sortKeys(strip(a))) === JSON.stringify(sortKeys(strip(b)));
}
// Merge a patch onto an existing card; "updated" = last REAL change: an explicit stamp
// wins, unchanged content keeps the old stamp, changed content stamps now().
function mergeCard(prevCard, patch) {
  const merged = Object.assign({}, prevCard, patch);
  merged.updated = patch.updated ||
    (sameCardContent(merged, prevCard) ? prevCard.updated || now() : now());
  return merged;
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = req.method + ' ' + url.pathname;
  try {
    if (route === 'GET /') {
      const html = fs.readFileSync(UI_FILE);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    if (route === 'GET /api/board') return sendJson(res, 200, board);
    if (route === 'GET /api/config') return sendJson(res, 200, userConfig());
    if (route === 'GET /api/status') {
      return sendJson(res, 200, { board: opts.board, port: opts.port, cards: board.cards.length, feedback_seq: seq, awaiting: Array.from(awaiting), pid: process.pid });
    }
    if (route === 'POST /api/board') {
      const doc = JSON.parse(await readBody(req));
      const prev = board;
      board = Object.assign(defaultBoard(), doc);
      // labels are user-owned: a full sync whose cards omit the field inherits the old labels,
      // and a doc without a labels registry inherits the old registry
      for (const c of board.cards) {
        if (!c || !c.id) continue;
        const old = prev.cards.find((o) => o.id === c.id);
        if (c.labels === undefined && old && old.labels) c.labels = old.labels;
        // keep recency meaningful: when the doc omits updated, an unchanged card keeps
        // its old stamp (mirror syncs are timestamp-neutral); changed or new stamps now()
        if (!c.updated) {
          c.updated = old ? (sameCardContent(c, old) ? old.updated || now() : now()) : now();
        }
      }
      if (doc.labels === undefined) board.labels = Array.isArray(prev.labels) ? prev.labels : [];
      registerCardLabels();
      saveBoard(); broadcast(); pruneAwaiting();
      return sendJson(res, 200, { ok: true, updated: board.updated });
    }
    if (route === 'PATCH /api/cards') {
      const body = JSON.parse(await readBody(req));
      // Optional top-level columns: replaces board.columns only (cards/threads/chat/labels
      // untouched). Present = validate+set; absent = untouched. Setting identical columns is
      // a guarded no-op so callers can push the same frame every sync without churn.
      let columnsChanged = false;
      if (body.columns !== undefined) {
        if (!Array.isArray(body.columns) ||
            !body.columns.every((c) => c && typeof c.id === 'string' && typeof c.title === 'string')) {
          return sendJson(res, 400, { error: 'columns must be [{id:string,title:string}]' });
        }
        const next = body.columns.map((c) => ({ id: c.id, title: c.title }));
        if (JSON.stringify(next) !== JSON.stringify((board.columns || []).map((c) => ({ id: c.id, title: c.title })))) {
          board.columns = next;
          columnsChanged = true;
        }
      }
      const hasCardOps = (body.update && body.update.length) ||
        (body.upsert && body.upsert.length) || (body.remove && body.remove.length);
      // columns-only PATCH with identical columns: full no-op, nothing saved or broadcast.
      if (!hasCardOps && body.columns !== undefined && !columnsChanged) {
        return sendJson(res, 200, { ok: true, columns: board.columns.length, unchanged: true });
      }
      // update: merge onto EXISTING cards only (never creates). Used by the UI for
      // user-owned fields like labels, so a typo'd id can't create a phantom card.
      for (const card of body.update || []) {
        if (!card.id) return sendJson(res, 400, { error: 'card without id' });
        const i = board.cards.findIndex((c) => c.id === card.id);
        if (i < 0) return sendJson(res, 404, { error: 'unknown card: ' + card.id });
        if (!card.thread) card.thread = board.cards[i].thread || [];
        board.cards[i] = mergeCard(board.cards[i], card);
      }
      for (const card of body.upsert || []) {
        if (!card.id) return sendJson(res, 400, { error: 'card without id' });
        const i = board.cards.findIndex((c) => c.id === card.id);
        if (i >= 0) {
          // merge: keep existing thread unless the upsert brings one
          if (!card.thread) card.thread = board.cards[i].thread || [];
          board.cards[i] = mergeCard(board.cards[i], card);
        } else {
          card.thread = card.thread || [];
          card.updated = card.updated || now();
          board.cards.push(card);
        }
      }
      for (const id of body.remove || []) board.cards = board.cards.filter((c) => c.id !== id);
      registerCardLabels();
      saveBoard(); broadcast(); pruneAwaiting();
      return sendJson(res, 200, { ok: true, cards: board.cards.length });
    }
    if (route === 'POST /api/labels') {
      // registry mutations: {create:{name,color?}} | {rename:{from,to}} | {recolor:{name,color}} | {delete:{name}}
      const b = JSON.parse(await readBody(req));
      if (!Array.isArray(board.labels)) board.labels = [];
      if (b.create) {
        const name = String(b.create.name || '').trim();
        if (!name) return sendJson(res, 400, { error: 'label name required' });
        const color = validColor(b.create.color);
        const i = labelIndex(name);
        if (i >= 0) { if (color) board.labels[i].color = color; } // merge, never duplicate
        else board.labels.push({ name, color: color || LABEL_PALETTE[board.labels.length % LABEL_PALETTE.length] });
      } else if (b.rename) {
        const from = String(b.rename.from || ''), to = String(b.rename.to || '').trim();
        const i = labelIndex(from);
        if (i < 0) return sendJson(res, 404, { error: 'unknown label: ' + from });
        if (!to) return sendJson(res, 400, { error: 'new name required' });
        if (to !== from && labelIndex(to) >= 0) return sendJson(res, 400, { error: 'label exists: ' + to });
        board.labels[i].name = to;
        for (const c of board.cards) { // cascade to every card carrying it
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
        for (const c of board.cards) { // cascade removal from every card
          if (Array.isArray(c.labels)) c.labels = c.labels.filter((n) => n !== name);
        }
      } else {
        return sendJson(res, 400, { error: 'expected create|rename|recolor|delete' });
      }
      saveBoard(); broadcast();
      return sendJson(res, 200, { ok: true, labels: board.labels });
    }
    if (route === 'POST /api/message') {
      const body = JSON.parse(await readBody(req));
      const thread = threadFor(body.target);
      if (!thread) return sendJson(res, 404, { error: 'unknown target: ' + body.target });
      thread.push({ author: body.author || 'agent', text: String(body.text_md || body.text || ''), ts: now() });
      touchCard(body.target);
      saveBoard(); broadcast(); setAwaiting(body.target, false);
      return sendJson(res, 200, { ok: true });
    }
    if (route === 'POST /api/feedback') {
      const body = JSON.parse(await readBody(req));
      const thread = threadFor(body.target);
      if (!thread) return sendJson(res, 404, { error: 'unknown target: ' + body.target });
      thread.push({ author: 'user', text: String(body.text || ''), ts: now() });
      touchCard(body.target);
      const ev = pushFeedback(body.target, String(body.text || ''));
      saveBoard(); broadcast(); setAwaiting(body.target, true);
      return sendJson(res, 200, { ok: true, seq: ev.seq });
    }
    if (route === 'GET /api/poll') {
      const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
      const evs = feedbackSince(since);
      if (evs.length) return sendJson(res, 200, { events: evs, cursor: seq });
      if (url.searchParams.get('nowait')) return sendJson(res, 200, { events: [], cursor: seq });
      const p = { since, res, timer: null };
      p.timer = setTimeout(() => {
        pollers = pollers.filter((x) => x !== p);
        sendJson(res, 200, { events: [], cursor: seq });
      }, 60000);
      req.on('close', () => { clearTimeout(p.timer); pollers = pollers.filter((x) => x !== p); });
      pollers.push(p);
      return;
    }
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
