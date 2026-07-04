// card detail: attributes header + markdown body + event timeline (chat lives in the chat panel)
import { S, card, render, toggleFilter, filterSelected } from './state.js';
import { esc, hhmm, ago, cardEmoji, ownerColor, KIND_EMOJI } from './util.js';
import { md } from './md.js';
import { api } from './api.js';
import { labelChipHtml, labelColor, openLabelPicker, saveCardLabels } from './labels.js';
import { openCardThread, syncChatToMain } from './chat.js';
import { openMoveMenu } from './board.js';

const isDesktop = () => window.innerWidth > 760; // matches the chat.js layout breakpoint

const el = document.getElementById('detail');
const titleEl = document.getElementById('dt-title');
const titleInput = document.getElementById('dt-title-input');
let editingTitle = false; // true while the inline title editor is open (guards re-render clobber)

export function openDetail(id) {
  S.openCardId = id;
  // Desktop: selecting a card also syncs the left chat into that card's thread,
  // so its detail (right) and conversation (left) show side by side. Reuses the
  // one thread-switch owner; silent = no mobile tab-flip / focus steal. Mobile
  // keeps the tab layout untouched (chat switches only via the talk button).
  if (isDesktop()) { openCardThread(id, { silent: true }); return; } // openCardThread renders
  render();
}
export function closeDetail() {
  const wasId = S.openCardId;
  S.openCardId = null;
  if (editingTitle) stopTitleEdit();
  el.hidden = true;
  // Desktop: closing a card-synced detail returns the left chat to the main
  // conversation rather than stranding it on the just-closed card.
  if (isDesktop() && wasId && S.chatMode.mode === 'card' && S.chatMode.id === wasId) {
    syncChatToMain(); // renders
    return;
  }
  render();
}
export function detailOpen() { return !!S.openCardId; }

document.getElementById('dt-close').onclick = closeDetail;

// Click-outside dismiss (desktop side-panel only). On mobile the detail is
// full-screen (100vw), so there is no "outside" — the ✕ and Escape stay the only
// close affordances there. A click that lands outside #detail closes it, reusing
// the one closeDetail path (which also returns the left chat to main on desktop).
// Excluded from "outside": the left chat pane (#chat — on desktop it shows the
// selected card's own thread, so it's part of the card context, not outside),
// a .tile (its own handler switches to that card's detail — a switch, not a
// close) and the transient popovers (move menu, label picker, notif/settings
// panels) so dismissing one of those never also closes the detail. Net effect:
// only a click on the BOARD area (columns / empty space) closes via click-outside.
// If a rename is in progress, commit it (like Enter/blur) before
// closing rather than discarding it: commitTitleEdit reads card(S.openCardId) so
// it must run before closeDetail nulls it, and it clears editingTitle so
// closeDetail's own stopTitleEdit is then a no-op — no double-fire.
document.addEventListener('click', (e) => {
  if (!S.openCardId || !isDesktop()) return;
  const t = e.target;
  if (el.contains(t)) return;                 // inside the panel — stays open
  if (t.closest && (
    t.closest('#chat') ||                     // left chat = the selected card's thread; part of its context
    t.closest('.tile') ||                     // another card — switch, handled by its onclick
    t.closest('#move-menu') ||                // transient popovers dismiss on their own
    t.closest('#notif-panel') ||
    t.closest('#settings-panel') ||
    t.closest('#label-picker') ||
    t.closest('[data-label-add]')
  )) return;
  if (editingTitle) commitTitleEdit();        // save the in-progress rename first
  closeDetail();
});
document.getElementById('dt-talk').onclick = () => {
  if (S.openCardId) {
    const id = S.openCardId;
    // Desktop already shows the thread on the left (synced on select), so just
    // focus that thread — keep the detail open for the side-by-side view. Mobile
    // has no side-by-side, so switch the chat tab to the thread as before.
    if (isDesktop()) { openCardThread(id); return; }
    closeDetail();
    openCardThread(id);
  }
};
document.getElementById('dt-menu-btn').onclick = (e) => {
  e.stopPropagation();
  if (S.openCardId) {
    const r = e.target.getBoundingClientRect();
    openMoveMenu(S.openCardId, r.left, r.bottom + 4);
  }
};

// ---------- inline title rename ----------
function startTitleEdit() {
  const c = card(S.openCardId);
  if (!c || editingTitle) return;
  editingTitle = true;
  titleInput.value = c.title || c.id;
  titleEl.hidden = true;
  titleInput.hidden = false;
  titleInput.focus();
  titleInput.select();
}
function stopTitleEdit() {
  editingTitle = false;
  titleInput.hidden = true;
  titleEl.hidden = false;
}
async function commitTitleEdit() {
  if (!editingTitle) return;
  const c = card(S.openCardId);
  const to = titleInput.value.trim();
  stopTitleEdit();
  if (!c) return;
  if (!to || to === (c.title || '')) { render(); return; } // reject empty / no-op
  try { await api.patchCard(c.id, { title: to }); } // SSE board push repaints tile + detail live
  catch (e) { alert(e.message); render(); }
}
titleEl.onclick = startTitleEdit;
titleInput.onkeydown = (e) => {
  if (e.key === 'Enter') { e.preventDefault(); commitTitleEdit(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopTitleEdit(); render(); }
};
titleInput.onblur = commitTitleEdit;

function attrHtml(k, v) {
  const isUrl = /^https?:\/\//.test(String(v));
  const val = isUrl
    ? '<a class="v" href="' + esc(v) + '" target="_blank" rel="noopener">' + esc(String(v).replace(/^https?:\/\/(www\.)?/, '')) + '</a>'
    : '<span class="v">' + esc(String(v)) + '</span>';
  return '<span class="attr"><span class="k">' + esc(k) + '</span>' + val + '</span>';
}

export function renderDetail() {
  if (!S.openCardId) { el.hidden = true; return; }
  const c = card(S.openCardId);
  if (!c) { closeDetail(); return; }
  el.hidden = false;

  document.getElementById('dt-emoji').textContent = cardEmoji(c);
  if (!editingTitle) titleEl.textContent = c.title || c.id; // don't clobber an in-progress rename
  document.getElementById('dt-sub').textContent = c.id + ' · created ' + ago(c.created) + ' ago · updated ' + ago(c.updated) + ' ago';

  // attributes header (emoji shown up top already; owner gets its color)
  const at = c.attributes || {};
  const attrsEl = document.getElementById('dt-attrs');
  attrsEl.innerHTML = Object.entries(at)
    .filter(([k]) => k !== 'emoji')
    .map(([k, v]) => attrHtml(k, v)).join('');
  if (at.owner) {
    for (const a of attrsEl.querySelectorAll('.attr')) {
      if (a.querySelector('.k').textContent === 'owner') {
        const v = a.querySelector('.v');
        v.style.color = ownerColor(at.owner);
        a.style.cursor = 'pointer';
        a.title = 'filter by owner';
        a.onclick = () => toggleFilter('owner', at.owner);
      }
    }
  }

  // labels (user-owned)
  const labWrap = document.getElementById('dt-labels');
  labWrap.textContent = '';
  for (const name of c.labels || []) {
    const chip = document.createElement('span');
    chip.className = 'dlabel';
    chip.innerHTML = labelChipHtml(name, filterSelected('label', name));
    chip.querySelector('.label').onclick = () => toggleFilter('label', name);
    const x = document.createElement('button');
    x.type = 'button'; x.textContent = '✕'; x.title = 'remove label';
    x.onclick = () => saveCardLabels(c.id, (c.labels || []).filter((v) => v !== name));
    chip.appendChild(x);
    labWrap.appendChild(chip);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.id = 'dt-label-add';
  add.setAttribute('data-label-add', '');
  add.textContent = '+ label';
  add.onclick = () => openLabelPicker(c.id, add);
  labWrap.appendChild(add);

  // body
  document.getElementById('dt-body').innerHTML = md(c.body || '');

  // event timeline (newest first)
  const evEl = document.getElementById('dt-events');
  const events = (c.events || []).slice().reverse();
  evEl.innerHTML = events.map((e) =>
    '<div class="ev lvl' + e.level + '"><span class="dot"></span><div class="bd">' +
    '<div class="tx">' + (e.level === 1 ? esc(KIND_EMOJI[e.kind] || '') + ' ' : '') + esc(e.text) + '</div>' +
    '<div class="sub">' + esc(e.actor || '') + ' · ' + hhmm(e.ts) + ' · ' + ago(e.ts) + ' ago</div>' +
    '</div></div>').join('') || '<div class="ev"><div class="bd"><div class="sub">no events yet</div></div></div>';
}
