// Server-level checks for settings schema, role overrides, art routing, the spend cap and role batching.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server.mjs';
import * as D from '../db.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const opened = [];
after(async () => { for (const s of opened) await s.close().catch(() => {}); });

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-rt-'));
  const s = await startServer({ root, port: 0, stateDir: dir, memoryDir: path.join(dir, 'memory') });
  opened.push(s);
  const as = (tok) => async (method, p, body) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${p}`, { method, headers: { 'x-hq-token': tok, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  return { s, api: as(s.ownerToken), agent: as(s.token) };
}

test('settings schema route and the new keys', async () => {
  const { api } = await boot();
  const sc = await api('GET', '/api/settings/schema');
  assert.equal(sc.status, 200);
  assert.ok(sc.json.fields.some((f) => f.key === 'dailySpendCap') && sc.json.sections.length > 3);
  const all = (await api('GET', '/api/settings')).json;
  assert.equal(all.screenshotCap, 4);
  assert.equal(all.artAutoRoute, true);
  assert.equal((await api('POST', '/api/settings', { key: 'dailySpendCap', value: 20 })).json.value, 20);
  assert.equal((await api('POST', '/api/settings', { key: 'dailySpendCap', value: 'lots' })).status, 400);
  assert.equal((await api('POST', '/api/settings', { key: 'notebookDoc', value: 'https://example.com/doc' })).status, 400);
  assert.equal((await api('POST', '/api/settings', { key: 'theme', value: 'light' })).status, 200);
  // changing a knowledge folder rebuilds the knowledge object without breaking its routes
  const dir = path.join(os.tmpdir(), 'hq-no-such-vault');
  assert.equal((await api('POST', '/api/settings', { key: 'knowledgeLihfolk', value: dir })).status, 200);
  assert.equal((await api('GET', '/api/knowledge/status')).status, 200);
});

test('role overrides: merge, owner only, disabled role gives 409', async () => {
  const { api, agent } = await boot();
  const before = (await api('GET', '/api/roles')).json.find((r) => r.id === 'builder');
  assert.equal(before.enabled, true);
  assert.equal((await agent('POST', '/api/roles/builder', { enabled: false })).status, 403);
  const r = await api('POST', '/api/roles/builder', { extraRules: ['Always run stylua'], extraSkills: ['my:skill'] });
  assert.equal(r.status, 200);
  assert.equal(r.json.rules.at(-1), 'Always run stylua');
  assert.equal(r.json.skills.at(-1).name, 'my:skill');
  assert.equal((await api('POST', '/api/roles/builder', { extraSkills: ['bad skill'] })).status, 400);
  assert.equal((await api('POST', '/api/roles/ghost', {})).status, 404);
  const state = (await api('GET', '/api/state')).json;
  assert.equal(state.roles.find((x) => x.id === 'builder').override.extraRules[0], 'Always run stylua');
  await api('POST', '/api/roles/builder', { enabled: false });
  const t = await api('POST', '/api/tasks', { title: 'x', role: 'builder' });
  assert.equal(t.status, 409);
  assert.equal(t.json.error, 'Builder is turned off in Settings');
  assert.equal((await api('POST', '/api/tasks', { title: 'x', role: 'ui' })).status, 200);
  await api('POST', '/api/roles/builder', { enabled: true });
  assert.equal((await api('POST', '/api/tasks', { title: 'x', role: 'builder' })).status, 200);
});

test('art tasks route to antigravity unless the engine is named or routing is off', async () => {
  const { api } = await boot();
  const mk = (b) => api('POST', '/api/tasks', b).then((r) => r.json);
  assert.equal((await mk({ title: 'Make 3 thumbnails', role: 'ui' })).engine, 'antigravity');
  assert.equal((await mk({ title: 'new game icon', role: 'lead' })).engine, 'antigravity');
  assert.equal((await mk({ title: 'fix the server timer', role: 'ui' })).engine, 'app');
  assert.equal((await mk({ title: 'Make 3 thumbnails', role: 'ui', engine: 'app' })).engine, 'app');
  await api('POST', '/api/settings', { key: 'artAutoRoute', value: false });
  assert.equal((await mk({ title: 'Make 3 thumbnails', role: 'ui' })).engine, 'app');
});

test('the daily cap stops /api/tasks/next and pauses HQ with one message', async () => {
  const { s, api } = await boot();
  await api('POST', '/api/tasks', { title: 'next up', role: 'ui' });
  const done = D.createTask(s.db, { title: 'spent', role: 'builder' });
  D.updateTask(s.db, done.id, { state: 'done', startedAt: new Date().toISOString(), costUsd: 4 });
  await api('POST', '/api/settings', { key: 'dailySpendCap', value: 3 });
  assert.equal((await api('POST', '/api/tasks/next', { engine: 'app' })).json.task, null);
  assert.equal((await api('GET', '/api/settings')).json.paused, true);
  await api('POST', '/api/tasks/next', { engine: 'app' });
  const msgs = (await api('GET', '/api/messages?role=lead')).json;
  assert.equal((Array.isArray(msgs) ? msgs : msgs.messages ?? []).filter((m) => /Agents paused/.test(m.text)).length, 1);
  // owner resumes: the claim works again today
  await api('POST', '/api/resume');
  assert.ok((await api('POST', '/api/tasks/next', { engine: 'app' })).json.task);
});

test('claimNext prefers the given role, then falls back to the oldest', () => {
  const db = D.openDb(':memory:');
  const a = D.createTask(db, { title: 'a', role: 'builder' });
  const b = D.createTask(db, { title: 'b', role: 'ui' });
  const c = D.createTask(db, { title: 'c', role: 'ui' });
  assert.equal(D.claimNext(db, { engine: 'app', preferRole: 'ui' }).id, b.id);
  assert.equal(D.claimNext(db, { engine: 'app', preferRole: 'ui' }).id, c.id);
  assert.equal(D.claimNext(db, { engine: 'app', preferRole: 'ui' }).id, a.id);
  assert.equal(D.claimNext(db, { engine: 'app', preferRole: 'ui' }), null);
});
