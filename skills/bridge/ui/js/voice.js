// TTS: speak new agent messages when enabled; toggle persists in localStorage
import { api } from './api.js';

const VOICE_KEY = 'bridge-voice';
const VOICE_ON_KEY = 'bridge-voice-on';
const voiceSelect = document.getElementById('voice-select');
const voiceBtn = document.getElementById('voice-btn');

let voiceOn = false;
let voices = [];
let voiceFilter = null; // lowercase substrings from /api/config, or null

api.config().then((cfg) => {
  if (cfg && Array.isArray(cfg.voices) && cfg.voices.length) {
    voiceFilter = cfg.voices.map((s) => String(s).toLowerCase());
  }
  if (voices.length) populatePicker();
}).catch(() => {});

function savedVoice() {
  try { return JSON.parse(localStorage.getItem(VOICE_KEY)); } catch (e) { return null; }
}
function voiceRank(v) {
  if (/^pt[-_]BR/i.test(v.lang)) return 0;
  if (/^pt/i.test(v.lang)) return 1;
  if (/^en/i.test(v.lang)) return 2;
  return 3;
}
function populatePicker() {
  let sorted = voices.slice().sort((a, b) =>
    voiceRank(a) - voiceRank(b) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
  if (voiceFilter) {
    const matches = (v) => voiceFilter.some((f) => v.name.toLowerCase().includes(f));
    if (sorted.some(matches)) {
      const saved = savedVoice();
      const isSaved = (v) => saved && v.name === saved.name && v.lang === saved.lang;
      sorted = sorted.filter((v) => matches(v) || isSaved(v));
    }
  }
  voiceSelect.textContent = '';
  const def = document.createElement('option');
  def.value = '';
  def.textContent = 'default voice';
  voiceSelect.appendChild(def);
  for (const v of sorted) {
    const o = document.createElement('option');
    o.value = v.name + '|' + v.lang;
    o.textContent = v.name + ' (' + v.lang + ')';
    voiceSelect.appendChild(o);
  }
  const saved = savedVoice();
  if (saved && sorted.some((v) => v.name === saved.name && v.lang === saved.lang)) {
    voiceSelect.value = saved.name + '|' + saved.lang;
  }
}
function loadVoices() {
  voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  if (voices.length) populatePicker();
}
if (window.speechSynthesis) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
  let tries = 0;
  const retry = setInterval(() => {
    if (voices.length || ++tries > 10) clearInterval(retry); else loadVoices();
  }, 300);
}
function selectedVoice() {
  const val = voiceSelect.value;
  if (!val) return null;
  const i = val.lastIndexOf('|');
  const name = val.slice(0, i), lang = val.slice(i + 1);
  return voices.find((v) => v.name === name && v.lang === lang) || null;
}
voiceSelect.onchange = () => {
  const v = selectedVoice();
  if (v) localStorage.setItem(VOICE_KEY, JSON.stringify({ name: v.name, lang: v.lang }));
  else localStorage.removeItem(VOICE_KEY);
};
function pickVoice() {
  return selectedVoice() ||
    voices.find((v) => /pt[-_]BR/i.test(v.lang)) || voices.find((v) => /^pt/i.test(v.lang)) || null;
}
function utter(text) {
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) { u.voice = v; u.lang = v.lang; }
  return u;
}
function stripEmoji(s) { // spoken text only
  return s
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, ' ')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/[\u{FE00}-\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\u{20E3}]/gu, '')
    .replace(/[←-⇿⌀-⏿■-◿☀-➿⬀-⯿]/g, ' ')
    .replace(/\s{2,}/g, ' ').trim();
}
export function speak(text) {
  if (!voiceOn || !window.speechSynthesis) return;
  const plain = stripEmoji(text.replace(/```[\s\S]*?```/g, ' code ').replace(/[`*#\[\]()]/g, ' ').replace(/https?:\S+/g, ' link '));
  speechSynthesis.speak(utter(plain.slice(0, 600)));
}
function setVoiceOn(on) {
  voiceOn = on;
  voiceBtn.classList.toggle('on', on);
  voiceBtn.textContent = on ? '🔊 on' : '🔊 off';
  document.getElementById('voice-tools').classList.toggle('dim', !on);
  try { if (on) localStorage.setItem(VOICE_ON_KEY, '1'); else localStorage.removeItem(VOICE_ON_KEY); } catch (e) {}
}
voiceBtn.onclick = () => setVoiceOn(!voiceOn);
try { if (localStorage.getItem(VOICE_ON_KEY) === '1') setVoiceOn(true); } catch (e) {}
document.getElementById('voice-test').onclick = () => {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(utter('Hello, this is my voice.'));
};

// ---------- speak only NEW agent messages ----------
let firstLoad = true;
const seenMsgs = new Set();
export function trackMessages(doc) {
  if (!doc) return;
  const all = [];
  (doc.chat || []).forEach((m) => all.push(['chat', m]));
  (doc.cards || []).forEach((c) => (c.thread || []).forEach((m) => all.push(['card:' + c.id, m])));
  for (const [scope, m] of all) {
    const k = scope + '|' + m.ts + '|' + m.author + '|' + m.text;
    if (!seenMsgs.has(k)) {
      seenMsgs.add(k);
      if (!firstLoad && m.author !== 'user') speak(m.text);
    }
  }
  firstLoad = false;
}
