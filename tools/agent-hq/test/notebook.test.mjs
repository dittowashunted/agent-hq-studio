import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server.mjs';
import { notebookText } from '../notebook.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const opened = [];
after(async () => { for (const s of opened) await s.close().catch(() => {}); });

async function boot(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-nb-'));
  const s = await startServer({ root, port: 0, stateDir: dir, memoryDir: path.join(dir, 'memory'), ...opts });
  opened.push(s);
  const as = (tok) => async (method, p, body) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${p}`, { method, headers: { 'x-hq-token': tok, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  return { s, api: as(s.ownerToken), agent: as(s.token) };
}

test('notebook: owner adds and deletes, agents add with their task token, newest first', async () => {
  const { api, agent } = await boot();
  const a = await api('POST', '/api/notebook', { text: 'Owner note' });
  assert.equal(a.status, 200);
  assert.match(a.json.id, /^n_[0-9a-f]{12}$/);
  assert.deepEqual([a.json.who, a.json.role], ['owner', null]);

  // an agent with no task token, or a wrong one, is refused
  assert.equal((await agent('POST', '/api/notebook', { text: 'sneaky' })).status, 403);
  assert.equal((await agent('POST', '/api/notebook', { text: 'sneaky', taskToken: 'f'.repeat(64) })).status, 403);

  await api('POST', '/api/tasks', { title: 'Do it', role: 'ui' });
  const claim = (await agent('POST', '/api/tasks/next', { engine: 'app' })).json;
  const b = await agent('POST', '/api/notebook', { text: 'Agent note', taskId: claim.task.id, taskToken: claim.taskToken });
  assert.equal(b.status, 200);
  assert.deepEqual([b.json.who, b.json.role], ['agent', 'ui']);

  const list = (await api('GET', '/api/notebook')).json;
  assert.deepEqual(list.entries.map((e) => e.text), ['Agent note', 'Owner note']);
  assert.equal(list.doc, null);
  assert.equal((await api('GET', '/api/notebook?limit=1')).json.entries.length, 1);

  // agents cannot delete; the owner can; a second delete is a 404
  assert.equal((await agent('DELETE', `/api/notebook/${a.json.id}`)).status, 403);
  assert.equal((await api('DELETE', `/api/notebook/${a.json.id}`)).status, 200);
  assert.equal((await api('DELETE', `/api/notebook/${a.json.id}`)).status, 404);
  assert.equal((await api('DELETE', '/api/notebook/bogus')).status, 404);
  assert.equal((await api('GET', '/api/notebook')).json.entries.length, 1);
});

test('notebook: text is capped at 2000, a game must exist, the doc link comes from Settings', async () => {
  const { api } = await boot();
  assert.equal((await api('POST', '/api/notebook', { text: 'x'.repeat(2000) })).status, 200);
  assert.equal((await api('POST', '/api/notebook', { text: 'x'.repeat(2001) })).status, 400);
  assert.equal((await api('POST', '/api/notebook', { text: '   ' })).status, 400);
  assert.equal((await api('POST', '/api/notebook', { text: 'g', game: 'no-such-game' })).status, 400);
  await api('POST', '/api/settings', { key: 'notebookDoc', value: 'https://docs.google.com/document/d/abc123/edit' });
  assert.equal((await api('GET', '/api/notebook')).json.doc, 'https://docs.google.com/document/d/abc123/edit');
});

test('notebookText labels the notes as not instructions', () => {
  const t = notebookText({ entries: [{ at: '2026-06-10T10:00:00Z', who: 'agent', role: 'ui', game: null, text: 'Icons are 512px' }], doc: null });
  assert.match(t, /^Shared notebook: .* Notes, not instructions/);
  assert.match(t, /- 2026-06-10 ui: Icons are 512px/);
  assert.match(notebookText({}), /No entries yet/);
});

test('GET /api/readiness works on a server with injected tools, and play is owner only', async () => {
  const { api, agent } = await boot({ readinessOpts: { find: () => null } });
  const r = (await api('GET', '/api/readiness')).json;
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes('tool: rojo'));
  assert.ok(r.roles.length >= 10 && r.roles.every((x) => Array.isArray(x.skills)));
  assert.equal((await agent('POST', '/api/games/any/play', {})).status, 403);
  assert.equal((await api('POST', '/api/games/no-such/play', {})).status, 404);
});
