import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, createAsk, answerAsk, addMessage, createTask } from '../db.mjs';
import { roleStats, statsSection } from '../feedback.mjs';

const seeded = () => {
  const db = openDb(':memory:');
  const ask = (verdict, note) => { const a = createAsk(db, { role: 'builder', kind: 'review', title: 'T' }); answerAsk(db, a.id, { answer: verdict, verdict, verdictNote: note }); };
  ask('approved', null); ask('approved', 'nice'); ask('changes', 'button too small'); ask('rejected', 'wrong colour');
  addMessage(db, { role: 'builder', from: 'owner', text: 'Looks good: Shop UI' });
  addMessage(db, { role: 'builder', from: 'owner', text: 'Needs changes on "Shop UI": use the house font' });
  addMessage(db, { role: 'builder', from: 'agent', text: 'Looks good: not the owner' }); // ignored: not from the owner
  addMessage(db, { role: 'ui', from: 'owner', text: 'Looks good: other role' });
  createTask(db, { title: 'Rework: Shop UI', role: 'builder', createdBy: 'owner', reworkCount: 1 });
  createTask(db, { title: 'Plain', role: 'builder', createdBy: 'owner' });
  return db;
};

test('roleStats counts verdicts, task verdicts and reworks for one role, newest reasons first', () => {
  const s = roleStats(seeded(), 'builder');
  assert.deepEqual([s.approved, s.changes, s.rejected, s.reworks], [3, 2, 1, 1]);
  assert.equal(s.recent.length, 3);
  assert.ok(s.recent.includes('use the house font') && s.recent.includes('wrong colour') && s.recent.includes('button too small'));
  assert.deepEqual(roleStats(seeded(), 'scout'), { approved: 0, changes: 0, rejected: 0, reworks: 0, recent: [], days: 30 });
});

test('roleStats only looks at the window', () => {
  const s = roleStats(seeded(), 'builder', { days: 30, now: Date.now() + 40 * 86400000 });
  assert.deepEqual([s.approved, s.changes, s.rejected, s.reworks], [0, 0, 0, 0]);
});

test('statsSection: 4 body lines at most, nothing without data', () => {
  assert.equal(statsSection(seeded(), 'scout'), null);
  assert.equal(statsSection(undefined, 'builder'), null);
  const sec = statsSection(seeded(), 'builder');
  assert.match(sec, /^## How your recent work landed\nLast 30 days: 3 approved, 2 sent back with changes, 1 rejected, 1 reworks\./);
  assert.ok(sec.split('\n').length - 1 <= 4);
});
