import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server.mjs';
import { normalizeScore, ROW_NAMES } from '../ideas.mjs';
import { TOOLS } from '../mcp.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const opened = [];
after(async () => { for (const s of opened) await s.close().catch(() => {}); });

async function boot() {
  const s = await startServer({ root, port: 0, stateDir: fs.mkdtempSync(path.join(os.tmpdir(), 'hq-idea-')) });
  opened.push(s);
  const as = (tok) => async (method, p, body) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${p}`, { method, headers: { ...(tok ? { 'x-hq-token': tok } : {}), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  return { s, api: as(s.ownerToken), agent: as(s.token), anon: as(null) };
}

const rows = (scores = [8, 5, 6.5, 7.5, 3.5]) => ROW_NAMES.map((name, i) => ({ name, score: scores[i], evidence: `evidence for ${name}` }));
const payload = (extra = {}) => ({ verdict: 'Wanted, but a big build.', rows: rows(), change: 'Cut the second map.', ...extra });

test('normalizeScore: five rows in order, 0 to 10, overall is the row mean to one decimal', () => {
  const s = normalizeScore(payload());
  assert.equal(s.score, 6.1); // (8 + 5 + 6.5 + 7.5 + 3.5) / 5
  assert.deepEqual(s.rows.map((r) => r.name), ROW_NAMES);
  assert.deepEqual(s.rows.map((r) => r.score), [8, 5, 6.5, 7.5, 3.5]);
  assert.equal(normalizeScore(payload({ rows: rows([10, 10, 10, 10, 9]) })).score, 9.8);
  assert.equal(normalizeScore(payload({ rows: rows([0, 0, 0, 0, 0]) })).score, 0);
  assert.equal(normalizeScore(payload({ score: 99 })).score, 6.1, 'a score sent by the caller is ignored');
  // names match without regard to case, and a numeric string is a number
  const loose = rows(); loose[3].name = ' first FIVE minutes '; loose[0].score = '8';
  assert.deepEqual(normalizeScore(payload({ rows: loose })).rows[3].name, 'First five minutes');
  assert.equal(normalizeScore(payload({ rows: loose })).score, 6.1);
});

test('normalizeScore: refuses anything else with status 400', () => {
  const swapped = rows(); [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  const cases = {
    'not an object': null, 'four rows': payload({ rows: rows().slice(0, 4) }), 'six rows': payload({ rows: [...rows(), rows()[0]] }), 'wrong order': payload({ rows: swapped }),
    'score above 10': payload({ rows: rows([11, 5, 5, 5, 5]) }), 'score below 0': payload({ rows: rows([-1, 5, 5, 5, 5]) }), 'score not a number': payload({ rows: rows(['high', 5, 5, 5, 5]) }),
    'score NaN': payload({ rows: rows([NaN, 5, 5, 5, 5]) }), 'no evidence': payload({ rows: rows().map((r, i) => (i === 2 ? { ...r, evidence: '' } : r)) }),
    'no verdict': payload({ verdict: '' }), 'no change': payload({ change: undefined }), 'row not an object': payload({ rows: [...rows().slice(0, 4), 'x'] }),
  };
  for (const [why, input] of Object.entries(cases)) {
    try { normalizeScore(input); assert.fail(`${why} was accepted`); } catch (e) { assert.equal(e.status, 400, `${why}: ${e.message}`); }
  }
});

test('the MCP tool and the server agree on the row names', () => {
  const tool = TOOLS.find((t) => t.name === 'hq_idea_score');
  assert.deepEqual(tool.inputSchema.properties.rows.items.properties.name.enum, ROW_NAMES);
  assert.ok(!('score' in tool.inputSchema.properties), 'the tool does not send an overall score');
});

test('POST /api/idea-scores: owner only, validated, queues a scout task', async () => {
  const { api, agent, anon } = await boot();
  assert.equal((await anon('POST', '/api/idea-scores', { title: 'T', idea: 'I' })).status, 401);
  assert.equal((await agent('POST', '/api/idea-scores', { title: 'T', idea: 'I' })).status, 403);
  assert.equal((await anon('GET', '/api/idea-scores')).status, 401);
  for (const bad of [{}, { title: 'T' }, { idea: 'I' }, { title: 'T', idea: 'x'.repeat(2001) }, { title: 'x'.repeat(201), idea: 'I' }, { title: 3, idea: 'I' }]) {
    assert.equal((await api('POST', '/api/idea-scores', bad)).status, 400, JSON.stringify(bad).slice(0, 40));
  }
  assert.deepEqual((await api('GET', '/api/idea-scores')).json, { ideas: [] });
  const made = (await api('POST', '/api/idea-scores', { title: '  Cargo Dash  ', idea: 'Deliver cargo between stations.' })).json;
  assert.match(made.id, /^i_[0-9a-f]{12}$/);
  assert.deepEqual([made.title, made.state, made.score, made.verdict, made.rows, made.change, made.scoredAt], ['Cargo Dash', 'open', null, null, [], null, null]);
  const task = (await api('GET', `/api/tasks/${made.taskId}`)).json;
  assert.deepEqual([task.role, task.title, task.createdBy, task.state], ['scout', 'Score idea: Cargo Dash', 'owner', 'queued']);
  assert.ok(task.body.includes(made.id) && task.body.includes('hq_idea_score') && task.body.includes('First five minutes'));
  const later = (await api('POST', '/api/idea-scores', { title: 'Second', idea: 'Another.' })).json;
  assert.deepEqual((await api('GET', '/api/idea-scores')).json.ideas.map((i) => i.id), [later.id, made.id], 'newest first');
});

// claim the idea's scout task the way a worker would; returns the credentials an agent sends
const claim = async (api, taskId) => {
  const c = await api('POST', `/api/tasks/${taskId}/claim`, { engine: 'app' });
  assert.equal(c.status, 200);
  return { taskId, taskToken: c.json.taskToken };
};

test('scoring: the idea\'s own scout task may score once; the server computes the overall score', async () => {
  const { api, agent, anon } = await boot();
  const idea = (await api('POST', '/api/idea-scores', { title: 'Cargo Dash', idea: 'Deliver cargo.' })).json;
  const path = `/api/idea-scores/${idea.id}/score`;
  const mine = await claim(api, idea.taskId);
  assert.equal((await anon('POST', path, { ...mine, ...payload() })).status, 401);
  assert.equal((await agent('POST', path, payload())).status, 403, 'no task token');
  // wrong role: a working builder task
  const builder = (await api('POST', '/api/tasks', { title: 'build', role: 'builder' })).json;
  assert.equal((await agent('POST', path, { ...(await claim(api, builder.id)), ...payload() })).status, 403);
  // wrong task: another scout task, working
  const other = (await api('POST', '/api/tasks', { title: 'other scout job', role: 'scout' })).json;
  assert.equal((await agent('POST', path, { ...(await claim(api, other.id)), ...payload() })).status, 403);
  // the task token of the right task with a taskId of another task
  assert.equal((await agent('POST', path, { ...mine, taskId: other.id, ...payload() })).status, 403);
  assert.equal((await agent('POST', '/api/idea-scores/i_000000000000/score', { ...mine, ...payload() })).status, 404);
  assert.equal((await agent('POST', '/api/idea-scores/nope/score', { ...mine, ...payload() })).status, 404);
  assert.equal((await api('GET', '/api/idea-scores')).json.ideas[0].state, 'open', 'every refusal left it open');
  // bad content from the right task
  assert.equal((await agent('POST', path, { ...mine, ...payload({ rows: rows().slice(1) }) })).status, 400);
  assert.equal((await agent('POST', path, { ...mine, ...payload({ rows: rows([9, 9, 9, 9, 11]) }) })).status, 400);
  // the real thing
  const ok = await agent('POST', path, { ...mine, ...payload({ score: 10 }) });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual([ok.json.state, ok.json.score, ok.json.verdict, ok.json.change, ok.json.id], ['scored', 6.1, 'Wanted, but a big build.', 'Cut the second map.', idea.id]);
  assert.deepEqual(ok.json.rows, rows());
  assert.ok(ok.json.scoredAt);
  assert.deepEqual((await api('GET', '/api/idea-scores')).json.ideas[0], ok.json);
  assert.equal((await agent('POST', path, { ...mine, ...payload() })).status, 409, 'scored once');
});

test('an open idea reads as failed when its scout task failed or was canceled', async () => {
  const { api, agent } = await boot();
  const a = (await api('POST', '/api/idea-scores', { title: 'A', idea: 'a' })).json;
  const b = (await api('POST', '/api/idea-scores', { title: 'B', idea: 'b' })).json;
  const c = (await api('POST', '/api/idea-scores', { title: 'C', idea: 'c' })).json;
  const state = async (id) => (await api('GET', '/api/idea-scores')).json.ideas.find((i) => i.id === id).state;
  assert.deepEqual([await state(a.id), await state(b.id), await state(c.id)], ['open', 'open', 'open']);
  assert.equal((await api('POST', `/api/tasks/${a.taskId}/cancel`, {})).status, 200);
  assert.equal(await state(a.id), 'failed');
  const mine = await claim(api, b.taskId);
  assert.equal((await agent('POST', `/api/tasks/${b.taskId}/complete`, { ...mine, summary: 'could not find data', state: 'failed' })).status, 200);
  assert.equal(await state(b.id), 'failed');
  assert.equal(await state(c.id), 'open', 'a queued task is still open');
});
