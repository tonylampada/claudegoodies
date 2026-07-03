// small shared helpers
export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
export function hhmm(iso) {
  try { return new Date(iso).toTimeString().slice(0, 5); } catch (e) { return ''; }
}
export function dayLabel(iso) {
  const d = new Date(iso), today = new Date();
  const key = d.toDateString();
  if (key === today.toDateString()) return 'today';
  const yd = new Date(today.getTime() - 86400000);
  if (key === yd.toDateString()) return 'yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// well-known signal emojis per event kind
export const KIND_EMOJI = { alert: '🚨', question: '❓', handoff: '👀', success: '✅', info: '💡' };

// default emojis for common card `type` attribute values; attributes.emoji overrides
const TYPE_EMOJI = {
  plan: '📋', implementation: '🔧', investigation: '🔍', discussion: '💬',
  bug: '🐛', idea: '💡', task: '📌', doc: '📄',
};
export function cardEmoji(card) {
  const at = (card && card.attributes) || {};
  if (at.emoji) return String(at.emoji);
  if (at.type && TYPE_EMOJI[String(at.type).toLowerCase()]) return TYPE_EMOJI[String(at.type).toLowerCase()];
  return '▫️';
}

const OWNER_PALETTE = ['#58b6ff', '#3ecf8e', '#e6c04a', '#c678dd', '#e2795b', '#56b6c2', '#98c379', '#e06c75'];
export function ownerColor(name) {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h * 33) ^ name.charCodeAt(i)) >>> 0;
  return OWNER_PALETTE[h % OWNER_PALETTE.length];
}
