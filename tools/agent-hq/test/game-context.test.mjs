import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server.mjs';
import * as D from '../db.mjs';
import { buildBrief } from '../briefs.mjs';
import { inferGame, gameInText, gameSection, clearFinished } from '../game-context.mjs';

const games = [{ slug: 'space-agency', name: 'Run a Space Agency', stage: 'built' }, { slug: 'top-eleven', name: 'Top Eleven', stage: 'designed' }];
const sections = [{ id: 'G1', title: 'Run a Space Agency' }, { id: 'G1.1', title: 'World' }, { id: 'G2', title: 'Top Eleven' }];

test('inference order: parent, selected game, name match, ambiguity', () => {
  assert.equal(inferGame({ parentGame: 'space-agency', selected: 'top-eleven', text: 'top eleven', games }), 'space-agency');
  assert.equal(inferGame({ selected: 'top-eleven', text: 'Run a Space Agency', games }), 'top-eleven');
  assert.equal(inferGame({ text: 'Fix the lineup in TOP ELEVEN please', games }), 'top-eleven');
  assert.equal(inferGame({ text: 'Compare Top Eleven with Run a Space Agency', games }), null);
  assert.equal(inferGame({ text: 'nothing here', games }), null);
  assert.equal(inferGame({ selected: 'gone', text: 'x', games }), null); // unknown slug is ignored
  assert.equal(gameInText('the top elevens thing', games), null); // whole words only
});

test('brief has "Your game" with the right folder for both games and a fallback', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-gc-'));
  fs.mkdirSync(path.join(root, 'games/top-eleven'), { recursive: true });
  fs.writeFileSync(path.join(root, 'games/top-eleven/default.project.json'), '{}');
  const te = gameSection({ task: { game: 'top-eleven' }, games, root, sections });
  assert.match(te, /Work folder: games\/top-eleven\//);
  assert.match(te, /games\/top-eleven\/default\.project\.json/);
  assert.match(te, /chapter: G2 \(Top Eleven\)/);
  assert.match(te, /never edit the other game's files/);
  const sa = gameSection({ task: { game: 'space-agency' }, games, root, sections });
  assert.match(sa, /Work folder: the repo root/);
  assert.match(sa, /chapter: G1 \(Run a Space Agency\)/);
  const none = gameSection({ task: {}, games, root, sections });
  assert.match(none, /no game/);
  assert.match(none, /top-eleven/);
  assert.match(gameSection({ task: { game: 'top-eleven' }, games, root, sections: [{ id: 'G1', title: 'Other' }] }), /chapters: G1 Other/);
  const brief = buildBrief({ task: { id: 't_1', title: 'x', body: '', game: 'top-eleven' }, role: 'builder', root: path.resolve(import.meta.dirname, '../../..'), docSections: sections });
  assert.ok(brief.indexOf('## Your job') < brief.indexOf('## Your game'));
});

const running = [];
async function hq() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-gc-srv-'));
  const s = await startServer({ root: path.resolve(import.meta.dirname, '../../..'), port: 0, stateDir: dir, memoryDir: path.join(dir, 'memory') });
  running.push(s);
  D.createGame(s.db, { slug: 'top-eleven', name: 'Top Eleven' });
  const call = (token) => async (method, route, body) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${route}`, { method, headers: { 'x-hq-token': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json() };
  };
  return { owner: call(s.ownerToken), agent: call(s.token), db: s.db };
}
after(async () => { for (const s of running) await s.close(); });

test('an owner message carries the selected game to the Lead task; task text names a game', async () => {
  const { owner, db } = await hq();
  await owner('POST', '/api/messages', { role: 'lead', text: 'plan the next step', game: 'top-eleven' });
  await owner('POST', '/api/messages', { role: 'lead', text: 'plan the next step now' });
  const t = (await owner('POST', '/api/tasks', { title: 'Polish Top Eleven lineup', role: 'ui' })).json;
  const tasks = D.listTasks(db, {});
  assert.equal(tasks.find((x) => x.title === 'plan the next step').game, 'top-eleven');
  assert.equal(tasks.find((x) => x.title === 'plan the next step now').game, null);
  assert.equal(t.game, 'top-eleven');
});

test('clear-finished is owner only and keeps open work', async () => {
  const { owner, agent, db } = await hq();
  const mk = (title, state, ended) => { const t = D.createTask(db, { role: 'ui', title, body: '', createdBy: 'owner' }); D.updateTask(db, t.id, { state, endedAt: ended }); return t; };
  const old = new Date(Date.now() - 2 * 3600e3).toISOString();
  const doneOld = mk('old done', 'done', old);
  mk('fresh done', 'done', new Date().toISOString());
  mk('queued', 'queued', null);
  D.createAsk(db, { taskId: doneOld.id, role: 'ui', kind: 'decision', title: 'q', why: '', options: [{ id: 'a', label: 'A' }] });
  const ask = D.listAsks(db, {})[0];
  assert.equal((await agent('POST', '/api/tasks/clear-finished')).status, 403);
  await owner('POST', `/api/asks/${ask.id}/answer`, { answer: 'a' });
  const r = await owner('POST', '/api/tasks/clear-finished');
  assert.deepEqual(r.json, { tasks: 1, asks: 1 });
  assert.deepEqual(D.listTasks(db, {}).map((t) => t.title).sort(), ['fresh done', 'queued']);
  assert.equal(clearFinished(db).tasks, 0);
});
