import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server.mjs';
import * as D from '../db.mjs';
import { slugFromName } from '../games-admin.mjs';

const running = [];
async function hq() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-games-'));
  const s = await startServer({ root: path.resolve(import.meta.dirname, '../../..'), port: 0, stateDir: dir });
  running.push(s);
  const call = (token) => async (method, route, body) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${route}`, { method, headers: { 'x-hq-token': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json() };
  };
  const owner = call(s.ownerToken);
  const agent = call(s.token);
  const working = async (role, extra = {}) => {
    const t = (await owner('POST', '/api/tasks', { title: `${role} job`, role, ...extra })).json;
    const c = await agent('POST', `/api/tasks/${t.id}/claim`, { engine: 'app' });
    return { id: t.id, taskToken: c.json.taskToken, game: t.game };
  };
  return { owner, agent, working, db: s.db };
}
after(async () => { for (const s of running) await s.close(); });

test('slug comes from the name', () => {
  assert.equal(slugFromName('Top Eleven!'), 'top-eleven');
  assert.equal(slugFromName('  A  '), 'a');
});

test('the lead creates a game; others and duplicates are refused', async () => {
  const { owner, agent, working, db } = await hq();
  const lead = await working('lead');
  const ok = await agent('POST', '/api/games/lead-create', { name: 'Top Eleven', pitch: 'football manager', taskId: lead.id, taskToken: lead.taskToken });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.slug, 'top-eleven');
  assert.ok(JSON.stringify(D.listMessages(db, { role: 'lead' })).includes('Lead created the game Top Eleven'));
  const dup = await agent('POST', '/api/games/lead-create', { name: 'top eleven', taskId: lead.id, taskToken: lead.taskToken });
  assert.equal(dup.status, 409);
  assert.match(dup.json.error, /top-eleven/);
  const b = await working('builder');
  assert.equal((await agent('POST', '/api/games/lead-create', { name: 'Other Game', taskId: b.id, taskToken: b.taskToken })).status, 403);
  assert.equal((await owner('POST', '/api/games/lead-create', { name: 'Other Game' })).status, 403);
});

test('create_task takes a game, else inherits the lead game', async () => {
  const { owner, agent, working } = await hq();
  const lead = await working('lead');
  await agent('POST', '/api/games/lead-create', { name: 'Top Eleven', taskId: lead.id, taskToken: lead.taskToken });
  await agent('POST', '/api/games/lead-create', { name: 'Third Game', taskId: lead.id, taskToken: lead.taskToken });
  const own = (await agent('POST', '/api/tasks', { role: 'builder', title: 'a', game: 'top-eleven', taskId: lead.id, taskToken: lead.taskToken })).json;
  assert.equal(own.game, 'top-eleven');
  const lead2 = await working('lead', { game: 'third-game' });
  const inh = (await agent('POST', '/api/tasks', { role: 'builder', title: 'b', taskId: lead2.id, taskToken: lead2.taskToken })).json;
  assert.equal(inh.game, 'third-game');
  assert.equal((await agent('POST', '/api/tasks', { role: 'builder', title: 'c', game: 'nope-game', taskId: lead.id, taskToken: lead.taskToken })).status, 400);
  void owner;
});

test('moving a task moves its children and gate tasks', async () => {
  const { owner, agent, working } = await hq();
  const lead = await working('lead');
  await agent('POST', '/api/games/lead-create', { name: 'Top Eleven', taskId: lead.id, taskToken: lead.taskToken });
  const parent = (await owner('POST', '/api/tasks', { title: 'p', role: 'builder' })).json;
  const child = (await owner('POST', '/api/tasks', { title: 'c', role: 'builder', parentId: parent.id })).json;
  const grand = (await owner('POST', '/api/tasks', { title: 'g', role: 'builder', parentId: child.id })).json;
  const other = (await owner('POST', '/api/tasks', { title: 'o', role: 'builder' })).json;
  const r = await owner('POST', `/api/tasks/${parent.id}/game`, { game: 'top-eleven' });
  assert.equal(r.status, 200);
  assert.deepEqual([...r.json.moved].sort(), [parent.id, child.id, grand.id].sort());
  assert.equal((await owner('GET', `/api/tasks/${grand.id}`)).json.game, 'top-eleven');
  assert.notEqual((await owner('GET', `/api/tasks/${other.id}`)).json.game, 'top-eleven');
  assert.equal((await owner('POST', `/api/tasks/${parent.id}/game`, { game: 'nope-game' })).status, 400);
  const none = await owner('POST', `/api/tasks/${parent.id}/game`, { game: null });
  assert.equal((await owner('GET', `/api/tasks/${child.id}`)).json.game, null);
  assert.equal(none.status, 200);
  const b = await working('builder');
  assert.equal((await agent('POST', `/api/tasks/${parent.id}/game`, { game: 'top-eleven', taskId: b.id, taskToken: b.taskToken })).status, 403);
  assert.equal((await agent('POST', `/api/tasks/${parent.id}/game`, { game: 'top-eleven', taskId: lead.id, taskToken: lead.taskToken })).status, 200);
});

test('whoami: the server finds the task from its token; a wrong token, a wrong id or the owner is refused', async () => {
  const { owner, agent, working } = await hq();
  const b = await working('builder');
  const me = await agent('POST', '/api/tasks/whoami', { taskId: b.id, taskToken: b.taskToken });
  assert.equal(me.status, 200);
  assert.equal(me.json.id, b.id);
  assert.equal(me.json.role, 'builder');
  assert.equal((await agent('POST', '/api/tasks/whoami', { taskId: b.id, taskToken: 'f'.repeat(64) })).status, 403);
  assert.equal((await agent('POST', '/api/tasks/whoami', { taskId: 't_000000000000', taskToken: b.taskToken })).status, 403);
  assert.equal((await owner('POST', '/api/tasks/whoami', {})).status, 403);
});

test('open-studio: owner yes; agents only on a Studio task of a Studio role; once per 10 minutes', async () => {
  const { mountOpenStudio } = await import('../games-admin.mjs');
  const routes = []; const route = (m, re, fn) => routes.push({ re, fn });
  let t = 0; const opened = [];
  class HttpError extends Error { constructor(s, msg) { super(msg); this.status = s; } }
  const tasks = { ui: { role: 'ui', needsStudio: 1, game: 'g' }, builder: { role: 'builder', needsStudio: 0, game: 'g' } };
  mountOpenStudio(route, { play: (slug) => { opened.push(slug); return { ok: true }; }, needGame: (s) => ({ slug: s }), agentTask: (b) => tasks[b.as], roleOf: (r) => ({ mcp: r === 'ui' ? ['Roblox_Studio'] : [] }), HttpError, now: () => t });
  const call = (who, body) => { const r = routes[0]; const m = r.re.exec('/api/games/g/open-studio'); try { return r.fn({ m, body, who }); } catch (e) { return e.status; } };
  assert.equal(call('agent', { as: 'builder' }), 403);
  assert.deepEqual(call('agent', { as: 'ui' }), { ok: true });
  assert.equal(call('owner', {}), 429);
  t += 11 * 60000;
  assert.deepEqual(call('owner', {}), { ok: true });
  assert.deepEqual(opened, ['g', 'g']);
});
