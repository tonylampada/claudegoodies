// card detail: attributes header + markdown body + event timeline (chat lives in the chat panel)
import { S, card, render, toggleFilter, filterSelected } from './state.js';
import { esc, hhmm, ago, cardEmoji, ownerColor, KIND_EMOJI } from './util.js';
import { md } from './md.js';
import { labelChipHtml, labelColor, openLabelPicker, saveCardLabels } from './labels.js';
import { openCardThread } from './chat.js';
import { openMoveMenu } from './board.js';

const el = document.getElementById('detail');

export function openDetail(id) {
  S.openCardId = id;
  render();
}
export function closeDetail() {
  S.openCardId = null;
  el.hidden = true;
  render();
}
export function detailOpen() { return !!S.openCardId; }

document.getElementById('dt-close').onclick = closeDetail;
document.getElementById('dt-talk').onclick = () => {
  if (S.openCardId) {
    const id = S.openCardId;
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
  document.getElementById('dt-title').textContent = c.title || c.id;
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
