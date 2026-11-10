import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server.mjs';
import { buildBrief } from '../briefs.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const opened = [];
after(async () => { for (const s of opened) await s.close().catch(() => {}); });

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-opt-'));
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'media/a.png'), 'x');
  const s = await startServer({ root, port: 0, stateDir: dir, memoryDir: path.join(dir, 'memory') });
  opened.push(s);
  return (body) => fetch(`http://127.0.0.1:${s.port}/api/asks`, { method: 'POST', headers: { 'x-hq-token': s.ownerToken, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'lead', kind: 'decision', title: 'Which look?', ...body }) })
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
}

test('ask options keep description, recommended and an existing mediaPath', async () => {
  const post = await boot();
  const r = await post({ options: [{ id: 'a', label: 'A', description: 'Bold', mediaPath: 'a.png', recommended: true }, { id: 'b', label: 'B' }] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.options, [{ id: 'a', label: 'A', description: 'Bold', mediaPath: 'a.png', recommended: true }, { id: 'b', label: 'B' }]);
});

test('ask options refuse unsafe, missing or too many mediaPaths and long descriptions', async () => {
  const post = await boot();
  for (const mediaPath of ['../x.png', '/etc/passwd', 'missing.png']) assert.equal((await post({ options: [{ id: 'a', label: 'A', mediaPath }] })).status, 400, mediaPath);
  assert.equal((await post({ options: [{ id: 'a', label: 'A', description: 'x'.repeat(301) }] })).status, 400);
  const five = Array.from({ length: 5 }, (_, i) => ({ id: `o${i}`, label: `O${i}`, mediaPath: 'a.png' }));
  assert.equal((await post({ options: five })).status, 400);
  assert.equal((await post({ options: five.slice(0, 4) })).status, 200);
});

test('briefs carry the How to ask rule and the pick-from-4 creative rule', () => {
  const b = buildBrief({ task: { id: 't_abc', title: 'T', body: 'b', engine: 'app' }, role: 'designer', root });
  assert.match(b, /How to ask: only when blocked on a real choice/);
  assert.match(b, /offer 4\+ distinct options/);
});
