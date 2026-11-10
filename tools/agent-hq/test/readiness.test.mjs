import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createReadiness, indexSkills } from '../readiness.mjs';

const put = (file, text = '# x\n') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-rd-'));
  const root = path.join(base, 'repo'); const home = path.join(base, 'home');
  put(path.join(root, '.claude/skills/hq-worker/SKILL.md'));
  put(path.join(root, '.agents/rules/art.md'));
  put(path.join(home, '.claude/skills/roblox-game-gate/SKILL.md'));
  put(path.join(home, '.claude/plugins/cache/mk/superpowers/1.0.0/skills/brainstorming/SKILL.md'));
  put(path.join(home, '.claude/plugins/cache/mk/taste-skill/1.0.0/skills/redesign-skill/SKILL.md'), '---\nname: redesign-existing-projects\n---\nbody\n');
  put(path.join(home, '.claude/plugins/cache/mk/grill/1.0.0/commands/roast.md'));
  put(path.join(home, '.claude/local-plugins/plan-exec/skills/plan-exec/SKILL.md'));
  put(path.join(home, '.claude/plugins/marketplaces/m1/plugins/viz/skills/charting/SKILL.md'));
  // a skill that is a link into another folder, as the Roblox skills are on the owner's PC
  put(path.join(base, 'elsewhere/roblox-vfx-forge/SKILL.md'));
  try { fs.symlinkSync(path.join(base, 'elsewhere/roblox-vfx-forge'), path.join(home, '.claude/skills/roblox-vfx-forge'), 'junction'); } catch { put(path.join(home, '.claude/skills/roblox-vfx-forge/SKILL.md')); }
  return { root, home };
}
const knowledge = (found = true) => ({
  status: async () => ({ sources: [{ id: 'lihfolk', label: 'LihFolk Vault V2', found, notes: found ? 10 : 0, words: found ? 500 : 0 }] }),
  quarantined: async () => [{ source: 'community', path: 'x/bad.md', rule: 'steers-agent' }],
});
const tools = (...have) => (name) => (have.includes(name) ? `/bin/${name}` : null);

test('indexSkills sees folders, front-matter names, plugin prefixes and commands', () => {
  const names = indexSkills(fixture());
  for (const n of ['hq-worker', 'roblox-game-gate', 'brainstorming', 'superpowers:brainstorming', 'redesign-skill', 'taste-skill:redesign-existing-projects', 'grill:roast', 'roblox-vfx-forge', 'plan-exec:plan-exec', 'viz:charting']) assert.ok(names.has(n), n);
  assert.ok(!names.has('ghost'));
});

test('readiness names every missing tool, knowledge folder and skill', async () => {
  const fx = fixture();
  const roles = [{
    id: 'ui', label: 'UI', enabled: true, rules: ['a', 'b'], chapters: [5, 8],
    skills: [{ name: 'superpowers:brainstorming' }, { name: 'ghost-skill' }, { name: '.agents/rules/art.md' }, { name: '.agents/rules/none.md' }, { name: 'run' }, { name: 'roblox-game-gate' }],
  }, { id: 'off', label: 'Off', enabled: false, rules: [], chapters: [], skills: [{ name: 'ghost-two' }] }];
  const r = await createReadiness({ ...fx, find: tools('python', 'claude'), knowledge: knowledge(false), getRoles: () => roles })();
  assert.equal(r.ok, false);
  assert.deepEqual(r.tools.python, { found: true, path: '/bin/python' });
  assert.deepEqual(r.tools.rojo, { found: false });
  assert.deepEqual(r.roles[0].missing, ['ghost-skill', '.agents/rules/none.md']);
  assert.equal(r.roles[0].skills.filter((s) => s.found).length, 4);
  assert.deepEqual([r.roles[0].rules, r.roles[0].chapters], [2, 2]);
  assert.deepEqual(r.missing.sort(), ['knowledge: LihFolk Vault V2', 'skill: .agents/rules/none.md (UI)', 'skill: ghost-skill (UI)', 'tool: rojo'].sort()); // a turned-off role's gaps are not counted
  assert.deepEqual(r.quarantined, [{ source: 'community', path: 'x/bad.md', rule: 'steers-agent' }]);
  assert.equal(r.knowledge[0].found, false);
  assert.ok(Date.parse(r.at));
});

test('readiness is ok when nothing is missing', async () => {
  const fx = fixture();
  const r = await createReadiness({ ...fx, find: tools('python', 'claude', 'rojo'), knowledge: knowledge(true), getRoles: () => [{ id: 'ui', label: 'UI', skills: [{ name: 'hq-worker' }] }] })();
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
});
