#!/usr/bin/env node
// heartbeat.js — hourly cron dispatcher for brains repos.
// Usage: heartbeat.js /path/to/brains-repo
//
// Discovers tasks from .brains.json + <brain>/heartbeat.json,
// sources .brainsrc for env, and runs tasks based on schedule.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoDir = process.argv[2];
if (!repoDir || !fs.existsSync(repoDir)) {
  console.error('Usage: heartbeat.js <repo-path>');
  process.exit(1);
}

const REPO_DIR = path.resolve(repoDir);
const STATE_FILE = path.join(REPO_DIR, '.heartbeat-state.json');
const LOGFILE = path.join(REPO_DIR, 'heartbeat.log');
const BRAINS_FILE = path.join(REPO_DIR, '.brains.json');
const BRAINSRC_FILE = path.join(REPO_DIR, '.brainsrc');

function log(msg) {
  fs.appendFileSync(LOGFILE, `[${new Date().toISOString()}] ${msg}\n`);
}

function discoverTasks() {
  if (!fs.existsSync(BRAINS_FILE)) {
    log('ERROR: .brains.json not found');
    return [];
  }
  const brains = JSON.parse(fs.readFileSync(BRAINS_FILE, 'utf8'));
  const tasks = [];
  for (const brain of brains) {
    const dir = typeof brain === 'string' ? brain : brain.dir;
    const hbFile = path.join(REPO_DIR, dir, 'heartbeat.json');
    if (!fs.existsSync(hbFile)) {
      log(`${dir}: no heartbeat.json, skipping`);
      continue;
    }
    const defs = JSON.parse(fs.readFileSync(hbFile, 'utf8'));
    for (const task of defs) {
      tasks.push({ ...task, brain: dir, name: `${dir}/${task.name}` });
    }
  }
  return tasks;
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

function shouldRun(task, now, state) {
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  if (!task.dow.includes(dow)) return 'wrong day';
  if (!task.hours.includes(now.getHours())) return 'wrong hour';
  const last = state[task.name] || 0;
  if ((Date.now() - last) / 3600000 < task.cooldownHours) return 'cooldown';
  return null;
}

function runTask(task, state) {
  const brainAbsDir = path.join(REPO_DIR, task.brain);
  const env = [
    `source "${BRAINSRC_FILE}"`,
    `export BRAIN_DIR="${brainAbsDir}"`,
    `export REPO_DIR="${REPO_DIR}"`,
    `export DRY_RUN=false`,
  ].join(' && ');

  const cmd = `bash -c '${env} && ${task.command}'`;
  try {
    execSync(cmd, { cwd: REPO_DIR, stdio: 'pipe', timeout: 60 * 60 * 1000 });
    state[task.name] = Date.now();
    saveState(state);
    log(`${task.name}: done`);
  } catch (err) {
    log(`${task.name}: FAILED — ${err.message}`);
  }
}

// ─── Main ──────────────────────────────────────────────────────
const now = new Date();
const state = loadState();
log(`heartbeat tick — repo=${REPO_DIR} dow=${now.getDay() || 7} hour=${now.getHours()}`);

const tasks = discoverTasks();
log(`discovered ${tasks.length} tasks`);

for (const task of tasks) {
  const skip = shouldRun(task, now, state);
  if (skip) {
    log(`${task.name}: skip (${skip})`);
  } else {
    log(`${task.name}: triggering`);
    runTask(task, state);
  }
}

log('heartbeat done');
