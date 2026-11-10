import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePitch } from '../pitches.mjs';

const full = {
  title: '  Tide Runners  ',
  oneLiner: 'Race the tide.',
  format: 'obby-race',
  window: 'early',
  origin: 'scout',
  edge: 'Co-op timing',
  competitors: [{ name: 'Rivals', whatItIs: 'Shooter', gap: 'No co-op', universeId: 6035872082 }],
  comparables: [{ name: 'Fisch', universeId: 5750914919, playing: 358975, likeRatio: 91, upvotesPerDay: 1200, rankClimb: 4, note: 'rising' }],
  money: { verdict: 'Plausible', topEarningRank: 12, comparable: 'Fisch' },
  saturationCount: 7,
  game: { howItPlays: 'Run', first60s: 'Jump', goal10to15: 'Finish', minutes10to20: 'Upgrade', monetization: 'Cosmetics', clipMoment: 'Wave', iconIdea: 'Wave and runner', modules: ['Net', 'Launch'] },
  evidence: { summary: 'Charts', links: ['https://create.roblox.com/docs/discovery'] },
  building: { gaps: ['Wave VFX'], assetNotes: 'Free sounds', experience: 'One week' },
  risks: ['Saturation'],
};

test('full schema normalizes and trims', () => {
  const p = normalizePitch(full);
  assert.equal(p.title, 'Tide Runners');
  assert.equal(p.window, 'early');
  assert.equal(p.competitors[0].universeId, 6035872082);
  assert.equal(p.comparables[0].likeRatio, 91);
  assert.deepEqual(p.game.modules, ['Net', 'Launch']);
  assert.deepEqual(p.evidence.links, ['https://create.roblox.com/docs/discovery']);
  assert.equal(p.money.topEarningRank, 12);
  assert.deepEqual(p.risks, ['Saturation']);
  assert.deepEqual(normalizePitch(p), p, 'idempotent');
});

test('minimal input gets safe defaults; legacy flat form still works', () => {
  const p = normalizePitch({ title: 'T', oneLiner: 'o', coreLoop: 'loop', evidence: 'some evidence', risks: 'one risk' });
  assert.equal(p.origin, 'scout');
  assert.equal(p.window, null);
  assert.equal(p.game.howItPlays, 'loop');
  assert.equal(p.evidence.summary, 'some evidence');
  assert.deepEqual(p.risks, ['one risk']);
  assert.deepEqual(p.competitors, []);
  assert.equal(p.saturationCount, null);
});

test('invalid input throws with status 400', () => {
  const cases = [
    [null, /object/],
    [{ oneLiner: 'x' }, /title is required/],
    [{ title: 'x' }, /oneLiner is required/],
    [{ ...full, window: 'someday' }, /window must be/],
    [{ ...full, origin: 'robot' }, /origin must be/],
    [{ ...full, title: 'x'.repeat(201) }, /too long/],
    [{ ...full, edge: 'x'.repeat(2001) }, /too long/],
    [{ ...full, risks: Array(21).fill('r') }, /too many/],
    [{ ...full, competitors: [{ gap: 'x' }] }, /name is required/],
    [{ ...full, comparables: [{ name: 'a', playing: -1 }] }, /playing must be/],
    [{ ...full, comparables: [{ name: 'a', universeId: 1.5 }] }, /universeId must be an integer/],
    [{ ...full, evidence: { summary: 's', links: ['javascript:alert(1)'] } }, /http\(s\) link/],
    [{ ...full, game: { modules: 'Net' } }, /modules must be an array/],
    [{ ...full, saturationCount: 'many' }, /saturationCount must be/],
  ];
  for (const [input, re] of cases) {
    assert.throws(() => normalizePitch(input), (e) => e.status === 400 && re.test(e.message), JSON.stringify(input)?.slice(0, 60));
  }
});

test('look is optional, limited to stud, stylized or realistic, and only present when set', () => {
  assert.ok(!('look' in normalizePitch(full)), 'older pitches keep their shape');
  assert.ok(!('look' in normalizePitch({ ...full, look: '' })));
  assert.ok(!('look' in normalizePitch({ ...full, look: null })));
  for (const look of ['stud', 'stylized', 'realistic']) assert.equal(normalizePitch({ ...full, look }).look, look);
  for (const look of ['Stud', 'cartoon', 3, {}]) assert.throws(() => normalizePitch({ ...full, look }), /look must be one of stud, stylized, realistic/);
});
