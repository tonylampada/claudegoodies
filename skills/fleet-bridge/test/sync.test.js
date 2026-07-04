'use strict';
// fm-board-sync: evidence-based Loop B feeder — status.set worker leases,
// prs/artifacts card.patch, event.append dedupe, card.archive(merged), and
// never card.move. Fixture homes are neutral temp dirs; the server is the
// ephemeral bridge from skills/bridge/test/helper.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, sleep } = require('../../bridge/test/helper.js');
const fx = require('./fixture.js');

// The feeder's own canonical frame (pushed by every --apply run); used to
// pre-create cards that must exist before the feeder runs.
const FRAME = [
  { id: 'ideas', title: '💡 Ideas' },
  { id: 'working', title: '🔨 Working' },
  { id: 'review', title: '👀 Your review' },
  { id: 'peer', title: '🤝 Peer review' },
];

test('card birth: in-flight work born in working with type/repo/owner, seed body, evidence lease', async () => {
  const s = await startServer();
  const home = fx.makeHome();
  try {
    fx.writeBacklog(home, { inflight: [
      'fix-widget-a1 - Fix widget rendering (repo: demo-app, since 2026-06-01)',
      'probe-cache-c3 - Find why the cache misses (repo: demo-app, since 2026-06-02)',
    ] });
    fx.writeMeta(home, 'fix-widget-a1', ['window=fm-fix-widget-a1', 'project=projects/demo-app', 'kind=ship']);
    fx.writeMeta(home, 'probe-cache-c3', ['window=fm-probe-cache-c3', 'project=projects/demo-app', 'kind=scout']);
    fx.writeStatus(home, 'fix-widget-a1', ['working: implementing']);

    const r = await fx.syncApply(s, home);
    assert.strictEqual(r.code, 0, r.stderr);

    const board = (await s.api('GET', '/api/board')).body;
    assert.deepStrictEqual(board.columns.map((c) => c.id), ['ideas', 'working', 'review', 'peer']);

    const ship = await fx.getCard(s, 'fix-widget-a1');
    assert.strictEqual(ship.column, 'working');
    assert.strictEqual(ship.title, 'Fix widget rendering');
    assert.strictEqual(ship.body, 'Fix widget rendering (demo-app)');
    assert.strictEqual(ship.attributes.type, 'implementation');
    assert.strictEqual(ship.attributes.repo, 'demo-app');
    assert.strictEqual(ship.attributes.owner, 'firstmate');
    // the lease is status.set, never an attribute
    assert.strictEqual('worker' in ship.attributes, false);
    assert.strictEqual(ship.status.worker.id, 'fix-widget-a1');
    assert.strictEqual(ship.status.worker.state, 'working'); // fresh status mtime = evidence

    const scout = await fx.getCard(s, 'probe-cache-c3');
    assert.strictEqual(scout.attributes.type, 'investigation');
    assert.strictEqual(scout.status.worker.state, 'idle'); // meta alive, no fresh files
  } finally {
    await s.stop();
    fx.rmHome(home);
  }
});

test('evidence policy: needs-you outranks activity; freshness window is env-tunable', async () => {
  const s = await startServer();
  const home = fx.makeHome();
  try {
    fx.writeBacklog(home, { inflight: ['fix-widget-a1 - Fix widget (repo: demo-app)'] });
    fx.writeMeta(home, 'fix-widget-a1', ['project=projects/demo-app']);

    // last status line needs-decision: -> needs-you even with a fresh mtime
    fx.writeStatus(home, 'fix-widget-a1', ['working: setup', 'needs-decision: pick auth provider']);
    await fx.syncApply(s, home);
    assert.strictEqual((await fx.getCard(s, 'fix-widget-a1')).status.worker.state, 'needs-you');

    // stale activity -> idle
    fx.writeStatus(home, 'fix-widget-a1', ['working: still at it']);
    fx.backdate(path.join(home, 'state', 'fix-widget-a1.status'), 3600);
    await fx.syncApply(s, home);
    assert.strictEqual((await fx.getCard(s, 'fix-widget-a1')).status.worker.state, 'idle');

    // widening the window makes the same hour-old evidence count as working
    await fx.syncApply(s, home, { FM_SYNC_FRESH_SECS: '7200' });
    assert.strictEqual((await fx.getCard(s, 'fix-widget-a1')).status.worker.state, 'working');

    // a fresh turn-ended marker alone is working evidence too
    fx.backdate(path.join(home, 'state', 'fix-widget-a1.status'), 3600);
    fx.touchTurnEnded(home, 'fix-widget-a1');
    await fx.syncApply(s, home);
    assert.strictEqual((await fx.getCard(s, 'fix-widget-a1')).status.worker.state, 'working');
  } finally {
    await s.stop();
    fx.rmHome(home);
  }
});

test('teardown: meta gone -> one unlink to absent, then the feeder stops asserting', async () => {
  const s = await startServer();
  const home = fx.makeHome();
  try {
    fx.writeBacklog(home, { inflight: ['fix-widget-a1 - Fix widget (repo: demo-app)'] });
    fx.writeMeta(home, 'fix-widget-a1', ['project=projects/demo-app']);
    fx.writeStatus(home, 'fix-widget-a1', ['working: implementing']);
    await fx.syncApply(s, home);
    assert.strictEqual((await fx.getCard(s, 'fix-widget-a1')).status.worker.state, 'working');

    // torn down: meta removed, task no longer in flight (scout-style Done entry)
    fx.rmMeta(home, 'fix-widget-a1');
    fx.writeBacklog(home, { done: ['fix-widget-a1 - Fix widget - data/fix-widget-a1/report.md (reported 2026-07-01)'] });
    await fx.syncApply(s, home);
    const c = await fx.getCard(s, 'fix-widget-a1');
    assert.deepStrictEqual(c.status.worker, { id: null, state: 'absent' });

    // already unlinked: nothing left to assert
    const plan = await fx.syncPlan(s, home);
    assert.deepStrictEqual(plan.statuses, []);
  } finally {
    await s.stop();
    fx.rmHome(home);
  }
});

test('lease ttl: env-tunable, re-asserted each run, decays honestly when the feeder dies', async () => {
  const s = await startServer();
  const home = fx.makeHome();
  try {
    fx.writeBacklog(home, { inflight: ['fix-widget-a1 - Fix widget (repo: demo-app)'] });
    fx.writeMeta(home, 'fix-widget-a1', ['project=projects/demo-app']);
    fx.writeStatus(home, 'fix-widget-a1', ['working: implementing']);

    await fx.syncApply(s, home, { FM_SYNC_WORKER_TTL_SECS: '0.3' });
    assert.strictEqual((await fx.getCard(s, 'fix-widget-a1')).status.worker.state, 'working');
    await sleep(450); // no re-assert (dead feeder): server decays the lease
    assert.strictEqual((await fx.getCard(s, 'fix-widget-a1')).status.worker.state, 'idle');

    await fx.syncApply(s, home, { FM_SYNC_WORKER_TTL_SECS: '0.3' }); // re-assert revives it
    assert.strictEqual((await fx.getCard(s, 'fix-widget-a1')).status.worker.state, 'working');
  } finally {
    await s.stop();
    fx.rmHome(home);
  }
});

test('no attributes.worker is ever written; leases ride the statuses plan', async () => {
  const s = await startServer();
  const home = fx.makeHome();
  try {
    fx.writeBacklog(home, { inflight: ['fix-widget-a1 - Fix widget (repo: demo-app)'] });
    fx.writeMeta(home, 'fix-widget-a1', ['project=projects/demo-app', 'pr=https://github.com/acme/demo-app/pull/7']);
    fx.writeStatus(home, 'fix-widget-a1', ['working: implementing']);

    const plan = await fx.syncPlan(s, home);
    assert.ok(!JSON.stringify(plan.creates).includes('"worker"'), 'creates carry no worker attribute');
    assert.ok(!JSON.stringify(plan.attrs).includes('"worker"'), 'attr patches carry no worker key');
    assert.deepStrictEqual(plan.statuses, [
      { card: 'fix-widget-a1', worker: { id: 'fix-widget-a1', state: 'working' } },
    ]);
    assert.strictEqual('moves' in plan, false); // invariant 3: no move op exists

    await fx.syncApply(s, home);
    await fx.syncApply(s, home);
    const c = await fx.getCard(s, 'fix-widget-a1');
    assert.strictEqual('worker' in c.attributes, false);
  } finally {
    await s.stop();
    fx.rmHome(home);
  }
});

test('prs list: {url, state} entries from meta; PR opened event at level 2', async () => {
  const s = await startServer();
  const home = fx.makeHome();
  const url = 'https://github.com/acme/demo-app/pull/7';
  try {
    fx.writeBacklog(home, { inflight: ['fix-widget-a1 - Fix widget (repo: demo-app)'] });
    fx.writeMeta(home, 'fix-widget-a1', ['project=projects/demo-app', 'pr=' + url]);
    await fx.syncApply(s, home);

    const c = await fx.getCard(s, 'fix-widget-a1');
    assert.deepStrictEqual(c.attributes.prs, [{ url, state: 'open' }]);
    assert.strictEqual('pr' in c.attributes, false);
    assert.strictEqual('pr_state' in c.attributes, false);
    const ev = c.events.find((e) => e.text === 'PR opened: ' + url);
    assert.ok(ev, 'PR opened event exists');
    assert.strictEqual(ev.level, 2);
  } finally {
    await s.stop();
    fx.rmHome(home);
  }
});

test('migration: old pr/pr_state attributes fold into prs and are deleted', async () => {
  const s = await startServer();
  const home = fx.makeHome();
  const urlA = 'https://github.com/acme/demo-app/pull/3';
  const urlB = 'https://github.com/acme/demo-app/pull/8';
  const urlC = 'https://github.com/acme/demo-app/pull/5';
  try {
    await s.api('PUT', '/api/columns', FRAME);
    // a live-task card still carrying the old shape
    await s.api('POST', '/api/cards', {
      id: 'fix-widget-a1', title: 'Fix widget', column: 'working',
      attributes: { type: 'implementation', owner: 'firstmate', pr: urlA, pr_state: 'open' },
    });
    // a parked card with no live task (migration sweep path)
    await s.api('POST', '/api/cards', {
      id: 'old-work-z9', title: 'Old work', column: 'review',
      attributes: { type: 'implementation', owner: 'firstmate', pr: urlC, pr_state: 'merged' },
    });

    fx.writeBacklog(home, { inflight: ['fix-widget-a1 - Fix widget (repo: demo-app)'] });
    fx.writeMeta(home, 'fix-widget-a1', ['project=projects/demo-app', 'pr=' + urlB]);
    await fx.syncApply(s, home);

    const live = await fx.getCard(s, 'fix-widget-a1');
    assert.deepStrictEqual(live.attributes.prs, [
      { url: urlA, state: 'open' },
      { url: urlB, state: 'open' },
    ]);
    assert.strictEqual('pr' in live.attributes, false);
    assert.strictEqual('pr_state' in live.attributes, false);

    const parked = await fx.getCard(s, 'old-work-z9');
    assert.deepStrictEqual(parked.attributes.prs, [{ url: urlC, state: 'merged' }]);
    assert.strictEqual('pr' in parked.attributes, false);
    assert.strictEqual('pr_state' in parked.attributes, false);
    assert.strictEqual(parked.column, 'review'); // untouched otherwise
  } finally {
    await s.stop();
    fx.rmHome(home);
  }
});

test('artifacts: worker brief attached at birth as {uri, label}', async () => {
  const s = await startServer();
  const home = fx.makeHome();
  try {
    fx.writeBacklog(home, { inflight: ['fix-widget-a1 - Fix widget (repo: demo-app)'] });
    fx.writeMeta(home, 'fix-widget-a1', ['project=projects/demo-app']);
    const brief = fx.writeBrief(home, 'fix-widget-a1');
    await fx.syncApply(s, home);

    const c = await fx.getCard(s, 'fix-widget-a1');
    assert.deepStrictEqual(c.attributes.artifacts, [{ uri: 'file://' + brief, label: 'worker brief' }]);

    await fx.syncApply(s, home); // idempotent: no duplicate entry
    assert.strictEqual((await fx.getCard(s, 'fix-widget-a1')).attributes.artifacts.length, 1);
  } finally {
    await s.stop();
    fx.rmHome(home);
  }
});

test('alias card: artifacts append (never overwrite), lease rides it, column never moves', async () => {
  const s = await startServer();
  const home = fx.makeHome();
  try {
    await s.api('PUT', '/api/columns', FRAME);
    await s.api('POST', '/api/cards', {
      id: 'captain-card', title: 'Improve widgets', column: 'ideas', actor: 'user',
      attributes: { type: 'plan', owner: 'firstmate', artifacts: [{ uri: 'file:///shared/spec.md', label: 'spec' }] },
    });

    fx.writeBacklog(home, { inflight: ['fix-widget-a1 - Fix widget (repo: demo-app)'] });
    fx.writeMeta(home, 'fix-widget-a1', ['project=projects/demo-app']);
    fx.writeStatus(home, 'fix-widget-a1', ['working: implementing']);
    const brief = fx.writeBrief(home, 'fix-widget-a1');
    fx.writeAliases(home, ['fix-widget-a1 captain-card']);
    await fx.syncApply(s, home);

    const c = await fx.getCard(s, 'captain-card');
    // existing artifacts kept, missing entry appended
    assert.deepStrictEqual(c.attributes.artifacts, [
      { uri: 'file:///shared/spec.md', label: 'spec' },
      { uri: 'file://' + brief, label: 'worker brief' },
    ]);
    // the task's evidence lease landed on the aliased card
    assert.deepStrictEqual(
      { id: c.status.worker.id, state: c.status.worker.state },
      { id: 'fix-widget-a1', state: 'working' });
    // invariant 3: sync feeds, never moves — the captain's card stays in ideas
    assert.strictEqual(c.column, 'ideas');
    assert.strictEqual(c.events.filter((e) => e.kind === 'handoff').length, 0);
    // no duplicate card was minted for the aliased task
    assert.strictEqual((await s.api('GET', '/api/cards/fix-widget-a1')).status, 404);
  } finally {
    await s.stop();
    fx.rmHome(home);
  }
});

test('archive: Done verb merged -> card.archive(reason merged), prs marked merged in the snapshot', async () => {
  const s = await startServer();
  const home = fx.makeHome();
  const url = 'https://github.com/acme/demo-app/pull/9';
  try {
    // born live first
    fx.writeBacklog(home, { inflight: ['ship-gadget-b2 - Ship gadget (repo: demo-app)'] });
    fx.writeMeta(home, 'ship-gadget-b2', ['project=projects/demo-app', 'pr=' + url]);
    await fx.syncApply(s, home);
    assert.deepStrictEqual((await fx.getCard(s, 'ship-gadget-b2')).attributes.prs, [{ url, state: 'open' }]);

    // merged: task leaves the backlog for Done
    fx.rmMeta(home, 'ship-gadget-b2');
    fx.writeBacklog(home, { done: ['ship-gadget-b2 - Ship gadget - ' + url + ' (merged 2026-07-01)'] });
    await fx.syncApply(s, home);

    const board = (await s.api('GET', '/api/board')).body;
    assert.strictEqual(board.cards.length, 0); // off the board
    const recs = fs.readFileSync(path.join(s.dir, 'boards', s.board + '.archive.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.strictEqual(recs.length, 1);
    assert.strictEqual(recs[0].reason, 'merged'); // the enum, sent explicitly
    assert.deepStrictEqual(recs[0].card.attributes.prs, [{ url, state: 'merged' }]);

    // a second run archives nothing (card already gone)
    const plan = await fx.syncPlan(s, home);
    assert.deepStrictEqual(plan.archives, []);
  } finally {
    await s.stop();
    fx.rmHome(home);
  }
});

test('resurrection: killed card + live evidence -> card.restore with history, not a blank rebirth', async () => {
  const s = await startServer();
  const home = fx.makeHome();
  try {
    fx.writeBacklog(home, { inflight: ['fix-widget-a1 - Fix widget rendering (repo: demo-app)'] });
    fx.writeMeta(home, 'fix-widget-a1', ['project=projects/demo-app', 'kind=ship']);
    fx.writeStatus(home, 'fix-widget-a1', ['working: implementing']);
    await fx.syncApply(s, home);
    const born = await fx.getCard(s, 'fix-widget-a1');

    // the captain kills the card by mistake; the task keeps running
    await s.api('POST', '/api/cards/fix-widget-a1/archive', { reason: 'killed', actor: 'user' });
    assert.strictEqual((await s.api('GET', '/api/cards/fix-widget-a1')).status, 404);

    const plan = await fx.syncPlan(s, home);
    assert.deepStrictEqual(plan.creates, []); // the blank re-birth path is dead
    assert.deepStrictEqual(plan.restores, [
      { card: 'fix-widget-a1', text: 'resurrected — work is still running' },
    ]);

    const r = await fx.syncApply(s, home);
    assert.strictEqual(r.code, 0, r.stderr);
    const c = await fx.getCard(s, 'fix-widget-a1');
    // frozen history intact — not blank
    assert.strictEqual(c.title, born.title);
    assert.strictEqual(c.body, born.body);
    assert.deepStrictEqual(c.attributes.type, 'implementation');
    assert.ok(c.events.some((e) => e.text === 'working: implementing'), 'old timeline survives');
    // the loud level-1 resurrection event, exactly once (dedupe holds across runs)
    await fx.syncApply(s, home);
    const res = (await fx.getCard(s, 'fix-widget-a1')).events
      .filter((e) => e.text === 'resurrected — work is still running');
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].level, 1);
    // the evidence lease is re-asserted on the restored card
    assert.strictEqual(c.status.worker.state, 'working');
    // the kill record remains in the append-only archive log
    const recs = fs.readFileSync(path.join(s.dir, 'boards', s.board + '.archive.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.strictEqual(recs.length, 1);
    assert.strictEqual(recs[0].reason, 'killed');
  } finally {
    await s.stop();
    fx.rmHome(home);
  }
});

test('resurrection: archived id with no live evidence stays archived; fresh work still births', async () => {
  const s = await startServer();
  const home = fx.makeHome();
  try {
    fx.writeBacklog(home, { inflight: ['old-task-z9 - Old task (repo: demo-app)'] });
    fx.writeMeta(home, 'old-task-z9', ['project=projects/demo-app']);
    await fx.syncApply(s, home);
    await s.api('POST', '/api/cards/old-task-z9/archive', { reason: 'killed', actor: 'user' });

    // the old task is gone (no meta, not in flight); a never-archived task appears
    fx.rmMeta(home, 'old-task-z9');
    fx.writeBacklog(home, { inflight: ['new-task-b2 - New task (repo: demo-app)'] });
    fx.writeMeta(home, 'new-task-b2', ['project=projects/demo-app']);

    const plan = await fx.syncPlan(s, home);
    assert.deepStrictEqual(plan.restores, []); // no evidence, no resurrection
    assert.deepStrictEqual(plan.creates.map((c) => c.id), ['new-task-b2']); // birth still works

    await fx.syncApply(s, home);
    assert.strictEqual((await s.api('GET', '/api/cards/old-task-z9')).status, 404); // rests in peace
    assert.strictEqual((await s.api('GET', '/api/cards/new-task-b2')).status, 200);
  } finally {
    await s.stop();
    fx.rmHome(home);
  }
});

test('resurrection: an archived alias target is restored when its task shows live evidence', async () => {
  const s = await startServer();
  const home = fx.makeHome();
  try {
    await s.api('PUT', '/api/columns', FRAME);
    await s.api('POST', '/api/cards', {
      id: 'captain-card', title: 'Improve widgets', column: 'ideas', actor: 'user',
      attributes: { type: 'plan', owner: 'firstmate' },
    });
    await s.api('POST', '/api/cards/captain-card/archive', { reason: 'killed', actor: 'user' });

    // an alias explicitly links live work to the killed card
    fx.writeBacklog(home, { inflight: ['fix-widget-a1 - Fix widget (repo: demo-app)'] });
    fx.writeMeta(home, 'fix-widget-a1', ['project=projects/demo-app']);
    fx.writeStatus(home, 'fix-widget-a1', ['working: implementing']);
    fx.writeAliases(home, ['fix-widget-a1 captain-card']);
    await fx.syncApply(s, home);

    const c = await fx.getCard(s, 'captain-card');
    assert.strictEqual(c.title, 'Improve widgets'); // frozen state, not a re-mint
    assert.strictEqual(c.column, 'ideas'); // column as frozen: sync still never moves
    assert.ok(c.events.some((e) => e.text === 'resurrected — work is still running'));
    assert.strictEqual(c.status.worker.id, 'fix-widget-a1'); // the lease rides the restored card
    assert.strictEqual((await s.api('GET', '/api/cards/fix-widget-a1')).status, 404); // no duplicate mint
  } finally {
    await s.stop();
    fx.rmHome(home);
  }
});

test('events: deduped by exact text across runs; captain-relevant verbs are level 1', async () => {
  const s = await startServer();
  const home = fx.makeHome();
  try {
    fx.writeBacklog(home, { inflight: ['fix-widget-a1 - Fix widget (repo: demo-app)'] });
    fx.writeMeta(home, 'fix-widget-a1', ['project=projects/demo-app']);
    fx.writeStatus(home, 'fix-widget-a1', [
      'working: setup done',
      'needs-decision: pick auth provider',
      'done: PR https://github.com/acme/demo-app/pull/7 checks green',
    ]);
    await fx.syncApply(s, home);
    await fx.syncApply(s, home); // second run must add nothing

    const c = await fx.getCard(s, 'fix-widget-a1');
    const texts = c.events.map((e) => e.text);
    for (const t of ['working: setup done', 'needs-decision: pick auth provider']) {
      assert.strictEqual(texts.filter((x) => x === t).length, 1, t + ' appears once');
    }
    const done = c.events.find((e) => /^done:/.test(e.text));
    assert.strictEqual(done.level, 1);
    assert.strictEqual(done.kind, 'success');
    const decision = c.events.find((e) => /^needs-decision:/.test(e.text));
    assert.strictEqual(decision.level, 1);
    assert.strictEqual(decision.kind, 'question');
    assert.strictEqual(c.events.find((e) => /^working:/.test(e.text)).level, 2);
  } finally {
    await s.stop();
    fx.rmHome(home);
  }
});
