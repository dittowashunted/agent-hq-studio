import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server.mjs';
import { buildBrief } from '../briefs.mjs';
import { addPrefs, readPrefs, deletePref, prefsFor, cleanItems } from '../preferences.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const opened = [];
after(async () => { for (const s of opened) await s.close().catch(() => {}); });
async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-pf-'));
  const memoryDir = path.join(dir, 'memory');
  const s = await startServer({ root, port: 0, stateDir: dir, memoryDir });
  opened.push(s);
  const as = (tok) => async (method, p, body) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${p}`, { method, headers: { 'x-hq-token': tok, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  return { s, api: as(s.ownerToken), agent: as(s.token), memoryDir };
}
const working = async (api, role = 'lead') => {
  const t = (await api('POST', '/api/tasks', { title: `Work ${role}`, body: 'b', role })).json;
  const c = await api('POST', `/api/tasks/${t.id}/claim`, { engine: 'app' });
  return { id: t.id, token: c.json.taskToken };
};

test('store: add, dedupe, cap, delete, studio first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-pfs-'));
  addPrefs(dir, 'studio', ['Always use stud sizes'], '2026-11-04');
  const r = addPrefs(dir, 'builder', ['Keep modules small', 'Keep modules small', '  ', 'x'.repeat(300)], '2026-11-04');
  assert.equal(r.added, 2);
  assert.equal(readPrefs(dir, 'builder')[1].text.length, 200);
  assert.deepEqual(prefsFor(dir, 'builder').map((p) => p.text.slice(0, 6)), ['Always', 'Keep m', 'xxxxxx']);
  assert.deepEqual(prefsFor(dir, 'ui').map((p) => p.text), ['Always use stud sizes']);
  assert.equal(deletePref(dir, 'builder', 'ffffffffff'), null);
  assert.equal(deletePref(dir, 'builder', readPrefs(dir, 'builder')[0].id).length, 1);
  assert.throws(() => cleanItems([]), /non-empty/);
  assert.throws(() => cleanItems(Array(9).fill('a')), /at most 8/);
  assert.throws(() => cleanItems(['x'.repeat(201)]), /200/);
  assert.deepEqual(cleanItems(['a', ' a ', 'b']), ['a', 'b']);
});

test('owner adds and removes preferences; agents cannot; role may be studio', async () => {
  const { api, agent, memoryDir } = await boot();
  const add = await api('POST', '/api/memory/studio/preferences', { text: 'Always say studs, never pixels' });
  assert.equal(add.status, 200);
  assert.equal(add.json.added, true);
  assert.equal((await agent('POST', '/api/memory/builder/preferences', { text: 'x' })).status, 403);
  assert.equal((await api('POST', '/api/memory/nobody/preferences', { text: 'x' })).status, 400);
  assert.equal((await api('POST', '/api/memory/builder/preferences', { text: '' })).status, 400);
  const id = add.json.preferences[0].id;
  assert.equal((await agent('DELETE', `/api/memory/studio/preferences/${id}`)).status, 403);
  assert.equal((await api('GET', '/api/memory/studio/preferences')).json.preferences.length, 1);
  // studio preferences are in every role's brief, before the corrections
  const b = buildBrief({ task: { id: 't', title: 'x', body: '' }, role: 'ui', root, memoryDir });
  assert.match(b, /## Owner preferences \(standing\)[\s\S]*Always say studs, never pixels[\s\S]*## Owner corrections/);
  assert.equal((await api('DELETE', `/api/memory/studio/preferences/${id}`)).json.preferences.length, 0);
  assert.equal((await api('DELETE', `/api/memory/studio/preferences/${id}`)).status, 404);
  assert.doesNotMatch(buildBrief({ task: { id: 't', title: 'x', body: '' }, role: 'ui', root, memoryDir }), /Owner preferences \(standing\)/);
});

test('an agent proposal makes an ask and writes nothing until the owner says Save', async () => {
  const { api, agent, memoryDir } = await boot();
  const w = await working(api);
  const body = { taskId: w.id, taskToken: w.token, role: 'builder', items: ['Prefer Fusion for UI state', 'Never inline tuning values'] };
  assert.equal((await agent('POST', '/api/preferences/propose', { ...body, taskToken: 'f'.repeat(64) })).status, 403);
  assert.equal((await agent('POST', '/api/preferences/propose', { ...body, items: Array(9).fill('a') })).status, 400);
  assert.equal((await agent('POST', '/api/preferences/propose', { ...body, role: 'nobody' })).status, 400);
  const p = await agent('POST', '/api/preferences/propose', body);
  assert.equal(p.status, 200, JSON.stringify(p.json));
  const ask = (await api('GET', '/api/asks')).json.find((a) => a.id === p.json.askId);
  assert.equal(ask.title, 'Save these as standing preferences for Builder?');
  assert.deepEqual(ask.options.map((o) => o.label), ['Save', 'Not now']);
  assert.match(ask.why, /Never inline tuning values/);
  assert.deepEqual(readPrefs(memoryDir, 'builder'), []);
  assert.equal((await api('POST', `/api/asks/${ask.id}/answer`, { answer: 'save' })).status, 200);
  assert.deepEqual(readPrefs(memoryDir, 'builder').map((x) => x.text), body.items);
  // Not now writes nothing
  const w2 = await working(api);
  const p2 = await agent('POST', '/api/preferences/propose', { taskId: w2.id, taskToken: w2.token, role: 'studio', items: ['Skip me'] });
  await api('POST', `/api/asks/${p2.json.askId}/answer`, { answer: 'not-now' });
  assert.deepEqual(readPrefs(memoryDir, 'studio'), []);
});

test('the 5th owner correction queues one cheap Lead task, never two open at once', async () => {
  const { api } = await boot();
  for (let i = 1; i <= 10; i++) {
    const a = (await api('POST', '/api/asks', { role: 'builder', kind: 'review', title: `Review ${i}` })).json;
    await api('POST', `/api/asks/${a.id}/answer`, { answer: `changes:fix number ${i}` });
    const distill = (await api('GET', '/api/tasks?role=lead')).json.filter((t) => t.title === 'Distill owner preferences for Builder');
    assert.equal(distill.length, i >= 5 ? 1 : 0, `after ${i} corrections`);
  }
  const t = (await api('GET', '/api/tasks?role=lead')).json[0];
  assert.equal(t.model, 'haiku');
  assert.match(t.body, /fix number 1\n- fix number 2/);
  assert.match(t.body, /hq_preferences_propose \{ role: "builder"/);
});
