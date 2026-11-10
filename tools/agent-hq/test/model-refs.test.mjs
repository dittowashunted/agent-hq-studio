import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server.mjs';
import { isModelTask } from '../model-refs.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const opened = [];
after(async () => { for (const s of opened) await s.close().catch(() => {}); });

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-mr-'));
  const s = await startServer({ root, port: 0, stateDir: dir, memoryDir: path.join(dir, 'memory') });
  opened.push(s);
  const as = (tok) => async (method, p, body) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${p}`, { method, headers: { 'x-hq-token': tok, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  return { s, api: as(s.ownerToken), agent: as(s.token) };
}
const tasks = async (api) => (await api('GET', '/api/tasks?limit=500')).json;
const worldTasks = async (api) => (await tasks(api)).filter((x) => x.role === 'world');
// the reference task claims, attaches an image ask and finishes
async function sheet(agent, engine, image = 'assets/concepts/ref-front.png') {
  const claim = (await agent('POST', '/api/tasks/next', { engine })).json;
  const ask = await agent('POST', '/api/asks', { taskId: claim.task.id, taskToken: claim.taskToken, kind: 'review', title: 'Reference sheet: rocket front', mediaPath: image });
  assert.equal(ask.status, 200, JSON.stringify(ask.json));
  await agent('POST', `/api/tasks/${claim.task.id}/complete`, { taskId: claim.task.id, taskToken: claim.taskToken, summary: '12 studs tall, 6 parts, metal and red.' });
  return { claim, ask: ask.json };
}

test('isModelTask: 3D work hits, other "model" words miss', () => {
  for (const t of ['Make a 3D rocket model', 'Low poly statue', 'Sculpt a creature', 'Blender cleanup', 'Model of a space station']) assert.ok(isModelTask({ title: t, role: 'world' }), t);
  for (const t of ['Fix the data model', 'AI model picker', 'Update the model list', 'Place props around the pad']) assert.ok(!isModelTask({ title: t, role: 'world' }), t);
  assert.ok(!isModelTask({ title: 'Make a 3D rocket', role: 'lead' }));
});

test('hold, approve releases once with paths, no concept build, agents cannot approve', async () => {
  const { api, agent } = await boot();
  const t = (await api('POST', '/api/tasks', { title: 'Make a 3D rocket model', role: 'world', body: 'Orange.' })).json;
  assert.equal(t.title, 'Reference sheet: Make a 3D rocket model');
  assert.equal(t.role, 'designer');
  assert.equal(t.engine, 'antigravity');
  assert.equal((await worldTasks(api)).length, 0);
  const { ask } = await sheet(agent, 'antigravity');
  assert.equal((await agent('POST', `/api/asks/${ask.id}/answer`, { answer: 'approve' })).status, 403);
  assert.equal((await worldTasks(api)).length, 0);
  assert.equal((await api('POST', `/api/asks/${ask.id}/answer`, { answer: 'approve' })).status, 200);
  const built = await worldTasks(api);
  assert.equal(built.length, 1); // released once, not re-intercepted
  assert.match(built[0].body, /assets\/concepts\/ref-front\.png/);
  assert.match(built[0].body, /12 studs tall/);
  assert.match(built[0].body, /Build from this approved reference sheet/);
  assert.equal((await tasks(api)).filter((x) => x.title.startsWith('Build approved concept')).length, 0);
});

test('a Changes rework approval releases; reject drops', async () => {
  const { api, agent } = await boot();
  await api('POST', '/api/tasks', { title: 'Low poly statue', role: 'world' });
  const { ask } = await sheet(agent, 'antigravity');
  await api('POST', `/api/asks/${ask.id}/answer`, { answer: 'changes:add a back view' });
  const rework = (await tasks(api)).find((x) => x.title.startsWith('Changes:'));
  const claim = (await agent('POST', '/api/tasks/next', { engine: 'antigravity' })).json;
  assert.equal(claim.task.id, rework.id);
  const ask2 = (await agent('POST', '/api/asks', { taskId: rework.id, taskToken: claim.taskToken, kind: 'review', title: 'Reference sheet: statue back', mediaPath: 'assets/concepts/ref-back.png' })).json;
  await api('POST', `/api/asks/${ask2.id}/answer`, { answer: 'approve' });
  assert.equal((await worldTasks(api)).length, 1);

  const b = await boot();
  await b.api('POST', '/api/tasks', { title: 'Low poly statue', role: 'world' });
  const r = await sheet(b.agent, 'antigravity');
  await b.api('POST', `/api/asks/${r.ask.id}/answer`, { answer: 'reject:wrong style' });
  assert.equal((await worldTasks(b.api)).length, 0);
});

test('auto releases on complete on the chatgpt lane; setting off makes the task directly', async () => {
  const { api, agent } = await boot();
  await api('POST', '/api/settings', { key: 'modelRefApproval', value: 'auto' });
  await api('POST', '/api/settings', { key: 'modelRefLane', value: 'chatgpt' });
  const t = (await api('POST', '/api/tasks', { title: 'Make a 3D rocket model', role: 'world' })).json;
  assert.equal(t.engine, 'app');
  await sheet(agent, 'app');
  assert.equal((await worldTasks(api)).length, 1);

  const off = await boot();
  await off.api('POST', '/api/settings', { key: 'modelRefFirst', value: false });
  const d = (await off.api('POST', '/api/tasks', { title: 'Make a 3D rocket model', role: 'world' })).json;
  assert.equal(d.role, 'world');
});

test('a canceled sheet drops its build and tells the owner', async () => {
  const { api } = await boot();
  const ref = (await api('POST', '/api/tasks', { title: 'Make a 3D rocket model', role: 'world' })).json;
  assert.equal((await api('POST', `/api/tasks/${ref.id}/cancel`)).status, 200);
  const msgs = (await api('GET', '/api/messages?role=world')).json;
  assert.ok(JSON.stringify(msgs).includes('Reference sheet canceled'));
  await api('POST', '/api/settings', { key: 'modelRefApproval', value: 'auto' }); // nothing left to release
  assert.equal((await worldTasks(api)).length, 0);
});
