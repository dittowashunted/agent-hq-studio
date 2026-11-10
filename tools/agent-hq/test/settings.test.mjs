import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSettings, projectName, readOwnerLessons } from '../briefs.mjs';
import { listAssets } from '../assets.mjs';
import { openDb } from '../db.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-settings-'));

test('no settings file: generic project name, no owner lessons, empty settings', () => {
  const root = tmp();
  assert.deepEqual(readSettings(root), {});
  assert.equal(projectName(root), 'this Roblox game');
  assert.deepEqual(readOwnerLessons(root), []);
});

test('project name and owner lessons come from settings, newest n only', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'agent-hq.settings.json'), JSON.stringify({ project: { name: 'Crime Empire' }, learning: { lessonsFile: 'notes/l.md' } }));
  fs.mkdirSync(path.join(root, 'notes'));
  fs.writeFileSync(path.join(root, 'notes/l.md'), '# Lessons\n\n- 2026-01-01: one\n- 2026-01-02: two\n- 2026-01-03: three\n');
  assert.equal(projectName(root), 'Crime Empire');
  assert.deepEqual(readOwnerLessons(root, 2), ['- 2026-01-02: two', '- 2026-01-03: three']);
});

test('default lessons file is memory/lessons.md; a lessons path outside the project is refused', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'memory'));
  fs.writeFileSync(path.join(root, 'memory/lessons.md'), '- 2026-01-01: default\n');
  assert.deepEqual(readOwnerLessons(root), ['- 2026-01-01: default']);
  fs.writeFileSync(path.join(root, 'agent-hq.settings.json'), JSON.stringify({ learning: { lessonsFile: '../outside.md' } }));
  assert.deepEqual(readOwnerLessons(root), []);
});

test('invalid settings JSON is ignored, not thrown', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'agent-hq.settings.json'), '{ not json');
  assert.deepEqual(readSettings(root), {});
  assert.equal(projectName(root), 'this Roblox game');
});

test('library: SVGs and images under assets/icons are icons, folders become tags', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'assets/icons/pack-a/artist'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets/ui/kit'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets/icons/pack-a/artist/coin.svg'), '<svg/>');
  fs.writeFileSync(path.join(root, 'assets/icons/pack-a/star.png'), '');
  fs.writeFileSync(path.join(root, 'assets/ui/kit/button.png'), '');
  const { assets, counts } = listAssets(root);
  const byName = Object.fromEntries(assets.map((a) => [a.name, a]));
  assert.equal(byName['coin.svg'].kind, 'icon');
  assert.equal(byName['star.png'].kind, 'icon');
  assert.equal(byName['button.png'].kind, 'image');
  assert.ok(byName['coin.svg'].tags.includes('artist') && byName['coin.svg'].tags.includes('pack-a'));
  assert.equal(counts.icon, 2);
  assert.equal(listAssets(root, { search: 'artist' }).assets.length, 1);
});

test('openDb seeds the first game from the given seed, else the original default', () => {
  const custom = openDb(':memory:', { slug: 'crime-empire', name: 'Crime Empire', stage: 'designed' });
  assert.deepEqual(custom.prepare('SELECT slug, name, stage FROM games').all().map((r) => ({ ...r })), [{ slug: 'crime-empire', name: 'Crime Empire', stage: 'designed' }]);
  const def = openDb(':memory:');
  assert.equal(def.prepare('SELECT slug FROM games').get().slug, 'space-agency');
});
