// central UI state + derived selectors. The board doc from SSE is the truth;
// everything here is view state or cheap derivation over it.
export const USER = 'user';

export const S = {
  doc: null,               // full board doc from the server
  awaiting: new Set(),     // targets awaiting an agent reply (typing indicator)
  stale: new Set(),        // awaiting targets past the server's stale threshold (may be stuck)
  connected: false,
  chatMode: { mode: 'main' },   // {mode:'main'} | {mode:'card', id}
  openCardId: null,        // detail panel
  view: 'chat',            // mobile tab: 'chat' | 'board'
  filters: { text: '', age: '', sel: [] },  // sel: [{kind:'label'|'owner', value}]
  notifOpen: false,
  notifShowAll: false,
  notifExpanded: new Set(), // seq of level-1 item whose preceding gap is expanded
};

let renderFn = () => {};
export function onRender(fn) { renderFn = fn; }
export function render() { renderFn(); }

// ---------- selectors ----------
export function cards() { return (S.doc && S.doc.cards) || []; }
export function card(id) { return cards().find((c) => c.id === id); }
export function columns() { return (S.doc && S.doc.columns) || []; }

export function reads() {
  const r = (S.doc && S.doc.reads && S.doc.reads[USER]) || {};
  return {
    notifSeq: r.notifSeq || 0,
    notifSeqs: r.notifSeqs || [],
    threads: r.threads || {},
  };
}
export function threadReadTs(target) { return reads().threads[target] || ''; }
export function threadUnread(target, msgs) {
  const ts = threadReadTs(target);
  return (msgs || []).filter((m) => m.author !== USER && (!ts || m.ts > ts)).length;
}
export function cardUnread(c) { return threadUnread('card:' + c.id, c.thread); }

// the unified event stream: board-level events + every card's events, by seq
export function allEvents() {
  const out = [];
  for (const e of (S.doc && S.doc.events) || []) out.push(e);
  for (const c of cards()) for (const e of c.events || []) out.push(Object.assign({ card: c.id, cardTitle: c.title }, e));
  out.sort((a, b) => a.seq - b.seq);
  return out;
}
export function notifItems() { // level-1 slice, newest first, with read flags
  const r = reads();
  return allEvents().filter((e) => e.level === 1).reverse()
    .map((e) => Object.assign({}, e, { read: e.seq <= r.notifSeq || r.notifSeqs.includes(e.seq) }));
}
export function notifUnreadCount() { return notifItems().filter((e) => !e.read).length; }

// ---------- filters ----------
export function filterSelected(kind, value) { return S.filters.sel.some((f) => f.kind === kind && f.value === value); }
export function toggleFilter(kind, value) {
  if (!value) return;
  const i = S.filters.sel.findIndex((f) => f.kind === kind && f.value === value);
  if (i >= 0) S.filters.sel.splice(i, 1); else S.filters.sel.push({ kind, value });
  render();
}
export function clearFilters() {
  S.filters = { text: '', age: '', sel: [] };
  render();
}
export function filtersActive() {
  return !!(S.filters.text || S.filters.age || S.filters.sel.length);
}
function ageCutoff() {
  const v = S.filters.age;
  if (!v) return 0;
  if (v === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  return Date.now() - parseInt(v, 10) * 1000;
}
function haystack(c) {
  const col = columns().find((k) => k.id === c.column);
  const at = c.attributes || {};
  return [c.title, c.id, c.body, (c.labels || []).join(' '),
    Object.entries(at).map(([k, v]) => k + ' ' + v).join(' '),
    col ? col.title : c.column,
  ].filter(Boolean).join(' ').toLowerCase();
}
export function cardVisible(c) {
  if (!filtersActive()) return true;
  const q = S.filters.text.trim().toLowerCase();
  if (q && !haystack(c).includes(q)) return false;
  const cutoff = ageCutoff();
  if (cutoff && (!c.updated || new Date(c.updated).getTime() < cutoff)) return false;
  for (const f of S.filters.sel) {
    if (f.kind === 'owner') { if (((c.attributes || {}).owner || '') !== f.value) return false; }
    else if (!(c.labels || []).includes(f.value)) return false;
  }
  return true;
}
