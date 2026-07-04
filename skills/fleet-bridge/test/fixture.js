'use strict';
// Fixture firstmate homes (temp dirs, neutral names) and runners for the
// fleet-bridge CLIs. Zero deps; the ephemeral bridge server comes from
// skills/bridge/test/helper.js.
//
// Run the suite with:
//   node --test skills/fleet-bridge/test/*.test.js
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SYNC = path.join(__dirname, '..', 'fm-board-sync');
const SUBAGENT = path.join(__dirname, '..', 'fm-subagent');

// A minimal firstmate home skeleton in a temp dir.
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-home-'));
  fs.mkdirSync(path.join(home, 'data'), { recursive: true });
  fs.mkdirSync(path.join(home, 'state'), { recursive: true });
  return home;
}
function rmHome(home) { fs.rmSync(home, { recursive: true, force: true }); }

// backlog({inflight: ['<id> - <line>'], done: ['<id> - <line> - <url> (merged <date>)']})
function writeBacklog(home, sections = {}) {
  const md = [
    '## In flight',
    ...(sections.inflight || []).map((l) => '- [ ] ' + l),
    '',
    '## Queued',
    '',
    '## Done',
    ...(sections.done || []).map((l) => '- [x] ' + l),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(home, 'data', 'backlog.md'), md);
}
function writeMeta(home, id, lines = []) {
  fs.writeFileSync(path.join(home, 'state', id + '.meta'), lines.join('\n') + '\n');
}
function rmMeta(home, id) {
  fs.rmSync(path.join(home, 'state', id + '.meta'), { force: true });
}
function writeStatus(home, id, lines) {
  fs.writeFileSync(path.join(home, 'state', id + '.status'), lines.join('\n') + '\n');
}
function touchTurnEnded(home, id) {
  fs.writeFileSync(path.join(home, 'state', id + '.turn-ended'), '');
}
// Write the crewmate brief; returns its absolute path.
function writeBrief(home, id, text) {
  const dir = path.join(home, 'data', id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'brief.md');
  fs.writeFileSync(file, text || '# brief\n');
  return file;
}
function writeAliases(home, lines) {
  fs.writeFileSync(path.join(home, 'data', 'board-aliases'), lines.join('\n') + '\n');
}
// Push a file's mtime into the past (evidence-staleness control).
function backdate(file, secsAgo) {
  const t = new Date(Date.now() - secsAgo * 1000);
  fs.utimesSync(file, t, t);
}

function run(bin, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], {
      env: Object.assign({}, process.env, env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
const runSync = (args, env) => run(SYNC, args, env);
const runSubagent = (args, env) => run(SUBAGENT, args, env);

// Apply the feeder against a helper.js server for one home.
function syncApply(s, home, env) {
  return runSync(['--home', home, '--apply', '--port', String(s.port), '--board', s.board], env);
}
// Dry-run plan for one home (parsed JSON).
async function syncPlan(s, home, env) {
  const r = await runSync(['--home', home, '--port', String(s.port), '--board', s.board], env);
  if (r.code !== 0) throw new Error('sync plan failed: ' + r.stderr);
  return JSON.parse(r.stdout);
}

async function getCard(s, id) {
  const r = await s.api('GET', '/api/cards/' + encodeURIComponent(id));
  if (r.status !== 200) throw new Error('GET card ' + id + ': HTTP ' + r.status);
  return r.body;
}

module.exports = {
  makeHome, rmHome, writeBacklog, writeMeta, rmMeta, writeStatus, touchTurnEnded,
  writeBrief, writeAliases, backdate, runSync, runSubagent, syncApply, syncPlan,
  getCard, SYNC, SUBAGENT,
};
