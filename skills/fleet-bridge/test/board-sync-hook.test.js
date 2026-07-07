'use strict';
// fm-board-sync-hook: the push-triggered fast path onto the board. Firstmate's
// generic event hook (config/event-hook) invokes this script directly, passing
// FM_EVENT_HOME - it must forward to the SAME fm-board-sync sync logic the
// poll shim already calls, doing nothing of its own. Covers: it runs the sync
// (a card is born from live evidence with no poll involved), it is a safe
// no-op with FM_EVENT_HOME unset, and it never lets a sync failure (bad port,
// unreachable server) escape as a nonzero exit - the caller (fm-event-lib.sh)
// must never see this as a failed hook.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { startServer } = require('../../bridge/test/helper.js');
const fx = require('./fixture.js');

const execFileP = promisify(execFile);
const HOOK = path.join(__dirname, '..', 'fm-board-sync-hook');

function runHook(env) {
  return execFileP(HOOK, [], { env: Object.assign({}, process.env, env) })
    .then((r) => ({ code: 0, ...r }))
    .catch((e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
}

test('fm-board-sync-hook runs the real sync and births a card from live evidence', async () => {
  const s = await startServer();
  const home = fx.makeHome();
  try {
    fx.writeBacklog(home, { inflight: [
      'push-demo-p1 - Prove the push path works end-to-end (repo: demo-app, since 2026-07-06)',
    ] });
    fx.writeMeta(home, 'push-demo-p1', ['window=fm-push-demo-p1', 'project=projects/demo-app', 'kind=ship']);

    const r = await runHook({
      FM_EVENT_HOME: home,
      FM_EVENT_TYPE: 'pr-check',
      FM_EVENT_TASK_ID: 'push-demo-p1',
      FM_BOARD_SYNC_BOARD: s.board,
      FM_BOARD_SYNC_PORT: String(s.port),
    });
    assert.strictEqual(r.code, 0, 'hook must exit 0: ' + r.stderr);

    const card = await fx.getCard(s, 'push-demo-p1');
    assert.strictEqual(card.column, 'working', 'card should be born straight into working');
    assert.strictEqual(card.attributes.repo, 'demo-app');
  } finally {
    fx.rmHome(home);
    await s.stop();
  }
});

test('fm-board-sync-hook is a no-op with FM_EVENT_HOME unset (never invents a sync target)', async () => {
  const r = await runHook({ FM_EVENT_HOME: '' });
  assert.strictEqual(r.code, 0, 'hook must still exit 0: ' + r.stderr);
});

test('fm-board-sync-hook swallows a sync failure (unreachable server) rather than propagating it', async () => {
  const home = fx.makeHome();
  try {
    fx.writeBacklog(home, { inflight: [] });
    const r = await runHook({
      FM_EVENT_HOME: home,
      FM_BOARD_SYNC_BOARD: 'fleet',
      // A port nothing listens on: the underlying sync call fails, the hook
      // must not surface that failure to its own caller.
      FM_BOARD_SYNC_PORT: '1',
    });
    assert.strictEqual(r.code, 0, 'a failed sync must not fail the hook itself: ' + r.stderr);
  } finally {
    fx.rmHome(home);
  }
});
