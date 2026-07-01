#!/usr/bin/env node
'use strict';
// Generate one audio file per narrated node in a spleak2me site, in parallel,
// using whatever TTS backend is available. Writes audio/<id>.<ext> + audio-manifest.js.
//
// Usage: node gen-audio.js <site-dir> [--concurrency N] [--backend edge|say] [--voice V]
//   <site-dir> must contain content.js (window.DOC). Audio goes to <site-dir>/audio/.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

// ---- args ----
const argv = process.argv.slice(2);
const SITE = path.resolve(argv[0] || '.');
function opt(name, def) { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : def; }
const CONCURRENCY = parseInt(opt('concurrency', '6'), 10) || 6;
const FORCE_BACKEND = opt('backend', '');
const FORCE_VOICE = opt('voice', '');

const CONTENT = path.join(SITE, 'content.js');
const AUDIO_DIR = path.join(SITE, 'audio');
const MANIFEST = path.join(SITE, 'audio-manifest.js');

if (!fs.existsSync(CONTENT)) { console.error('No content.js in ' + SITE); process.exit(1); }

// ---- load DOC ----
global.window = {};
require(CONTENT);
const DOC = global.window.DOC;
const META = (DOC && DOC.meta) || {};
const LANG = (META.lang || 'en').slice(0, 2).toLowerCase();

// ---- backend detection ----
function which(bin) { const r = spawnSync('which', [bin], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; }
function findEdge() {
  if (process.env.EDGE_TTS_BIN && fs.existsSync(process.env.EDGE_TTS_BIN)) return process.env.EDGE_TTS_BIN;
  const w = which('edge-tts'); if (w) return w;
  for (const p of [os.homedir() + '/.hermes/hermes-agent/venv/bin/edge-tts']) if (fs.existsSync(p)) return p;
  return null;
}
const EDGE = findEdge();
const SAY = which('say');
const FFMPEG = which('ffmpeg');
const AFCONVERT = which('afconvert');

let backend = FORCE_BACKEND;
if (!backend) backend = EDGE ? 'edge' : (SAY ? 'say' : null);
if (!backend) { console.error('No TTS backend found (looked for edge-tts and macOS `say`). Skipping audio.'); process.exit(2); }

// ---- voice maps ----
const EDGE_VOICES = { en: 'en-US-AvaNeural', pt: 'pt-BR-FranciscaNeural', es: 'es-ES-ElviraNeural', fr: 'fr-FR-DeniseNeural', de: 'de-DE-KatjaNeural', it: 'it-IT-ElsaNeural', nl: 'nl-NL-ColetteNeural', ja: 'ja-JP-NanamiNeural', zh: 'zh-CN-XiaoxiaoNeural' };
const SAY_VOICES = { en: 'Samantha', pt: 'Luciana', es: 'Monica', fr: 'Thomas', de: 'Anna', it: 'Alice', nl: 'Xander', ja: 'Kyoko', zh: 'Tingting' };
const VOICE = FORCE_VOICE || (backend === 'edge' ? (EDGE_VOICES[LANG] || EDGE_VOICES.en) : (SAY_VOICES[LANG] || SAY_VOICES.en));

// ---- narration cleaning (generic; author should write TTS-ready narration) ----
function clean(s) {
  return String(s || '')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/g, '$1')   // md links -> text
    .replace(/https?:\/\/\S+/g, ' ')                          // bare urls
    .replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/[*_#>~]/g, '')
    .replace(/\s+/g, ' ').trim();
}

// ---- collect narrated nodes ----
const items = [];
(DOC.sections || []).forEach(function collect(node) {
  if (node.narration) items.push({ id: node.id, text: clean(node.narration) });
  (node.children || []).forEach(collect);
});
if (!items.length) { console.error('No narrated nodes (no `narration` fields). Nothing to do.'); fs.writeFileSync(MANIFEST, 'window.AUDIO = {};\n'); process.exit(0); }

fs.mkdirSync(AUDIO_DIR, { recursive: true });

// ---- one generation, returns {id, file} or {id, err} ----
function runOnce(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, err }));
    p.on('error', (e) => resolve({ code: 1, err: String(e) }));
  });
}

async function genEdge(it) {
  const out = path.join(AUDIO_DIR, it.id + '.mp3');
  const rate = META.rate || '+6%';
  const r = await runOnce(EDGE, ['--voice', VOICE, '--rate', rate, '--text', it.text, '--write-media', out]);
  if (r.code === 0 && fs.existsSync(out)) return { id: it.id, rel: 'audio/' + it.id + '.mp3' };
  return { id: it.id, err: (r.err || 'edge-tts failed').slice(0, 140) };
}

async function genSay(it) {
  const aiff = path.join(AUDIO_DIR, it.id + '.aiff');
  const r = await runOnce(SAY, ['-v', VOICE, '-r', String(META.wpm || 180), '-o', aiff, it.text]);
  if (r.code !== 0 || !fs.existsSync(aiff)) return { id: it.id, err: (r.err || 'say failed').slice(0, 140) };
  // convert to a browser-friendly format
  if (FFMPEG) {
    const mp3 = path.join(AUDIO_DIR, it.id + '.mp3');
    const c = await runOnce(FFMPEG, ['-y', '-loglevel', 'error', '-i', aiff, mp3]);
    if (c.code === 0 && fs.existsSync(mp3)) { fs.unlinkSync(aiff); return { id: it.id, rel: 'audio/' + it.id + '.mp3' }; }
  }
  if (AFCONVERT) {
    const m4a = path.join(AUDIO_DIR, it.id + '.m4a');
    const c = await runOnce(AFCONVERT, ['-f', 'm4af', '-d', 'aac', aiff, m4a]);
    if (c.code === 0 && fs.existsSync(m4a)) { fs.unlinkSync(aiff); return { id: it.id, rel: 'audio/' + it.id + '.m4a' }; }
  }
  return { id: it.id, rel: 'audio/' + it.id + '.aiff' }; // fallback (Safari plays AIFF; Chrome may not)
}

const gen = backend === 'edge' ? genEdge : genSay;

// ---- parallel pool ----
async function pool(tasks, size, worker) {
  const results = new Array(tasks.length);
  let next = 0;
  async function run() { while (next < tasks.length) { const i = next++; results[i] = await worker(tasks[i]); } }
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, run));
  return results;
}

(async () => {
  console.log(`spleak2me audio · backend=${backend} · voice=${VOICE} · lang=${LANG} · ${items.length} clips · concurrency=${CONCURRENCY}`);
  const res = await pool(items, CONCURRENCY, gen);
  const manifest = {};
  let ok = 0, fail = 0;
  for (const r of res) {
    if (r.rel) { manifest[r.id] = r.rel; ok++; }
    else { fail++; console.error(`  ✗ ${r.id}: ${r.err}`); }
  }
  fs.writeFileSync(MANIFEST, 'window.AUDIO = ' + JSON.stringify(manifest, null, 2) + ';\n');
  console.log(`done: ${ok} ok, ${fail} fail → ${path.relative(process.cwd(), MANIFEST)}`);
  if (fail && !ok) process.exit(3);
})();
