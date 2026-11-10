import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_SCHEMA, DEFAULT_SETTINGS, validateSetting } from '../settings-schema.mjs';

const ROLES = ['lead', 'builder', 'ui', 'scout', 'designer'];

test('every field is fully described and in a known section', () => {
  const sections = new Set(SETTINGS_SCHEMA.sections.map((s) => s.id));
  for (const f of SETTINGS_SCHEMA.fields) {
    for (const k of ['key', 'label', 'type', 'section', 'help']) assert.ok(typeof f[k] === 'string' && f[k], `${f.key}.${k}`);
    assert.ok(f.default !== undefined, `${f.key}.default`);
    assert.ok(sections.has(f.section), `${f.key} section`);
    if (f.type === 'enum') assert.ok(f.options.length >= 2, `${f.key} options`);
    if (f.type === 'int' || f.type === 'number') assert.ok(Number.isFinite(f.min) && Number.isFinite(f.max), `${f.key} range`);
  }
  assert.equal(new Set(SETTINGS_SCHEMA.fields.map((f) => f.key)).size, SETTINGS_SCHEMA.fields.length);
});

test('defaults pass validation', () => {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) assert.deepEqual(validateSetting(k, v, ROLES), v, k);
  assert.equal(DEFAULT_SETTINGS.dailySpendCap, 0);
  assert.equal(DEFAULT_SETTINGS.screenshotCap, 4);
  assert.equal(DEFAULT_SETTINGS.replyStyle, 'terse');
});

test('each type rejects bad values', () => {
  assert.throws(() => validateSetting('paused', 'yes'), /boolean/);
  assert.throws(() => validateSetting('budget', 5), /1\.\.4/);
  assert.throws(() => validateSetting('budget', 1.5), /integer/);
  assert.throws(() => validateSetting('screenshotCap', 13), /0\.\.12/);
  assert.throws(() => validateSetting('dailySpendCap', -1), /number/);
  assert.throws(() => validateSetting('dailySpendCap', 501), /number/);
  assert.throws(() => validateSetting('dailySpendCap', Infinity), /number/);
  assert.equal(validateSetting('dailySpendCap', 12.345), 12.35);
  assert.throws(() => validateSetting('theme', 'blue'), /one of/);
  assert.throws(() => validateSetting('studioLanes', 3), /one of/);
  assert.equal(validateSetting('studioLanes', 'all'), 'all');
  assert.throws(() => validateSetting('ownerName', 'x'.repeat(41)), /too long/);
  assert.throws(() => validateSetting('ownerName', 5), /string/);
  assert.throws(() => validateSetting('nope', 1), /unknown/);
  assert.throws(() => validateSetting('providers', {}), /unknown/);
});

test('custom keys keep their rules', () => {
  assert.throws(() => validateSetting('roleEngines', { ghost: { engine: 'app' } }, ROLES), /unknown role/);
  assert.throws(() => validateSetting('roleEngines', { lead: { engine: 'app', model: 'gpt' } }, ROLES), /must be one of/);
  assert.deepEqual(validateSetting('roleEngines', { lead: { engine: 'antigravity', model: 'x' } }, ROLES), { lead: { engine: 'antigravity', model: null } });
  assert.throws(() => validateSetting('laneSchedules', { app: { activeFrom: '25:00' } }), /HH:MM/);
  assert.throws(() => validateSetting('schedules', [{ role: 'ghost', title: 't', everyMinutes: 5 }], ROLES), /schedule.role/);
});

test('paths and the notebook link are checked', () => {
  const abs = process.platform === 'win32' ? 'C:\\vault' : '/vault';
  assert.equal(validateSetting('knowledgeLihfolk', ''), '');
  assert.equal(validateSetting('knowledgeLihfolk', abs), abs);
  assert.throws(() => validateSetting('knowledgeLihfolk', 'relative/dir'), /absolute/);
  assert.throws(() => validateSetting('knowledgeReferences', `${abs}${String.fromCharCode(7)}x`), /control/);
  assert.throws(() => validateSetting('knowledgeLihfolk', abs + 'a'.repeat(300)), /too long/);
  assert.equal(validateSetting('notebookDoc', ' https://docs.google.com/document/d/abc_123-x/edit '), 'https://docs.google.com/document/d/abc_123-x/edit');
  assert.throws(() => validateSetting('notebookDoc', 'https://evil.example/document/d/abc'), /docs.google.com/);
  assert.throws(() => validateSetting('notebookDoc', 'http://docs.google.com/document/d/abc'), /docs.google.com/);
});

test('partnerAccess defaults and validation', () => {
  const ids = ['scout', 'designer', 'builder'];
  assert.deepEqual(DEFAULT_SETTINGS.partnerAccess, { enabled: false, autoRoles: [], dailyLimit: 0 }); // off until the owner opts in
  assert.deepEqual(validateSetting('partnerAccess', { enabled: true, autoRoles: ['scout', 'scout'], dailyLimit: 5 }, ids), { enabled: true, autoRoles: ['scout'], dailyLimit: 5 });
  assert.throws(() => validateSetting('partnerAccess', { autoRoles: ['lead'] }, ['lead']), /cannot run/); // the Lead delegates, so never
  assert.throws(() => validateSetting('partnerAccess', { autoRoles: ['builder'] }, ids), /cannot run/);
});
