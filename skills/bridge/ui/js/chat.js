// chat panel: unified main feed (messages + card-thread bubbles anchored at thread
// start), whole-window mode switch into a card thread, premium composer.
import { S, card, cards, render, threadUnread, USER } from './state.js';
import { api } from './api.js';
import { esc, hhmm, dayLabel, cardEmoji } from './util.js';
import { md } from './md.js';
import { speakMessage } from './voice.js';

const feedEl = document.getElementById('chat-feed');
const titleEl = document.getElementById('chat-title');
const backBtn = document.getElementById('chat-back');
const openBtn = document.getElementById('chat-card-open');
const inputEl = document.getElementById('chat-input');

let detailOpener = null; // set by main.js to avoid a circular import
export function onOpenCard(fn) { detailOpener = fn; }

export function currentTarget() {
  return S.chatMode.mode === 'card' ? 'card:' + S.chatMode.id : 'chat';
}
// Switch the chat panel into a card's thread. The one owner of the card
// mode-switch: the "talk" button and the desktop card-detail sync both go through
// here. opts.silent (desktop detail-sync) skips the mobile tab-switch and the
// input focus, so selecting a card doesn't steal focus or flip the mobile tab.
export function openCardThread(id, opts) {
  S.chatMode = { mode: 'card', id };
  if (!(opts && opts.silent)) {
    S.view = 'chat'; // on mobile, switch to the chat tab
    render();
    inputEl.focus();
  } else {
    render();
  }
}
// Return the chat panel to the main conversation (used when a synced card detail
// closes on desktop). Same mode representation as backToMain, no forked path.
export function syncChatToMain() {
  if (S.chatMode.mode === 'card') { S.chatMode = { mode: 'main' }; render(); }
}
export function backToMain() {
  S.chatMode = { mode: 'main' };
  render();
}
backBtn.onclick = backToMain;
openBtn.onclick = () => { if (S.chatMode.mode === 'card' && detailOpener) detailOpener(S.chatMode.id); };

// ---------- feed rendering ----------
// agent messages rendered this pass, in DOM order, so a post-render pass can wire
// each .msg.agent[data-speak] button to the right message's text without ever
// interpolating message text into markup (XSS-safe).
let speakMsgs = [];
function msgHtml(m) {
  const mine = m.author === USER;
  const body = mine
    ? '<div class="md pre">' + esc(m.text) + '</div>'
    : '<div class="md">' + md(m.text) + '</div>';
  const who = mine ? '' : esc(m.author) + ' · ';
  // speak button only on agent bubbles; 🔊 icon, no message text in markup
  const speakBtn = mine ? '' :
    '<button class="msg-speak" type="button" data-speak title="read this message aloud" aria-label="read this message aloud">🔊</button>';
  if (!mine) speakMsgs.push(m);
  return '<div class="msg ' + (mine ? 'user' : 'agent') + '">' + body +
    '<span class="ts">' + who + hhmm(m.ts) + '</span>' + speakBtn + '</div>';
}
function typingHtml() {
  return '<div class="msg agent typing" title="the agent is working on this">' +
    '<span class="tdot"></span><span class="tdot"></span><span class="tdot"></span>' +
    '<span class="lbl">agent is working…</span></div>';
}
function bubbleHtml(c) {
  const n = (c.thread || []).length;
  const unread = threadUnread('card:' + c.id, c.thread);
  return '<div class="tbubble" data-card="' + esc(c.id) + '" title="open this card\'s conversation">' +
    '<span class="em">' + esc(cardEmoji(c)) + '</span>' +
    '<div class="tt"><div class="t1">' + esc(c.title || c.id) + '</div>' +
    '<div class="t2">' + n + ' message' + (n === 1 ? '' : 's') + '</div></div>' +
    (unread ? '<span class="unread">' + unread + '</span>' : '') + '</div>';
}

function mainFeedItems() {
  // chat messages + one bubble per card thread, anchored at the FIXED point the
  // card conversation started (threadStart) — never re-anchored by new activity.
  const items = [];
  for (const m of (S.doc && S.doc.chat) || []) items.push({ ts: m.ts, html: msgHtml(m) });
  for (const c of cards()) {
    if (c.threadStart && (c.thread || []).length) items.push({ ts: c.threadStart, html: bubbleHtml(c) });
  }
  items.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return items;
}

// the conversation currently shown; a change means "jump to the newest message"
let lastViewKey = null;
// #chat can still be display:none this frame (renderTabs runs after renderChat),
// so defer the scroll across two frames until layout + visibility have settled.
function scrollFeedToBottom() {
  const jump = () => { feedEl.scrollTop = feedEl.scrollHeight; };
  requestAnimationFrame(() => { jump(); requestAnimationFrame(jump); });
}

export function renderChat() {
  const isCard = S.chatMode.mode === 'card';
  const c = isCard ? card(S.chatMode.id) : null;
  if (isCard && !c) { S.chatMode = { mode: 'main' }; return renderChat(); }

  backBtn.hidden = !isCard;
  openBtn.hidden = !isCard;
  titleEl.textContent = isCard ? cardEmoji(c) + ' ' + (c.title || c.id) : '💬 chat';
  inputEl.placeholder = isCard ? 'message this card…' : 'message the agent…';

  // Land at the newest message when the visible conversation changes (first
  // paint, tab switch into Chat, or entering/leaving a card thread) or when the
  // feed was already near the bottom; otherwise leave the reader's scroll be.
  const viewKey = currentTarget() + '|' + (window.innerWidth <= 760 ? S.view : 'desktop');
  const switched = viewKey !== lastViewKey;
  lastViewKey = viewKey;
  const pinned = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 48;
  speakMsgs = [];
  let html = '', lastDay = '';
  const push = (ts, itemHtml) => {
    const day = ts ? dayLabel(ts) : '';
    if (day && day !== lastDay) { html += '<div class="feed-day">' + esc(day) + '</div>'; lastDay = day; }
    html += itemHtml;
  };
  if (isCard) {
    for (const m of c.thread || []) push(m.ts, msgHtml(m));
  } else {
    for (const it of mainFeedItems()) push(it.ts, it.html);
  }
  if (S.awaiting.has(currentTarget())) html += typingHtml();
  feedEl.innerHTML = html || '<div class="empty">no messages yet</div>';
  if (switched) scrollFeedToBottom(); // deferred: the feed may still be hidden this frame
  else if (pinned) feedEl.scrollTop = feedEl.scrollHeight;

  feedEl.querySelectorAll('.tbubble').forEach((b) => {
    b.onclick = () => openCardThread(b.dataset.card);
  });

  // wire speak buttons: .msg.agent[data-speak] in DOM order maps 1:1 to speakMsgs
  const speakBtns = feedEl.querySelectorAll('.msg.agent [data-speak]');
  speakBtns.forEach((btn, i) => {
    const m = speakMsgs[i];
    if (!m) return;
    const key = currentTarget() + '|' + m.ts + '|' + m.author; // stable per message, for toggle-off
    btn.onclick = (e) => {
      e.stopPropagation();
      const spoke = speakMessage(m.text, key);
      btn.classList.toggle('speaking', spoke);
    };
  });

  maybeMarkRead(isCard ? c : null);
}

// mark the visible thread read (server-persisted) — debounced, loop-safe
let lastMarked = { target: '', ts: '' };
function maybeMarkRead(c) {
  if (document.hidden) return;
  if (window.innerWidth <= 760 && S.view !== 'chat') return; // thread not visible
  const target = currentTarget();
  const msgs = target === 'chat' ? ((S.doc && S.doc.chat) || []) : ((c && c.thread) || []);
  const unread = threadUnread(target, msgs);
  if (!unread) return;
  const lastTs = msgs.length ? msgs[msgs.length - 1].ts : '';
  if (lastMarked.target === target && lastMarked.ts === lastTs) return; // already sent
  lastMarked = { target, ts: lastTs };
  api.markThreadRead(target).catch(() => { lastMarked = { target: '', ts: '' }; });
}

// ---------- composer ----------
function autoGrow(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 132) + 'px'; }
async function send() {
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  autoGrow(inputEl);
  try { await api.feedback(currentTarget(), text); } catch (e) { alert(e.message); }
}
inputEl.oninput = () => autoGrow(inputEl);
inputEl.onkeydown = (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) { e.preventDefault(); send(); }
};
document.getElementById('chat-form').onsubmit = (e) => { e.preventDefault(); send(); };
