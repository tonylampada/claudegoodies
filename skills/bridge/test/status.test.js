'use strict';
// Status model: worker lease via status.set, server-derived owed/unread,
// restart survival (leases and derivations live in persisted state, no timers).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, startServerWithColumns, runCli, sleep } = require('./helper');

async function cardStatus(s, id) {
  const r = await s.api('GET', '/api/cards/' + id);
  assert.strictEqual(r.status, 200);
  return r.body.status;
}

test('status.set validates worker shape, state, and ttl', async () => {
  const s = await startServerWithColumns();
  try {
    await s.api('POST', '/api/cards', { title: 'Task' });

    let r = await s.api('POST', '/api/cards/nope/status', { worker: { id: 'w1', state: 'working' } });
    assert.strictEqual(r.status, 404);
    r = await s.api('POST', '/api/cards/task/status', {});
    assert.strictEqual(r.status, 400); // worker required
    r = await s.api('POST', '/api/cards/task/status', { worker: 'working' });
    assert.strictEqual(r.status, 400); // worker must be an object (or null)
    r = await s.api('POST', '/api/cards/task/status', { worker: { id: 'w1', state: 'busy' } });
    assert.strictEqual(r.status, 400); // bad state rejected
    r = await s.api('POST', '/api/cards/task/status', { worker: { state: 'working' } });
    assert.strictEqual(r.status, 400); // id required for a linked state
    r = await s.api('POST', '/api/cards/task/status', { worker: { id: 'w1', state: 'working' }, ttl: 0 });
    assert.strictEqual(r.status, 400); // ttl must be > 0
    r = await s.api('POST', '/api/cards/task/status', { worker: { id: 'w1', state: 'working' }, ttl: -5 });
    assert.strictEqual(r.status, 400);

    r = await s.api('POST', '/api/cards/task/status', { worker: { id: 'w1', state: 'working' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.status.worker.id, 'w1');
    assert.strictEqual(r.body.status.worker.state, 'working');
  } finally {
    await s.stop();
  }
});

test('absent when no worker; state absent (or worker null) unlinks', async () => {
  const s = await startServerWithColumns();
  try {
    await s.api('POST', '/api/cards', { title: 'Bare' });
    let st = await cardStatus(s, 'bare');
    assert.deepStrictEqual(st, { worker: { id: null, state: 'absent' }, owed: false, unread: false });

    await s.api('POST', '/api/cards/bare/status', { worker: { id: 'w1', state: 'idle' } });
    st = await cardStatus(s, 'bare');
    assert.strictEqual(st.worker.state, 'idle');
    assert.strictEqual(st.worker.id, 'w1');

    await s.api('POST', '/api/cards/bare/status', { worker: { state: 'absent' } });
    st = await cardStatus(s, 'bare');
    assert.deepStrictEqual(st.worker, { id: null, state: 'absent' });

    await s.api('POST', '/api/cards/bare/status', { worker: { id: 'w1', state: 'working' } });
    await s.api('POST', '/api/cards/bare/status', { worker: null });
    st = await cardStatus(s, 'bare');
    assert.deepStrictEqual(st.worker, { id: null, state: 'absent' });
  } finally {
    await s.stop();
  }
});

test('working/needs-you lease decays to idle after its ttl; idle does not decay further', async () => {
  const s = await startServerWithColumns();
  try {
    await s.api('POST', '/api/cards', { title: 'Leased' });

    await s.api('POST', '/api/cards/leased/status', { worker: { id: 'w1', state: 'working' }, ttl: 0.3 });
    let st = await cardStatus(s, 'leased');
    assert.strictEqual(st.worker.state, 'working');
    await sleep(450);
    st = await cardStatus(s, 'leased');
    assert.strictEqual(st.worker.state, 'idle'); // honest "not currently working"
    assert.strictEqual(st.worker.id, 'w1'); // still linked

    await s.api('POST', '/api/cards/leased/status', { worker: { id: 'w1', state: 'needs-you' }, ttl: 0.3 });
    await sleep(450);
    st = await cardStatus(s, 'leased');
    assert.strictEqual(st.worker.state, 'idle');

    await s.api('POST', '/api/cards/leased/status', { worker: { id: 'w1', state: 'idle' }, ttl: 0.3 });
    await sleep(450);
    st = await cardStatus(s, 'leased');
    assert.strictEqual(st.worker.state, 'idle'); // idle is the decay floor, never absent
  } finally {
    await s.stop();
  }
});

test('lease survives a restart; expiry is derived on read, so decay happens even while down', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-test-'));
  let s = null;
  try {
    s = await startServerWithColumns({ dir });
    await s.api('POST', '/api/cards', { title: 'Task' });
    await s.api('POST', '/api/cards/task/status', { worker: { id: 'w1', state: 'working' }, ttl: 60 });
    await s.stop();

    s = await startServer({ dir }); // unexpired lease rides the board file
    let st = await cardStatus(s, 'task');
    assert.strictEqual(st.worker.state, 'working');

    await s.api('POST', '/api/cards/task/status', { worker: { id: 'w1', state: 'working' }, ttl: 0.2 });
    await s.stop();
    await sleep(350); // lease expires while the server is DOWN
    s = await startServer({ dir });
    st = await cardStatus(s, 'task');
    assert.strictEqual(st.worker.state, 'idle'); // decayed with no timer ever firing
    assert.strictEqual(st.worker.id, 'w1');
  } finally {
    if (s) await s.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('owed: flips true on a user thread message, false on agent reply, survives restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-test-'));
  let s = null;
  try {
    s = await startServerWithColumns({ dir });
    await s.api('POST', '/api/cards', { title: 'Ask' });
    assert.strictEqual((await cardStatus(s, 'ask')).owed, false);

    await s.api('POST', '/api/feedback', { target: 'card:ask', text: 'please check' });
    assert.strictEqual((await cardStatus(s, 'ask')).owed, true);

    await s.api('POST', '/api/message', { target: 'card:ask', text: 'on it' });
    assert.strictEqual((await cardStatus(s, 'ask')).owed, false);

    await s.api('POST', '/api/feedback', { target: 'card:ask', text: 'and this?' });
    assert.strictEqual((await cardStatus(s, 'ask')).owed, true);

    // the replaced in-memory indicator forgot this on restart; owed must not
    await s.stop();
    s = await startServer({ dir });
    assert.strictEqual((await cardStatus(s, 'ask')).owed, true);

    await s.api('POST', '/api/message', { target: 'card:ask', text: 'answered' });
    assert.strictEqual((await cardStatus(s, 'ask')).owed, false);
  } finally {
    if (s) await s.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('unread: level-1 event or agent reply sets it; reading the card clears it; survives restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-test-'));
  let s = null;
  const read = () => s.api('POST', '/api/read', { user: 'user', target: 'card:watch' });
  try {
    s = await startServerWithColumns({ dir });
    await s.api('POST', '/api/cards', { title: 'Watch' });
    assert.strictEqual((await cardStatus(s, 'watch')).unread, false);

    await s.api('POST', '/api/cards/watch/events', { text: 'quiet progress', level: 2 });
    assert.strictEqual((await cardStatus(s, 'watch')).unread, false); // level 2 never rings

    await s.api('POST', '/api/cards/watch/events', { text: 'needs eyes', level: 1 });
    assert.strictEqual((await cardStatus(s, 'watch')).unread, true);

    await read();
    await sleep(10);
    assert.strictEqual((await cardStatus(s, 'watch')).unread, false);

    await s.api('POST', '/api/message', { target: 'card:watch', text: 'done, take a look' });
    assert.strictEqual((await cardStatus(s, 'watch')).unread, true); // agent reply after last read

    // unread and its read marker are persisted state — a restart changes nothing
    await s.stop();
    s = await startServer({ dir });
    assert.strictEqual((await cardStatus(s, 'watch')).unread, true);

    await read();
    await sleep(10);
    assert.strictEqual((await cardStatus(s, 'watch')).unread, false);

    await s.api('POST', '/api/feedback', { target: 'card:watch', text: 'thanks' });
    const st = await cardStatus(s, 'watch');
    assert.strictEqual(st.unread, false); // the user's own message is never unread to them
    assert.strictEqual(st.owed, true);
  } finally {
    if (s) await s.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cli: bridge-axi status verb sets and reads the worker lease', async () => {
  const s = await startServerWithColumns();
  const env = { BRIDGE_DIR: s.dir };
  const portArgs = ['--port', String(s.port), '--board', s.board];
  try {
    await s.api('POST', '/api/cards', { title: 'CLI card' });

    let r = await runCli(['status', 'cli-card', 'working', '--worker', 'fix-1', ...portArgs], env);
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /worker=working\(fix-1\)/);
    assert.strictEqual((await cardStatus(s, 'cli-card')).worker.state, 'working');

    r = await runCli(['status', 'cli-card', ...portArgs], env); // read-back
    assert.match(r.stdout, /worker=working\(fix-1\) owed=false unread=false/);

    r = await runCli(['status', 'cli-card', 'working', ...portArgs], env); // missing --worker
    assert.strictEqual(r.code, 1);

    r = await runCli(['status', 'cli-card', 'bogus', '--worker', 'fix-1', ...portArgs], env);
    assert.strictEqual(r.code, 1); // server rejects bad state

    r = await runCli(['status', 'cli-card', 'absent', ...portArgs], env);
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /worker=absent/);

    r = await runCli(['status', ...portArgs], env); // bare status = server status, unchanged
    assert.match(r.stdout, /server: up/);
  } finally {
    await s.stop();
  }
});

// legacy-compat coverage: the v2 UI's awaiting/stale + attributes.worker inputs
// are now thin mappings from the status model; retire with the API cut.
test('legacy awaiting/stale are derived from owed and survive restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-test-'));
  const env = { BRIDGE_AWAITING_STALE_SECS: '1' };
  let s = null;
  try {
    s = await startServerWithColumns({ dir, env });
    await s.api('POST', '/api/cards', { title: 'Ask' });
    await s.api('POST', '/api/feedback', { target: 'chat', text: 'hello?' });
    await s.api('POST', '/api/feedback', { target: 'card:ask', text: 'and here?' });
    let st = (await s.api('GET', '/api/status')).body;
    assert.deepStrictEqual(st.awaiting.sort(), ['card:ask', 'chat']);
    assert.deepStrictEqual(st.stale, []);

    await s.stop();
    s = await startServer({ dir, env }); // the old in-memory Map lost these on restart
    st = (await s.api('GET', '/api/status')).body;
    assert.deepStrictEqual(st.awaiting.sort(), ['card:ask', 'chat']);

    await sleep(1100); // past the stale threshold, measured from the unanswered message
    st = (await s.api('GET', '/api/status')).body;
    assert.deepStrictEqual(st.stale.sort(), ['card:ask', 'chat']);

    await s.api('POST', '/api/message', { target: 'card:ask', text: 'here!' });
    st = (await s.api('GET', '/api/status')).body;
    assert.deepStrictEqual(st.awaiting, ['chat']);
  } finally {
    if (s) await s.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy attributes.worker view mirrors the lease; feeder-written attrs untouched without one', async () => {
  const s = await startServerWithColumns();
  try {
    // feeder path (no lease): attribute passes through as written
    await s.api('POST', '/api/cards', { title: 'Old' });
    await s.api('PATCH', '/api/cards/old', { attributes: { worker: 'needs-you' } });
    let b = (await s.api('GET', '/api/board')).body;
    assert.strictEqual(b.cards.find((c) => c.id === 'old').attributes.worker, 'needs-you');

    // lease path: the derived state (including decay) overrides the view
    await s.api('POST', '/api/cards', { title: 'New' });
    await s.api('POST', '/api/cards/new/status', { worker: { id: 'w1', state: 'working' }, ttl: 0.3 });
    b = (await s.api('GET', '/api/board')).body;
    assert.strictEqual(b.cards.find((c) => c.id === 'new').attributes.worker, 'working');
    await sleep(450);
    b = (await s.api('GET', '/api/board')).body;
    assert.strictEqual(b.cards.find((c) => c.id === 'new').attributes.worker, 'idle');

    await s.api('POST', '/api/cards/new/status', { worker: null });
    b = (await s.api('GET', '/api/board')).body;
    assert.strictEqual('worker' in b.cards.find((c) => c.id === 'new').attributes, false);
  } finally {
    await s.stop();
  }
});
