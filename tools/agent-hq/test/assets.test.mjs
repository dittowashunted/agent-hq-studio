import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listAssets, addAsset, readSystems } from '../assets.mjs';

const realRoot = path.resolve(import.meta.dirname, '../../..');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-assets-'));
  const put = (rel, text = 'x') => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  put('assets/ui/coin.png');
  put('assets/ui/rocket icon.png');
  put('assets/sfx/launch.ogg');
  put('assets/models/pad.rbxm');
  put('assets/readme.txt');
  put('assets/.gitkeep');
  put('tools/agent-hq/assets.json', JSON.stringify([
    { id: 'coin', name: 'Gold coin', kind: 'icon', scope: 'game:space-agency', tags: ['currency'], file: 'assets/ui/coin.png', robloxId: '123' },
    { id: 'gone', name: 'Deleted file', kind: 'model', scope: 'studio', tags: [], file: 'assets/models/gone.rbxm', robloxId: null },
  ]));
  return { root, put, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('listAssets merges the index with unindexed files and counts', () => {
  const f = fixture();
  const r = listAssets(f.root);
  assert.equal(r.assets.length, 5); // 2 indexed + rocket icon.png + launch.ogg + pad.rbxm; txt and .gitkeep ignored
  assert.deepEqual(r.counts, { all: 5, model: 2, icon: 1, sound: 1, image: 1, thumbnail: 0 });
  assert.equal(r.onRoblox, 1);
  const un = r.assets.find((a) => a.file === 'assets/sfx/launch.ogg');
  assert.deepEqual([un.kind, un.scope, un.indexed, un.tags], ['sound', 'studio', false, ['unindexed', 'sfx']]); // folder names become tags
  assert.equal(r.assets.find((a) => a.id === 'gone').missing, true);
  assert.equal(r.assets.find((a) => a.id === 'coin').missing, false);
  f.cleanup();
});

test('listAssets filters by search, kind and scope', () => {
  const f = fixture();
  assert.deepEqual(listAssets(f.root, { search: 'CURRENCY' }).assets.map((a) => a.id), ['coin']);
  assert.deepEqual(listAssets(f.root, { search: 'launch' }).assets.map((a) => a.name), ['launch.ogg']);
  assert.equal(listAssets(f.root, { kind: 'model' }).assets.length, 2);
  assert.equal(listAssets(f.root, { kind: 'all' }).assets.length, 5);
  assert.deepEqual(listAssets(f.root, { scope: 'game:space-agency' }).assets.map((a) => a.id), ['coin']);
  assert.equal(listAssets(f.root, { search: 'zzz' }).assets.length, 0);
  assert.equal(listAssets(f.root, { kind: 'model' }).counts.all, 5, 'counts ignore filters');
  f.cleanup();
});

test('listAssets with no index and no assets dir is empty', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-assets-'));
  assert.deepEqual(listAssets(root), { assets: [], counts: { all: 0, model: 0, icon: 0, sound: 0, image: 0, thumbnail: 0 }, onRoblox: 0 });
  fs.rmSync(root, { recursive: true, force: true });
});

test('addAsset validates, indexes, de-duplicates ids and updates by file', () => {
  const f = fixture();
  const a = addAsset(f.root, { name: 'Rocket icon', kind: 'icon', scope: 'studio', tags: ['rocket'], file: 'assets/ui/rocket icon.png' });
  assert.equal(a.id, 'rocket-icon');
  assert.equal(listAssets(f.root).assets.find((x) => x.id === 'rocket-icon').indexed, true);
  assert.equal(listAssets(f.root).assets.length, 5, 'no duplicate row for the same file');

  const again = addAsset(f.root, { name: 'Rocket icon v2', kind: 'icon', scope: 'studio', tags: [], file: 'assets/ui/rocket icon.png', robloxId: 999 });
  assert.equal(again.id, 'rocket-icon');
  assert.equal(again.robloxId, '999');
  assert.equal(listAssets(f.root).onRoblox, 2);

  f.put('assets/ui/other.png');
  assert.equal(addAsset(f.root, { name: 'Rocket icon', kind: 'icon', scope: 'studio', tags: [], file: 'assets/ui/other.png' }).id, 'rocket-icon-2');
  assert.ok(JSON.parse(fs.readFileSync(path.join(f.root, 'tools/agent-hq/assets.json'), 'utf8')).length >= 4);
  f.cleanup();
});

test('addAsset rejects bad input with status 400', () => {
  const f = fixture();
  const ok = { name: 'N', kind: 'icon', scope: 'studio', tags: [], file: 'assets/ui/coin.png' };
  const cases = [
    [{ ...ok, name: '' }, /name/],
    [{ ...ok, kind: 'video' }, /kind/],
    [{ ...ok, scope: 'everyone' }, /scope/],
    [{ ...ok, tags: Array(11).fill('t') }, /tags/],
    [{ ...ok, file: 'src/server/Main.server.luau' }, /under assets/],
    [{ ...ok, file: 'assets/../package.json' }, /under assets/],
    [{ ...ok, file: 'assets/missing.png' }, /does not exist/],
    [{ ...ok, robloxId: 'abc' }, /robloxId/],
  ];
  for (const [input, re] of cases) assert.throws(() => addAsset(f.root, input), (e) => e.status === 400 && re.test(e.message), JSON.stringify(input));
  f.cleanup();
});

test('the committed index only lists files that exist, and systems.md names real src files', () => {
  const index = JSON.parse(fs.readFileSync(path.join(realRoot, 'tools/agent-hq/assets.json'), 'utf8'));
  assert.ok(index.length >= 2);
  for (const a of index) assert.ok(fs.existsSync(path.join(realRoot, a.file)), a.file);
  assert.equal(listAssets(realRoot).assets.filter((a) => a.missing).length, 0);

  const md = readSystems(realRoot);
  const sections = md.split(/^## /m).slice(1);
  assert.ok(sections.length >= 12, 'at least a dozen systems');
  for (const s of sections) {
    const title = s.split('\n')[0];
    const files = [...s.matchAll(/`((?:src|tests)\/[\w./-]+\.luau)`/g)].map((m) => m[1]);
    assert.ok(files.some((f) => f.startsWith('src/')), `${title} names a src file`);
    for (const f of files) assert.ok(fs.existsSync(path.join(realRoot, f)), `${title}: ${f}`);
  }
});
