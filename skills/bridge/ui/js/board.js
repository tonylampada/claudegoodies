// board: columns of dense tiles, drag&drop, long-press move menu, new-card modal
import { S, columns, cards, cardVisible, cardUnread, toggleFilter, filterSelected, render } from './state.js';
import { api } from './api.js';
import { esc, ago, cardEmoji, ownerColor } from './util.js';
import { labelChipHtml } from './labels.js';
import { openDetail } from './detail.js';

const boardEl = document.getElementById('board');

function byRecency(a, b) {
  return (new Date(b.updated || 0).getTime() || 0) - (new Date(a.updated || 0).getTime() || 0);
}

function tileHtml(c) {
  const at = c.attributes || {};
  const owner = at.owner || '';
  const msgs = (c.thread || []).length;
  const unread = cardUnread(c);
  // agent-working animation: SAME source as the chat typing bubble
  // (S.awaiting, keyed 'card:<id>'), so tile and chat can never drift. Takes
  // priority over the unread dot — one unambiguous corner indicator.
  const working = S.awaiting.has('card:' + c.id);
  const cornerInd = working
    ? '<span class="t-typing" title="agent is working on this"><span class="tdot"></span><span class="tdot"></span><span class="tdot"></span></span>'
    : (unread ? '<span class="t-unread" title="' + unread + ' unread"></span>' : '');
  const hasLink = Object.entries(at).some(([k, v]) => k !== 'owner' && /^https?:\/\//.test(String(v)));
  const labels = (c.labels || []).map((n) => labelChipHtml(n, filterSelected('label', n))).join('');
  return '<div class="tile' + (c.id === S.openCardId ? ' open' : '') + '" draggable="true" data-id="' + esc(c.id) + '">' +
    '<div class="t-row1"><span class="t-emoji">' + esc(cardEmoji(c)) + '</span>' +
    '<span class="t-title">' + esc(c.title || c.id) + '</span>' +
    cornerInd + '</div>' +
    (labels ? '<div class="t-labels">' + labels + '</div>' : '') +
    '<div class="t-foot">' +
    (owner ? '<span class="t-owner' + (filterSelected('owner', owner) ? ' active' : '') + '" data-owner="' + esc(owner) +
      '" title="filter by owner"><span class="dot" style="background:' + ownerColor(owner) + '"></span>' + esc(owner) + '</span>' : '') +
    '<span class="grow"></span>' +
    (hasLink ? '<span class="t-ind" title="has link">📎</span>' : '') +
    (msgs ? '<span class="t-ind" title="' + msgs + ' messages">💬' + msgs + '</span>' : '') +
    '<span class="t-ago">' + ago(c.updated) + '</span>' +
    '</div></div>';
}

export function renderBoard() {
  const sx = boardEl.scrollLeft;
  const colScroll = {};
  boardEl.querySelectorAll('.column').forEach((col) => {
    colScroll[col.dataset.id] = col.querySelector('.cards').scrollTop;
  });

  const cols = columns();
  if (!cols.length) {
    boardEl.innerHTML = '<div class="empty">no columns yet — the agent hasn\'t set up this board</div>';
    return;
  }
  boardEl.innerHTML = cols.map((col) => {
    const list = cards().filter((c) => c.column === col.id && cardVisible(c)).sort(byRecency);
    return '<div class="column" data-id="' + esc(col.id) + '"><h2><span>' + esc(col.title || col.id) + '</span>' +
      '<span class="count">' + list.length + '</span>' +
      '<button class="add-card" title="new card here">+</button></h2>' +
      '<div class="cards">' + list.map(tileHtml).join('') + '</div></div>';
  }).join('');
  boardEl.scrollLeft = sx;
  boardEl.querySelectorAll('.column').forEach((col) => {
    if (colScroll[col.dataset.id] != null) col.querySelector('.cards').scrollTop = colScroll[col.dataset.id];
  });
  wire();
}

// ---------- interactions ----------
let pressTimer = null, pressFired = false;

function wire() {
  boardEl.querySelectorAll('.tile').forEach((el) => {
    el.onclick = (e) => {
      if (pressFired) { pressFired = false; return; } // long-press already handled
      const t = e.target;
      if (t.classList.contains('label')) { toggleFilter('label', t.dataset.label); return; }
      const own = t.closest('.t-owner');
      if (own) { toggleFilter('owner', own.dataset.owner); return; }
      openDetail(el.dataset.id);
    };
    // drag&drop (desktop)
    el.ondragstart = (e) => {
      e.dataTransfer.setData('text/bridge-card', el.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    };
    el.ondragend = () => el.classList.remove('dragging');
    // long-press (touch) -> move menu
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      pressFired = false;
      pressTimer = setTimeout(() => {
        pressFired = true;
        openMoveMenu(el.dataset.id, e.clientX, e.clientY);
      }, 480);
    });
    for (const evName of ['pointerup', 'pointercancel', 'pointermove']) {
      el.addEventListener(evName, (e) => {
        if (evName === 'pointermove' && pressTimer) return; // small moves ok until fired
        clearTimeout(pressTimer); pressTimer = null;
      });
    }
    el.oncontextmenu = (e) => { e.preventDefault(); openMoveMenu(el.dataset.id, e.clientX, e.clientY); };
  });
  boardEl.querySelectorAll('.column').forEach((col) => {
    const id = col.dataset.id;
    col.ondragover = (e) => {
      if (e.dataTransfer.types.includes('text/bridge-card')) { e.preventDefault(); col.classList.add('drag-over'); }
    };
    col.ondragleave = () => col.classList.remove('drag-over');
    col.ondrop = async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const cardId = e.dataTransfer.getData('text/bridge-card');
      if (cardId) { try { await api.moveCard(cardId, id); } catch (err) { alert(err.message); } }
    };
    col.querySelector('.add-card').onclick = (e) => { e.stopPropagation(); openNewCard(id); };
  });
}

// ---------- move / actions menu ----------
const menuEl = document.getElementById('move-menu');
export function openMoveMenu(cardId, x, y) {
  const c = cards().find((k) => k.id === cardId);
  if (!c) return;
  menuEl.textContent = '';
  const head = document.createElement('div');
  head.className = 'mm-head';
  head.textContent = 'move to';
  menuEl.appendChild(head);
  for (const col of columns()) {
    const b = document.createElement('button');
    b.textContent = (col.id === c.column ? '● ' : '') + col.title;
    if (col.id === c.column) b.className = 'cur';
    else b.onclick = async () => { closeMoveMenu(); try { await api.moveCard(cardId, col.id); } catch (e) { alert(e.message); } };
    menuEl.appendChild(b);
  }
  const sep = document.createElement('div');
  sep.className = 'mm-sep';
  menuEl.appendChild(sep);
  const kill = document.createElement('button');
  kill.className = 'danger';
  kill.textContent = '✕ archive';
  kill.onclick = async () => { closeMoveMenu(); try { await api.archiveCard(cardId); } catch (e) { alert(e.message); } };
  menuEl.appendChild(kill);
  menuEl.hidden = false;
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
  menuEl.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
}
export function closeMoveMenu() { menuEl.hidden = true; }
document.addEventListener('click', (e) => { if (!menuEl.hidden && !menuEl.contains(e.target)) closeMoveMenu(); });

// ---------- new card modal ----------
const ncOverlay = document.getElementById('nc-overlay');
const ncColumn = document.getElementById('nc-column');
export function openNewCard(columnId) {
  ncColumn.textContent = '';
  for (const col of columns()) {
    const o = document.createElement('option');
    o.value = col.id;
    o.textContent = col.title;
    ncColumn.appendChild(o);
  }
  ncColumn.value = columnId || (columns()[0] && columns()[0].id) || '';
  document.getElementById('nc-name').value = '';
  document.getElementById('nc-body').value = '';
  ncOverlay.hidden = false;
  document.getElementById('nc-name').focus();
}
export function closeNewCard() { ncOverlay.hidden = true; }
export function newCardOpen() { return !ncOverlay.hidden; }
document.getElementById('nc-cancel').onclick = closeNewCard;
ncOverlay.onclick = (e) => { if (e.target === ncOverlay) closeNewCard(); };
document.getElementById('nc-modal').onsubmit = async (e) => {
  e.preventDefault();
  const title = document.getElementById('nc-name').value.trim();
  if (!title) return;
  const body = document.getElementById('nc-body').value;
  try {
    const r = await api.createCard({ title, column: ncColumn.value, body });
    closeNewCard();
    openDetail(r.card.id);
  } catch (err) { alert(err.message); }
};
