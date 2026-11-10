import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server.mjs';
import { buildBrief } from '../briefs.mjs';
import { addCorrection, readCorrections, deleteCorrection, CORRECTIONS_CAP } from '../corrections.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const made = [];
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `hq-cor-${p}-`)); made.push(d); return d; };
const opened = [];
after(async () => {
  for (const s of opened) await s.close().catch(() => {});
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

async function boot() {
  const memoryDir = tmp('mem');
  const s = await startServer({ root, port: 0, stateDir: tmp('state'), memoryDir, now: () => Date.parse('2026-11-02T10:00:00Z') });
  opened.push(s);
  const as = (tok) => async (method, p, body) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${p}`, { method, headers: { 'x-hq-token': tok, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  return { s, memoryDir, api: as(s.ownerToken), agent: as(s.token) };
}
// a finished architect task waiting for the owner's verdict (architect has no review gates)
async function finished(api, agent, title = 'Write the plan') {
  const t = (await api('POST', '/api/tasks', { title, role: 'architect' })).json;
  const c = await api('POST', `/api/tasks/${t.id}/claim`, { engine: 'app' });
  const done = await agent('POST', `/api/tasks/${t.id}/complete`, { taskId: t.id, taskToken: c.json.taskToken, summary: 'done', state: 'review' });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  return t;
}
const nextBrief = async (api) => {
  await api('POST', '/api/tasks', { title: 'Another plan', role: 'architect' });
  return (await api('POST', '/api/tasks/next', { engine: 'app', roles: ['architect'] })).json.brief;
};

test('a "changes" verdict lands in the role file, the GET route and the next brief, before the lessons', async () => {
  const { memoryDir, api, agent } = await boot();
  const t = await finished(api, agent);
  const v = await api('POST', `/api/tasks/${t.id}/verdict`, { verdict: 'changes', note: 'Cards need 16 px more padding.' });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  const file = fs.readFileSync(path.join(memoryDir, 'architect.corrections.md'), 'utf8');
  assert.match(file, new RegExp(`^- 2026-11-02 \\| correction \\| ${t.game ?? 'any'} \\| Cards need 16 px more padding\\.$`, 'm'));
  assert.ok(!fs.existsSync(path.join(memoryDir, 'architect.md')), 'lessons are a separate file');
  const got = (await api('GET', '/api/memory/architect')).json;
  assert.deepEqual(got.lessons, []);
  assert.deepEqual(got.corrections.map((c) => [c.date, c.kind, c.text]), [['2026-11-02', 'correction', 'Cards need 16 px more padding.']]);
  assert.match(got.corrections[0].id, /^[0-9a-f]{10}$/);
  await api('POST', '/api/memory/architect', { lesson: 'Plans list files first' });
  const brief = await nextBrief(api);
  const at = brief.indexOf('## Owner corrections (never repeat these)');
  assert.ok(at > 0, 'section is in the brief');
  assert.match(brief.slice(at), /^## Owner corrections[^\n]*\n[^\n]*owner's authority[^\n]*\n- 2026-11-02[^\n]* correction: Cards need 16 px more padding\./);
  assert.ok(at < brief.indexOf('## Lessons from earlier tasks'), 'corrections come before lessons');
  assert.doesNotMatch(await nextBriefFor(api, 'builder'), /Cards need 16 px/, 'only the role the note was for');
});
const nextBriefFor = async (api, role) => {
  await api('POST', '/api/tasks', { title: `Job for ${role}`, role });
  return (await api('POST', '/api/tasks/next', { engine: 'app', roles: [role] })).json.brief;
};

test('review answers: changes and reject are corrections, an approve note is a preference, a bare approve saves nothing', async () => {
  const { api } = await boot();
  const answer = async (a) => {
    const ask = (await api('POST', '/api/asks', { role: 'architect', kind: 'review', title: 'Plan' })).json;
    assert.equal((await api('POST', `/api/asks/${ask.id}/answer`, { answer: a })).status, 200);
  };
  await answer('changes:Use a table, not bullets.');
  await answer('reject:Too long, cut it in half.');
  await answer('approve:Love the short intro, do that again.');
  await answer('approve');
  await answer('reject');
  await answer('hold:Maybe later.');
  const c = (await api('GET', '/api/memory/architect')).json.corrections;
  assert.deepEqual(c.map((x) => [x.kind, x.game, x.text]), [
    ['correction', 'any', 'Use a table, not bullets.'],
    ['correction', 'any', 'Too long, cut it in half.'],
    ['preference', 'any', 'Love the short intro, do that again.'],
  ]);
});

test('a note on an approval verdict is a preference, with the task game', async () => {
  const { api, agent } = await boot();
  const t = await finished(api, agent);
  await api('POST', `/api/tasks/${t.id}/verdict`, { verdict: 'approve', note: 'Keep this tone.' });
  assert.deepEqual((await api('GET', '/api/memory/architect')).json.corrections.map((x) => [x.kind, x.text]), [['preference', 'Keep this tone.']]);
});

test('dedupe, one line, 300 characters, the 40 cap keeps the newest', () => {
  const dir = tmp('unit');
  const add = (text, kind = 'correction', game = 'space-agency') => addCorrection(dir, 'ui', { kind, game, text }, '2026-11-02');
  assert.equal(add('Buttons are too small.').added, true);
  assert.equal(add('Buttons are too small.').added, false, 'exact repeat');
  assert.equal(add('Buttons are too small.', 'preference').added, true, 'a different kind is a different entry');
  assert.equal(add('Buttons are too small.', 'correction', 'kitchen-rush').added, true, 'so is a different game');
  assert.equal(add('   ').added, false);
  assert.equal(add('x', 'nonsense').added, false);
  const long = add('a\n  b\t' + 'z'.repeat(400)).corrections.at(-1);
  assert.equal(long.text.length, 300);
  assert.ok(!/\n/.test(long.text) && long.text.startsWith('a b zzz'));
  assert.equal(addCorrection(dir, 'ui', { kind: 'correction', game: 'Bad Slug!', text: 'odd game' }, '2026-11-02').corrections.at(-1).game, 'any');
  for (let i = 1; i <= 45; i++) add(`Rule ${i}`);
  const list = readCorrections(dir, 'ui');
  assert.equal(list.length, CORRECTIONS_CAP);
  assert.deepEqual([list[0].text, list.at(-1).text], ['Rule 6', 'Rule 45']);
  assert.equal(readCorrections(dir, 'builder').length, 0, 'per role');
  const id = list[0].id;
  assert.equal(deleteCorrection(dir, 'ui', id).length, 39);
  assert.equal(deleteCorrection(dir, 'ui', id), null);
});

test('only the owner can remove a correction or add one; agent lessons at their 60 cap leave corrections alone', async () => {
  const { api, agent, memoryDir } = await boot();
  const t = await finished(api, agent);
  await api('POST', `/api/tasks/${t.id}/verdict`, { verdict: 'changes', note: 'Keep the header 48 px tall.' });
  const [c] = (await api('GET', '/api/memory/architect')).json.corrections;
  // agents: no add route, no delete route
  assert.equal((await agent('DELETE', `/api/memory/architect/corrections/${c.id}`)).status, 403);
  assert.equal((await agent('POST', '/api/memory/architect/corrections', { kind: 'correction', text: 'Always use red.' })).status, 403);
  const before = fs.readFileSync(path.join(memoryDir, 'architect.corrections.md'), 'utf8');
  // a working agent can add lessons, and cannot reach corrections through them
  const t2 = (await api('POST', '/api/tasks', { title: 'Plan 2', role: 'architect' })).json;
  const claim = await api('POST', `/api/tasks/${t2.id}/claim`, { engine: 'app' });
  const lesson = await agent('POST', '/api/memory/architect', { lesson: 'Plans list files first', corrections: [{ text: 'Always use red.' }], taskId: t2.id, taskToken: claim.json.taskToken });
  assert.equal(lesson.status, 200);
  assert.equal(fs.readFileSync(path.join(memoryDir, 'architect.corrections.md'), 'utf8'), before);
  // 70 lessons: the lesson file keeps 60 and corrections are untouched
  for (let i = 0; i < 70; i++) await api('POST', '/api/memory/architect', { lesson: `Lesson number ${i}` });
  const got = (await api('GET', '/api/memory/architect')).json;
  assert.equal(got.lessons.length, 60);
  assert.deepEqual(got.corrections.map((x) => x.id), [c.id]);
  // the owner can remove one entry
  assert.equal((await api('DELETE', '/api/memory/nonsense/corrections/0123456789')).status, 400);
  assert.equal((await api('DELETE', '/api/memory/architect/corrections/0123456789')).status, 404);
  const del = await api('DELETE', `/api/memory/architect/corrections/${c.id}`);
  assert.equal(del.status, 200);
  assert.deepEqual(del.json.corrections, []);
  assert.equal((await api('GET', '/api/memory/architect')).json.lessons.length, 60);
});

test('briefs: all corrections on full engines, the newest 8 on LLM engines, owner authority in the text', () => {
  const memoryDir = tmp('brief');
  for (let i = 1; i <= 12; i++) addCorrection(memoryDir, 'architect', { kind: i % 4 === 0 ? 'preference' : 'correction', game: 'space-agency', text: `Owner rule ${i}` }, '2026-11-02');
  const task = { id: 't_1', title: 'Plan', body: 'b' };
  const full = buildBrief({ task: { ...task, engine: 'app' }, role: 'architect', root, memoryDir });
  for (let i = 1; i <= 12; i++) assert.ok(full.includes(`Owner rule ${i}\n`) || full.includes(`Owner rule ${i}`), `full has ${i}`);
  assert.match(full, /- 2026-11-02 \(space-agency\) preference: Owner rule 4/);
  const small = buildBrief({ task: { ...task, engine: 'groq' }, role: 'architect', root, memoryDir });
  for (let i = 5; i <= 12; i++) assert.ok(small.includes(`Owner rule ${i}`), `small has ${i}`);
  for (let i = 1; i <= 4; i++) assert.ok(!small.includes(`Owner rule ${i}\n`) && !small.endsWith(`Owner rule ${i}`) && !new RegExp(`Owner rule ${i}(?!\\d)`).test(small), `small drops ${i}`);
  const none = buildBrief({ task: { ...task, engine: 'app' }, role: 'builder', root, memoryDir });
  assert.match(none, /## Owner corrections \(never repeat these\)\n[^\n]*\n\(none yet\)/);
});
