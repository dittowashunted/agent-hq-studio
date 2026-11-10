// Groq/NIM engine end to end: a fake OpenAI-compatible provider scripts tool calls, the real server and runner
// spawn llm-agent.mjs, and the test checks what reached disk, the provider and the task.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';

const realRoot = path.resolve(import.meta.dirname, '../../..');

// fake provider: GET /models, POST /chat/completions answers from `script` one turn at a time
const requests = [];
let script = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'whisper-large-v3' }, { id: 'openai/gpt-oss-120b' }, { id: 'llama-3.3-70b-versatile' }] }));
    const j = JSON.parse(body);
    requests.push(j);
    const step = script[requests.length - 1] ?? { content: 'done' };
    const tool_calls = step.calls?.map(([name, args], i) => ({ id: `call_${requests.length}_${i}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }));
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: step.content ?? null, ...(tool_calls ? { tool_calls } : {}) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
process.env.HQ_GROQ_BASE = `http://127.0.0.1:${fake.address().port}`;

const { startServer } = await import('../server.mjs');
const { createRunner } = await import('../runner.mjs');
const { safePath, checkCommand, commandPrefixes, globRe, compact, stripThink, childEnv, privateIp, hqToolDefs } = await import('../llm-agent.mjs');

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-llm-'));
  const skill = '.claude/skills/roblox-agent-team';
  fs.mkdirSync(path.join(root, skill), { recursive: true });
  for (const f of ['SKILL.md', 'vault.md']) fs.copyFileSync(path.join(realRoot, skill, f), path.join(root, skill, f));
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/notes.md'), 'line one\r\nline two\r\n');
  return root;
}

test('architect on Groq: reads, edits its own files, is refused elsewhere, reports', async () => {
  const root = tmpRoot();
  const stateDir = path.join(root, '.agent-hq');
  const s = await startServer({ root, port: 0, stateDir, memoryDir: path.join(stateDir, 'memory'), runner: (ctx) => createRunner({ ...ctx, tickMs: 30 }) });
  const call = async (method, route, body) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${route}`, { method, headers: { 'x-hq-token': s.ownerToken, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, json: await r.json() };
  };
  try {
    script = [
      { content: 'Looking.', calls: [['search', { text: 'line two', dir: 'docs' }], ['nope_tool', {}]] },
      { calls: [['edit_file', { path: 'docs/notes.md', old: 'line two', new: 'line 2' }], ['write_file', { path: 'src/hack.luau', content: 'x' }], ['read_file', { path: '.agent-hq/owner-token' }]] },
      { calls: [['hq_complete', { summary: 'Edited docs/notes.md. No checks needed.', state: 'review' }]] },
    ];
    const saved = await call('POST', '/api/settings', { key: 'providers', value: { id: 'groq', apiKey: 'gsk_' + 'x'.repeat(40) } });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.json.value.groq, { configured: true, label: 'Groq' });
    assert.equal(saved.json.models.recommended, 'openai/gpt-oss-120b', 'whisper is filtered, the preferred model is picked');
    assert.ok(!JSON.stringify((await call('GET', '/api/settings')).json).includes('gsk_'), 'the key is never sent back');

    const t = (await call('POST', '/api/tasks', { role: 'architect', title: 'Tidy notes', body: 'Fix the notes.', engine: 'groq' })).json;
    let task;
    for (let i = 0; i < 200; i++) { task = (await call('GET', `/api/tasks/${t.id}`)).json; if (!['queued', 'working'].includes(task.state)) break; await new Promise((r) => setTimeout(r, 50)); }
    assert.equal(task.state, 'review', JSON.stringify(task));
    assert.equal(fs.readFileSync(path.join(root, 'docs/notes.md'), 'utf8'), 'line one\r\nline 2\r\n', 'edit kept CRLF');
    assert.ok(!fs.existsSync(path.join(root, 'src/hack.luau')), 'cannot write outside its files');

    assert.equal(requests[0].model, 'openai/gpt-oss-120b');
    assert.ok(requests[0].tools.some((x) => x.function.name === 'edit_file') && !requests[0].tools.some((x) => x.function.name === 'run_check' || x.function.name === 'hq_pitch' || x.function.name === 'hq_idea_score'));
    assert.ok(!JSON.stringify(requests[0].tools).includes('taskToken'), 'task credentials come from env, not the model');
    const second = requests[1].messages;
    assert.ok(second.some((m) => m.role === 'user' && /no tool named nope_tool/i.test(m.content)) || second.at(-1).content.includes('line two'));
    assert.ok(!JSON.stringify(second).includes('nope_tool"'), 'a bogus call is not kept in history');
    const third = JSON.stringify(requests[2].messages);
    assert.match(third, /may only write your own files/);
    assert.match(third, /off limits/);
    assert.ok(requests[2].messages.filter((m) => m.role === 'tool').every((m) => m.tool_call_id?.startsWith('call_')));
  } finally {
    await s.close();
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }); } catch { /* Windows may still hold the db file */ }
  }
});

test('path, command and glob guards', () => {
  assert.throws(() => safePath('../outside.txt'), /outside/);
  assert.throws(() => safePath('.agent-hq/token'), /off limits/);
  assert.throws(() => safePath('.env.local'), /off limits/);
  assert.equal(safePath('src/shared/Economy.luau').rel, 'src/shared/Economy.luau');
  const pre = commandPrefixes(['Read', 'Bash(stylua:*)', 'Bash(lune:*)', 'Bash(python scripts/*)', 'Bash(git diff:*)']);
  assert.deepEqual(pre, ['stylua', 'lune', 'python scripts/', 'git diff']);
  assert.deepEqual(checkCommand('lune run tests/run', pre), ['lune', 'run', 'tests/run']);
  assert.deepEqual(checkCommand('python scripts/sync_studio.py 1', pre), ['python', 'scripts/sync_studio.py', '1']);
  assert.throws(() => checkCommand('lune run x; rm -rf /', pre), /operators/);
  assert.throws(() => checkCommand('python ../evil.py', pre), /operators/);
  assert.throws(() => checkCommand('git push', pre), /not allowed/);
  assert.throws(() => checkCommand('stylua2 src', pre), /not allowed/);
  // the repo's real check commands pass; smuggled flags, absolute and denied paths do not
  const all = commandPrefixes(['Bash(stylua:*)', 'Bash(selene:*)', 'Bash(rojo:*)', 'Bash(luau-lsp:*)', 'Bash(git diff:*)']);
  assert.ok(checkCommand('rojo sourcemap default.project.json -o sourcemap.json', all));
  assert.ok(checkCommand('luau-lsp analyze --definitions=.types/globalTypes.d.luau --sourcemap=sourcemap.json src', all));
  assert.ok(checkCommand('git diff --stat', all) && checkCommand('stylua --check src tests', all));
  assert.throws(() => checkCommand('git diff --output=src/x.luau', all), /flag --output=src\/x.luau is not allowed/);
  assert.throws(() => checkCommand('stylua --config-path=C:/evil.toml src', all), /not allowed/);
  assert.throws(() => checkCommand('selene C:/Windows', all), /absolute/);
  assert.throws(() => checkCommand('selene .agent-hq/token', all), /off limits/);
  assert.throws(() => checkCommand('rojo build -o .git/hooks/pre-commit', all), /off limits/);
  assert.equal(childEnv({ PATH: 'p', HQ_TOKEN: 't', HQ_LLM_KEY: 'k', hq_task_token: 'x' }).PATH, 'p');
  assert.deepEqual(Object.keys(childEnv({ PATH: 'p', HQ_TOKEN: 't', HQ_LLM_KEY: 'k' })), ['PATH']);
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.20.0.1', '169.254.169.254', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '[::1]', '100.64.0.1']) assert.ok(privateIp(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) assert.ok(!privateIp(ip), ip);
  assert.ok(globRe('src/server/**').test('src/server/Services/A.luau'));
  assert.ok(globRe('docs/*.md').test('docs/a.md') && !globRe('docs/*.md').test('docs/x/a.md'));
});

test('hq_pitch and hq_idea_score are scout-only; the model never sees the task credentials', () => {
  const names = (role) => hqToolDefs(role).map((t) => t.function.name);
  for (const t of ['hq_pitch', 'hq_idea_score']) {
    assert.ok(names('scout').includes(t), t);
    for (const role of ['lead', 'architect', 'builder', 'producer']) assert.ok(!names(role).includes(t), `${role} must not get ${t}`);
  }
  for (const role of ['lead', 'scout', 'builder', 'ui', 'kid-tester', 'reviewer']) { // knowledge reads are open to every role
    for (const t of ['hq_knowledge_search', 'hq_knowledge_read', 'hq_notebook_read', 'hq_notebook_add']) assert.ok(names(role).includes(t), `${role} gets ${t}`);
  }
  const know = hqToolDefs('builder').find((t) => t.function.name === 'hq_knowledge_read').function;
  assert.deepEqual(know.parameters.required.sort(), ['path', 'source']);
  const idea = hqToolDefs('scout').find((t) => t.function.name === 'hq_idea_score').function;
  assert.deepEqual(Object.keys(idea.parameters.properties).sort(), ['change', 'ideaId', 'rows', 'verdict']);
  assert.deepEqual(idea.parameters.required.sort(), ['change', 'ideaId', 'rows', 'verdict']);
});

test('compact keeps requests under budget; stripThink drops reasoning', () => {
  const msgs = [{ role: 'system', content: 's' }, { role: 'user', content: 'brief' }];
  for (let i = 0; i < 10; i++) msgs.push({ role: 'assistant', content: '' }, { role: 'tool', tool_call_id: 'c' + i, content: 'x'.repeat(5000) });
  compact(msgs, 6, 12000);
  const total = msgs.reduce((n, m) => n + m.content.length, 0);
  assert.ok(total < 12000, `total ${total}`);
  assert.equal(stripThink('<think>long plan</think>Answer'), 'Answer');
});

test.after(() => fake.close());
