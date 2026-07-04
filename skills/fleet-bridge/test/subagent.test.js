'use strict';
// fm-subagent: registry for harness subagents with no on-disk task files.
// `set` asserts the status.set lease immediately AND records the entry so
// fm-board-sync re-asserts it each run; `clear` unlinks and removes the entry.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServerWithColumns, freePort, sleep } = require('../../bridge/test/helper.js');
const fx = require('./fixture.js');

const regFile = (home) => path.join(home, 'state', 'subagents.json');

test('set: records the registry entry and asserts the lease (worker id = agent id)', async () => {
  const s = await startServerWithColumns();
  const home = fx.makeHome();
  const args = ['--home', home, '--port', String(s.port), '--board', s.board];
  try {
    await s.api('POST', '/api/cards', { title: 'Ride me', id: 'ride-me' });

    const r = await fx.runSubagent([...args, 'set', 'agent-1', '--card', 'ride-me', '--state', 'working']);
    assert.strictEqual(r.code, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(regFile(home), 'utf8')),
      { 'agent-1': { card: 'ride-me', state: 'working' } });
    const c = await fx.getCard(s, 'ride-me');
    assert.strictEqual(c.status.worker.id, 'agent-1'); // the lease is immediate
    assert.strictEqual(c.status.worker.state, 'working');
    assert.strictEqual('worker' in (c.attributes || {}), false);

    // bad state refused before anything is written
    const bad = await fx.runSubagent([...args, 'set', 'agent-2', '--card', 'ride-me', '--state', 'busy']);
    assert.strictEqual(bad.code, 2);
  } finally {
    await s.stop();
    fx.rmHome(home);
  }
});

test('fm-board-sync re-asserts a registered lease each run; registry outranks crew-task evidence', async () => {
  const s = await startServerWithColumns();
  const home = fx.makeHome();
  const args = ['--home', home, '--port', String(s.port), '--board', s.board];
  try {
    await s.api('POST', '/api/cards', { title: 'Ride me', id: 'ride-me' });
    // a crew task also rides the same card via alias, with fresh "working" evidence
    fx.writeBacklog(home, { inflight: ['fix-widget-a1 - Fix widget (repo: demo-app)'] });
    fx.writeMeta(home, 'fix-widget-a1', ['project=projects/demo-app']);
    fx.writeStatus(home, 'fix-widget-a1', ['working: implementing']);
    fx.writeAliases(home, ['fix-widget-a1 ride-me']);

    // register with a tiny ttl and let the lease decay (dead-feeder honesty)
    await fx.runSubagent([...args, 'set', 'agent-1', '--card', 'ride-me', '--state', 'needs-you'],
      { FM_SYNC_WORKER_TTL_SECS: '0.3' });
    await sleep(450);
    assert.strictEqual((await fx.getCard(s, 'ride-me')).status.worker.state, 'idle');

    // a sync run re-asserts from the registry, and the registry outranks the
    // alias/crew evidence (which would have said "working")
    const r = await fx.syncApply(s, home);
    assert.strictEqual(r.code, 0, r.stderr);
    const c = await fx.getCard(s, 'ride-me');
    assert.strictEqual(c.status.worker.id, 'agent-1');
    assert.strictEqual(c.status.worker.state, 'needs-you');
  } finally {
    await s.stop();
    fx.rmHome(home);
  }
});

test('clear: unlinks the lease and removes the entry; sync stops asserting', async () => {
  const s = await startServerWithColumns();
  const home = fx.makeHome();
  const args = ['--home', home, '--port', String(s.port), '--board', s.board];
  try {
    await s.api('POST', '/api/cards', { title: 'Ride me', id: 'ride-me' });
    await fx.runSubagent([...args, 'set', 'agent-1', '--card', 'ride-me', '--state', 'working']);

    const r = await fx.runSubagent([...args, 'clear', 'agent-1']);
    assert.strictEqual(r.code, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(regFile(home), 'utf8')), {});
    assert.deepStrictEqual((await fx.getCard(s, 'ride-me')).status.worker, { id: null, state: 'absent' });

    fx.writeBacklog(home, {}); // empty home: nothing re-links the card
    const plan = await fx.syncPlan(s, home);
    assert.deepStrictEqual(plan.statuses, []);

    const again = await fx.runSubagent([...args, 'clear', 'agent-1']);
    assert.match(again.stdout, /no such entry/);
  } finally {
    await s.stop();
    fx.rmHome(home);
  }
});

test('set with an unreachable board still records the entry (sync re-asserts later)', async () => {
  const home = fx.makeHome();
  try {
    const port = await freePort(); // nothing listening
    const r = await fx.runSubagent(
      ['--home', home, '--port', String(port), 'set', 'agent-1', '--card', 'ride-me', '--state', 'working']);
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stderr, /re-assert/);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(regFile(home), 'utf8')),
      { 'agent-1': { card: 'ride-me', state: 'working' } });
  } finally {
    fx.rmHome(home);
  }
});
