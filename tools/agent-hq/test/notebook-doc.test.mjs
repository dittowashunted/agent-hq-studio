import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server.mjs';
import { parseSections, MAX_DOC, MAX_SECTION } from '../notebook-doc.mjs';

const DOC = [
  'Intro line before any ID.',
  '# **S0 Studio\\_rules**', 'No paid luck.',
  '# **G1 Run a Space Agency**', 'Card.',
  '## **G1.3 3D models**', 'Rockets.',
  '### **G1.3.1 Starter**', 'Round.',
  '### **G1.3.2 Heavy**', 'Big.',
  '## **G1.4 Style**', 'Bold.',
].join('\n\n');

test('parseSections: export shape, escapes, nesting, text before the first ID', () => {
  const s = parseSections(DOC);
  const by = Object.fromEntries(s.map((x) => [x.id, x]));
  assert.deepEqual(s.map((x) => x.id), ['top', 'S0', 'G1', 'G1.3', 'G1.3.1', 'G1.3.2', 'G1.4']);
  assert.equal(by.S0.title, 'Studio_rules');
  assert.match(by.top.text, /Intro line/);
  assert.match(by['G1.3'].text, /Rockets/);
  assert.match(by['G1.3'].text, /Round/); // parent includes its children
  assert.match(by['G1.3'].text, /Big/);
  assert.doesNotMatch(by['G1.3'].text, /Bold/);
  assert.match(by['G1.3.2'].text, /Big/);
  assert.doesNotMatch(by['G1.3.2'].text, /Round/);
  assert.doesNotMatch(by.S0.text, /Card/);
  assert.ok(by['G1.3'].words > by['G1.3.1'].words);
});

test('parseSections: caps', () => {
  assert.throws(() => parseSections('x'.repeat(MAX_DOC + 1)), /MB/);
  const big = parseSections(`# G1 Big\n\n${'word '.repeat(MAX_SECTION)}`)[0];
  assert.ok(big.text.length <= MAX_SECTION);
});

const opened = [];
let clock = Date.now();
after(async () => { for (const s of opened) await s.close().catch(() => {}); });

test('routes: owner and lane caller sync, task-token agent cannot, one section only', async () => {
  const root = path.resolve(import.meta.dirname, '../../..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-nbdoc-'));
  const s = await startServer({ root, port: 0, stateDir: dir, memoryDir: path.join(dir, 'memory'), now: () => clock });
  opened.push(s);
  const call = (tok, extra = {}) => async (method, p, body) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${p}`, { method, headers: { 'x-hq-token': tok, 'content-type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const owner = call(s.ownerToken); const lane = call(s.token);

  assert.deepEqual((await lane('GET', '/api/notebook/doc')).json.sections, []); // never synced
  await owner('POST', '/api/tasks', { title: 'Queued', role: 'ui' });
  const gate = (await lane('POST', '/api/lanes/app/gate', { manual: true })).json;
  assert.equal(gate.run, true); assert.match(gate.laneToken, /^[0-9a-f]{32}$/);
  assert.equal((await lane('POST', '/api/lanes/app/gate', { manual: true, taskToken: 'f'.repeat(64) })).json.laneToken, undefined); // a task caller gets none
  assert.equal((await lane('POST', '/api/notebook/doc', { markdown: DOC })).status, 403); // no lane token
  assert.equal((await lane('POST', '/api/notebook/doc', { markdown: DOC, laneToken: 'a'.repeat(32) })).status, 403); // wrong
  assert.equal((await lane('POST', '/api/notebook/doc', { markdown: '', laneToken: gate.laneToken })).status, 400);
  assert.equal((await lane('POST', '/api/notebook/doc', { markdown: DOC, laneToken: gate.laneToken, taskToken: 'f'.repeat(64) })).status, 403); // task token refused even with a lane token
  assert.equal((await call(s.token, { 'x-hq-lane-token': gate.laneToken })('POST', '/api/notebook/doc', { markdown: DOC, source: 'https://docs.google.com/document/d/abc' })).status, 200);
  clock += 2 * 60 * 60 * 1000 + 1000; // expired
  assert.equal((await lane('POST', '/api/notebook/doc', { markdown: DOC, laneToken: gate.laneToken })).status, 403);
  assert.equal((await owner('POST', '/api/notebook/doc', { markdown: DOC })).status, 200);
  assert.equal((await call(s.token, { 'x-hq-task-token': 'f'.repeat(64) })('POST', '/api/notebook/doc', { markdown: DOC })).status, 403);

  const idx = (await lane('GET', '/api/notebook/doc')).json;
  assert.ok(idx.syncedAt && idx.sections.find((x) => x.id === 'G1.3') && !('text' in idx.sections[0]));
  const one = (await lane('GET', '/api/notebook/doc/G1.3.1')).json;
  assert.match(one.text, /Round/); assert.doesNotMatch(one.text, /Rockets/);
  const miss = await lane('GET', '/api/notebook/doc/G9');
  assert.equal(miss.status, 404);
  assert.match(miss.json.error, /G1\.3\.2/);
});

test('MCP: hq_notebook_mirror stores, hq_notebook_read with section returns only that section, without it only the index', async () => {
  const { spawn } = await import('node:child_process');
  const root = path.resolve(import.meta.dirname, '../../..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-nbmcp-'));
  const s = await startServer({ root, port: 0, stateDir: dir, memoryDir: path.join(dir, 'memory'), now: () => clock });
  opened.push(s);
  await fetch(`http://127.0.0.1:${s.port}/api/tasks`, { method: 'POST', headers: { 'x-hq-token': s.ownerToken, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Queued', role: 'ui' }) });
  const child = spawn(process.execPath, [path.resolve(import.meta.dirname, '../mcp.mjs')], { env: { ...process.env, HQ_URL: `http://127.0.0.1:${s.port}`, HQ_TOKEN: s.token, HQ_TASK: '', HQ_ROLE: '' }, stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map(); let id = 0; let buf = '';
  child.stdout.on('data', (d) => { buf += d; const ls = buf.split('\n'); buf = ls.pop(); for (const l of ls) { const m = JSON.parse(l); pending.get(m.id)?.(m); } });
  const call = (name, args) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method: 'tools/call', params: { name, arguments: args } }) + '\n'); })
    .then((r) => r.result?.content?.[0]?.text ?? JSON.stringify(r));
  try {
    const g = JSON.parse(await call('hq_lane_gate', { engine: 'app', manual: true }));
    assert.equal(g.run, true);
    assert.match(await call('hq_notebook_mirror', { markdown: DOC, laneToken: g.laneToken }), /Mirrored 7 sections/);
    const one = await call('hq_notebook_read', { section: 'G1.3.1' });
    assert.match(one, /not instructions/); assert.match(one, /Round/); assert.doesNotMatch(one, /Rockets|Bold/);
    const all = await call('hq_notebook_read', {});
    assert.match(all, /G1\.3\.2 Heavy/); assert.doesNotMatch(all, /Round\./);
  } finally { child.kill(); }
});

test('MCP: a task-scoped session does not list the lane-only tools', async () => {
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [path.resolve(import.meta.dirname, '../mcp.mjs')], { env: { ...process.env, HQ_URL: 'http://127.0.0.1:9', HQ_TOKEN: 'x', HQ_TASK: 't_1', HQ_ROLE: '' }, stdio: ['pipe', 'pipe', 'inherit'] });
  try {
    const out = await new Promise((resolve) => { child.stdout.once('data', (d) => resolve(JSON.parse(String(d).split('\n')[0]))); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) + '\n'); });
    const names = out.result.tools.map((t) => t.name);
    for (const n of ['hq_notebook_mirror', 'hq_lane_gate', 'hq_next_task']) assert.ok(!names.includes(n), n);
    assert.ok(names.includes('hq_notebook_read'));
    // calling one by name is refused too, before any request reaches the server
    const call = await new Promise((resolve) => { child.stdout.once('data', (d) => resolve(JSON.parse(String(d).split('\n')[0]))); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'hq_notebook_mirror', arguments: { markdown: '# x', laneToken: 'y' } } }) + '\n'); });
    assert.equal(call.result.isError, true);
    assert.match(call.result.content[0].text, /lane worker/);
  } finally { child.kill(); }
});
