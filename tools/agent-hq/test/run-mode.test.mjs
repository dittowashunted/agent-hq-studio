import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../db.mjs';
import { pickEngine, cronFor, replyHint, defaultRunMode } from '../run-mode.mjs';
import { validateSetting } from '../settings-schema.mjs';

test('pickEngine: explicit, role choice, instant claude-cli for app roles, antigravity stays', () => {
  assert.equal(pickEngine({ runMode: 'instant', roleDefault: 'app' }), 'claude-cli');
  assert.equal(pickEngine({ runMode: 'hourly', roleDefault: 'app' }), 'app');
  assert.equal(pickEngine({ runMode: 'instant', roleDefault: 'antigravity' }), 'antigravity');
  assert.equal(pickEngine({ runMode: 'instant', roleDefault: 'app', pref: 'groq' }), 'groq');
  assert.equal(pickEngine({ runMode: 'instant', roleDefault: 'app', pref: 'groq', explicit: 'app' }), 'app');
  assert.equal(pickEngine({ runMode: 'hourly' }), 'app');
});

test('createTask follows the runMode setting', () => {
  const db = D.openDb(':memory:');
  D.setSetting(db, 'runMode', 'instant');
  assert.equal(D.createTask(db, { title: 'a', role: 'builder' }).engine, 'claude-cli');
  assert.equal(D.createTask(db, { title: 'b', role: 'builder', engine: 'app' }).engine, 'app');
  assert.equal(D.createTask(db, { title: 'c', role: 'designer' }).engine, 'antigravity');
  D.setSetting(db, 'roleEngines', { builder: { engine: 'groq' } });
  assert.equal(D.createTask(db, { title: 'd', role: 'builder' }).engine, 'groq');
  D.setSetting(db, 'runMode', 'hourly');
  D.setSetting(db, 'roleEngines', {});
  assert.equal(D.createTask(db, { title: 'e', role: 'builder' }).engine, 'app');
});

test('runMode setting: enum', () => {
  assert.equal(validateSetting('runMode', 'hourly'), 'hourly');
  assert.throws(() => validateSetting('runMode', 'sometimes'));
  assert.ok(['instant', 'hourly'].includes(defaultRunMode()));
});

test('cron from minutes; antigravity may check in every 5 minutes', () => {
  assert.equal(cronFor(5), '*/5 * * * *');
  assert.equal(cronFor(15), '*/15 * * * *');
  assert.equal(cronFor(120), '0 */2 * * *');
  assert.equal(cronFor(1440), '0 0 * * *');
  assert.equal(cronFor('nope'), '*/5 * * * *');
  const base = { enabled: true, everyMinutes: 5, activeFrom: '00:00', activeTo: '24:00', maxTasks: 6 };
  assert.equal(validateSetting('laneSchedules', { antigravity: base }).antigravity.everyMinutes, 5);
  assert.throws(() => validateSetting('laneSchedules', { antigravity: { ...base, everyMinutes: 4 } }));
  assert.match(replyHint('instant'), /about a minute/);
  assert.match(replyHint('hourly'), /within the hour/);
});
