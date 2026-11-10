import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRoleOverrides, mergeRole, validateOverride } from '../role-overrides.mjs';

const role = { id: 'ui', label: 'UI', rules: ['a'], skills: [{ name: 's1', when: 'always' }] };

test('merge adds rules and skills, keeps the base, and reports enabled', () => {
  const m = mergeRole(role, { extraRules: ['b'], extraSkills: ['s1', 'x:y'], enabled: false });
  assert.deepEqual(m.rules, ['a', 'b']);
  assert.deepEqual(m.skills.map((s) => s.name), ['s1', 'x:y']);
  assert.equal(m.skills[1].when, 'Owner added this skill.');
  assert.equal(m.enabled, false);
  assert.equal(mergeRole(role).enabled, true);
  assert.deepEqual(mergeRole(role).rules, ['a']);
});

test('validation limits', () => {
  assert.deepEqual(validateOverride({ extraRules: [' hi ', ''] }), { extraRules: ['hi'] });
  assert.throws(() => validateOverride({ extraRules: Array(13).fill('x') }), /up to 12/);
  assert.throws(() => validateOverride({ extraRules: ['x'.repeat(201)] }), /too long/);
  assert.throws(() => validateOverride({ extraSkills: Array(9).fill('a') }), /up to 8/);
  assert.throws(() => validateOverride({ extraSkills: ['bad skill!'] }), /skill/);
  assert.throws(() => validateOverride({ enabled: 'no' }), /boolean/);
  assert.throws(() => validateOverride([]), /object/);
});

test('set merges into the stored file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-ro-'));
  const o = createRoleOverrides({ stateDir: dir });
  o.set('ui', { enabled: false });
  o.set('ui', { extraRules: ['r'] });
  assert.deepEqual(o.read().ui, { enabled: false, extraRules: ['r'] });
  assert.equal(o.merged([role])[0].enabled, false);
  assert.equal(o.merged([{ ...role, id: 'x' }])[0].enabled, true);
});
