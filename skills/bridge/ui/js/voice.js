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
  // Only ever return a voice that is actually in the loaded list, so a stale or
  // not-yet-loaded selection falls back to the engine default instead of failing.
  const sel = selectedVoice();
  if (sel && voices.includes(sel)) return sel;
  return voices.find((v) => /pt[-_]BR/i.test(v.lang)) || voices.find((v) => /^pt/i.test(v.lang)) || null;
}
function utter(text) {
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) { u.voice = v; u.lang = v.lang; } // else: default voice (voices may still be loading)
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
// ---------- robust speech controller ----------
// Reliability hazards this guards against:
//  - overlapping utterances wedging the queue (rapid messages) -> cancel-and-
//    speak-latest: a new message supersedes the old so the newest is always heard;
//  - Chrome/Safari idle auto-pause and the ~15s mid-utterance cutoff -> a keepalive
//    that resume()s while speaking, plus splitting long text into sentence chunks;
//  - a stuck/failed utterance killing all later speech -> onerror resets the engine
//    and retries the chunk once, then moves on instead of dying silently.
let speakQueue = [];   // remaining chunks of the CURRENT message
let speakGen = 0;      // bumped per message; stale utterance callbacks are ignored
let retriedChunk = false;
let keepalive = null;

function stopKeepalive() { if (keepalive) { clearInterval(keepalive); keepalive = null; } }
function startKeepalive() {
  stopKeepalive();
  keepalive = setInterval(() => {
    if (!window.speechSynthesis) return stopKeepalive();
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.resume();
    else stopKeepalive();
  }, 7000);
}
// split into sentence-sized chunks so no single utterance is long enough to hit
// the engine's mid-utterance cutoff; hard-wrap anything still oversized.
function chunkText(s) {
  const parts = s.match(/[^.!?\n]+[.!?]*|\n+/g) || [s];
  const out = [];
  let buf = '';
  for (let p of parts) {
    p = p.replace(/\s+/g, ' ').trim();
    if (!p) continue;
    if (buf && (buf + ' ' + p).length > 180) { out.push(buf); buf = ''; }
    buf = buf ? buf + ' ' + p : p;
    while (buf.length > 200) { out.push(buf.slice(0, 200)); buf = buf.slice(200).trim(); }
  }
  if (buf) out.push(buf);
  return out.length ? out : [s];
}
function playNext(gen) {
  if (gen !== speakGen) return;             // a newer message superseded this one
  if (!speakQueue.length) { stopKeepalive(); return; }
  const u = utter(speakQueue[0]);
  u.onend = () => { if (gen !== speakGen) return; speakQueue.shift(); retriedChunk = false; playNext(gen); };
  u.onerror = () => {
    if (gen !== speakGen) return;           // 'canceled'/'interrupted' from a newer speak(): ignore
    if (!retriedChunk) {                     // recover once: reset the engine, retry this chunk
      retriedChunk = true;
      try { speechSynthesis.cancel(); } catch (e) {}
      setTimeout(() => playNext(gen), 150);
    } else { retriedChunk = false; speakQueue.shift(); playNext(gen); } // give up on this chunk, continue
  };
  try { speechSynthesis.resume(); speechSynthesis.speak(u); }
  catch (e) { speakQueue.shift(); playNext(gen); }
}
export function speak(text) {
  if (!voiceOn || !window.speechSynthesis) return;
  const plain = stripForSpeech(text);
  if (!plain) return;
  manualSpeakingKey = null;                  // an auto-speak supersedes any manual toggle state
  speakPlain(plain);
}
export function stopSpeaking() {
  speakGen++; speakQueue = []; stopKeepalive();
  try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}
}
function stripForSpeech(text) {
  return stripEmoji(text.replace(/```[\s\S]*?```/g, ' code ').replace(/[`*#\[\]()]/g, ' ').replace(/https?:\S+/g, ' link '));
}
// speak the queued chunks of `plain` as the newest message (shared by speak() and manual)
function speakPlain(plain) {
  const gen = ++speakGen;                    // newest message wins
  speakQueue = chunkText(plain.slice(0, 1200));
  retriedChunk = false;
  try { speechSynthesis.cancel(); } catch (e) {} // clear anything in flight / a wedged queue
  startKeepalive();
  setTimeout(() => playNext(gen), 60);       // let cancel() settle before speak() (Chrome quirk)
}
// Manual, on-demand speak for a single message. Independent of the auto-speak
// toggle: this call happens inside a real user gesture (the speak-button click),
// so it runs the SAME proven unlock+speak routine the test button uses and works
// even on iOS where SSE-driven auto-speak is gesture-locked. Returns true if it
// spoke, false if there was nothing to say / no engine. Clicking again while this
// message is speaking stops it (cheap toggle).
let manualSpeakingKey = null;
export function speakMessage(text, key) {
  if (!window.speechSynthesis) return false;
  if (key != null && manualSpeakingKey === key && (speechSynthesis.speaking || speechSynthesis.pending)) {
    manualSpeakingKey = null; stopSpeaking(); return false; // toggle off
  }
  const plain = stripForSpeech(text);
  if (!plain) return false;
  primeVoice();                              // unlock in-gesture (no-op if already primed)
  manualSpeakingKey = key != null ? key : null;
  speakPlain(plain);
  return true;
}
function setVoiceOn(on) {
  voiceOn = on;
  voiceBtn.classList.toggle('on', on);
  voiceBtn.textContent = on ? '🔊 on' : '🔊 off';
  document.getElementById('voice-tools').classList.toggle('dim', !on);
  if (!on) stopSpeaking(); // turning voice off silences anything mid-utterance
  try { if (on) localStorage.setItem(VOICE_ON_KEY, '1'); else localStorage.removeItem(VOICE_ON_KEY); } catch (e) {}
}
// speechSynthesis is gesture-gated: after load it stays muted until a genuine
// user interaction speaks a REAL utterance. The voice-TEST button reliably
// unlocks because it does exactly that; a silent/volume-0 primer does NOT count
// on iOS Safari, so the engine stayed half-locked and SSE-driven messages (not
// in a gesture) failed until the test button was pressed. So every unlock path
// runs the SAME routine the test button uses — cancel, resume, utter(), speak at
// full volume — differing only in the text. The primer speaks a lone "." which
// engines voice as (essentially) nothing, but iOS still accepts it as real.
let primed = false;
function realUnlock(text) {
  if (!window.speechSynthesis) return;
  try {
    speechSynthesis.cancel();
    speechSynthesis.resume();
    speechSynthesis.speak(utter(text)); // real, non-empty, full-volume utterance in-gesture
    primed = true;
  } catch (e) {}
}
function primeVoice() { if (!primed) realUnlock('.'); } // near-silent but REAL unlock
// Fallback: unlock on the very first user gesture anywhere on the page.
function firstGestureUnlock() {
  primeVoice();
  if (primed) for (const ev of ['pointerdown', 'keydown', 'touchend']) document.removeEventListener(ev, firstGestureUnlock);
}
for (const ev of ['pointerdown', 'keydown', 'touchend']) document.addEventListener(ev, firstGestureUnlock, { passive: true });

voiceBtn.onclick = () => {
  primeVoice(); // this click is a gesture — unlock so subsequent messages voice
  setVoiceOn(!voiceOn);
};
try { if (localStorage.getItem(VOICE_ON_KEY) === '1') setVoiceOn(true); } catch (e) {} // restore toggle; unlock waits for a gesture
// the test button is the proven unlock path; it just uses an audible greeting.
document.getElementById('voice-test').onclick = () => realUnlock('Hello, this is my voice.');

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
