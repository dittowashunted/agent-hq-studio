import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../db.mjs';
import { createSpendGuard, spentSince } from '../spend.mjs';

const T0 = new Date(2026, 5, 10, 15, 0, 0).getTime();
function setup() {
  const db = D.openDb(':memory:');
  const messages = []; const events = [];
  let clock = T0;
  const check = createSpendGuard({ db, now: () => clock, emit: (t, p) => events.push([t, p]), postMessage: (m) => messages.push(m) });
  const spend = (usd, at = clock) => { const t = D.createTask(db, { title: 't', role: 'builder' }); D.updateTask(db, t.id, { state: 'done', startedAt: new Date(at).toISOString(), costUsd: usd }); };
  return { db, messages, events, check, spend, tick: (ms) => { clock += ms; } };
}

test('spentSince sums only tasks started since', () => {
  const { db, spend } = setup();
  spend(1.5); spend(2); spend(9, T0 - 86400000);
  assert.equal(spentSince(db, new Date(2026, 5, 10).toISOString()), 3.5);
});

test('no cap means no pause', () => {
  const { check, spend, db } = setup();
  spend(400);
  assert.equal(check(), false);
  assert.equal(D.getSetting(db, 'paused', false), false);
});

test('the cap pauses once, posts one message, and never resumes by itself', () => {
  const { check, spend, db, messages, events, tick } = setup();
  D.setSetting(db, 'dailySpendCap', 5);
  spend(2);
  assert.equal(check(), false);
  spend(3.25);
  assert.equal(check(), true);
  assert.equal(D.getSetting(db, 'paused', false), true);
  assert.equal(messages.length, 1);
  assert.match(messages[0].text, /Agents paused: today's spend is \$5\.25, your daily cap is \$5\.00\. Raise the cap or resume in Settings\./);
  assert.deepEqual(events[0], ['settings', { key: 'paused', value: true }]);
  assert.equal(check(), true); assert.equal(messages.length, 1);
  // the owner resumes: the same cap does not trip again today
  D.setSetting(db, 'paused', false);
  assert.equal(check(), false);
  assert.equal(messages.length, 1);
  // a higher cap that is reached later pauses again, but the day's one message stays one
  D.setSetting(db, 'dailySpendCap', 6);
  spend(1);
  tick(1000);
  assert.equal(check(), true);
  assert.equal(messages.length, 1);
  // tomorrow, spend resets: no pause
  D.setSetting(db, 'paused', false);
  tick(86400000);
  assert.equal(check(), false);
});
