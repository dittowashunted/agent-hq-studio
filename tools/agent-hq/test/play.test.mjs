import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPlay } from '../play.mjs';

function setup({ project = true, rojo = '/bin/rojo', fail = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-play-'));
  const root = path.join(base, 'repo'); const stateDir = path.join(base, 'state');
  fs.mkdirSync(root, { recursive: true });
  if (project) fs.writeFileSync(path.join(root, 'default.project.json'), '{}');
  const calls = { run: [], open: [] };
  const play = createPlay({
    root, stateDir, find: () => rojo,
    run: async (cmd, args, opts) => { calls.run.push([cmd, args, opts]); if (fail) throw Object.assign(new Error('boom'), { stderr: 'Error: bad project\nmore' }); return {}; },
    open: async (file) => { calls.open.push(file); },
  });
  return { play, calls, root, stateDir };
}

test('play builds with an argument array, opens the file, and never publishes', async () => {
  const { play, calls, root, stateDir } = setup();
  const r = await play('space-agency');
  const file = path.join(stateDir, 'builds', 'space-agency.rbxlx');
  assert.deepEqual(r, { ok: true, file });
  assert.deepEqual(calls.run[0].slice(0, 2), ['/bin/rojo', ['build', path.join(root, 'default.project.json'), '-o', file]]);
  assert.deepEqual(calls.open, [file]);
  assert.ok(!calls.run.some(([, args]) => args.some((a) => /publish|upload/i.test(a))));
});

test('no rojo, no project file, and a failed build each give a plain 409', async () => {
  for (const [opts, re] of [[{ rojo: null }, /Rojo is not installed/], [{ project: false }, /default\.project\.json/], [{ fail: true }, /could not build the place: Error: bad project$/]]) {
    const { play, calls } = setup(opts);
    await assert.rejects(play('x'), (e) => e.status === 409 && e.expose && re.test(e.message));
    assert.equal(calls.open.length, 0);
  }
});
