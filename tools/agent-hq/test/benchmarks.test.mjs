import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBenchmarks } from '../market.mjs';

const REPORT = 'https://www.gameanalytics.com/reports/2026-roblox-report';
const rows = loadBenchmarks();
const ga26 = rows.filter((r) => r.id.startsWith('ga26-'));
const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

test('benchmark ids are unique and every row has the same fields', () => {
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  for (const r of rows) {
    for (const k of ['id', 'benchmark', 'target', 'measuredBy', 'tier', 'failureMeaning', 'source', 'label']) assert.ok(typeof r[k] === 'string' && r[k].trim(), `${r.id}.${k}`);
    assert.ok(['gate', 'health', 'watch'].includes(r.tier), `${r.id} tier`);
  }
});

test('the GameAnalytics 2026 rows are watch items that link the report and carry the large-games caveat', () => {
  assert.deepEqual(ga26.map((r) => r.id), ['ga26-d1', 'ga26-d7', 'ga26-d30', 'ga26-session-length', 'ga26-sessions-per-day', 'ga26-arppu', 'ga26-paying-share', 'ga26-device-mix']);
  for (const r of ga26) {
    assert.equal(r.source, REPORT, r.id);
    assert.match(r.label, /GameAnalytics 2026/, r.id);
    assert.match(r.label, /large games only/i, r.id);
    // Device mix comes from the full 17,000+ game pool, so it names that sample instead of the large-games caveat.
    if (r.id === 'ga26-device-mix') assert.match(r.label, /17,000\+/, r.id);
    else assert.match(r.label, /not expected to reach the median/i, r.id);
    assert.equal(r.tier, 'watch', r.id);
  }
});

test('the 2026 numbers are the ones from the report', () => {
  assert.match(byId['ga26-d1'].target, /p25 8\.4%.*p50 10\.3%.*p75 12\.9%.*p90 15\.9%.*p99 22\.2%/);
  assert.match(byId['ga26-d7'].target, /p25 1\.0%.*p50 1\.6%.*p75 2\.5%.*p90 3\.9%.*p99 9\.1%/);
  assert.match(byId['ga26-d30'].target, /p25 0\.3%.*p50 0\.5%.*p75 0\.9%.*p90 2\.0%.*p99 4\.7%/);
  assert.match(byId['ga26-session-length'].target, /9\.8 minutes/);
  assert.match(byId['ga26-sessions-per-day'].target, /1\.56/);
  assert.match(byId['ga26-arppu'].target, /\$0\.70.*\$2\.33/);
  assert.match(byId['ga26-paying-share'].target, /3\.8%/);
  assert.match(byId['ga26-device-mix'].target, /44%.*40\.8%.*11\.6%/);
});

test('mobile-game numbers and the bloxg and rolearn claims are not in the file', () => {
  const text = JSON.stringify(rows);
  assert.doesNotMatch(text, /bloxg|rolearn/i);
  assert.doesNotMatch(text, /2026-mobile-pc-gaming-benchmarks/);
  for (const r of ga26) assert.doesNotMatch(`${r.target} ${r.benchmark}`, /18 to 35|40 to 50|just above 30|under 4%|about 0\.7%/i, r.id);
});

test('the older retention and session rows keep their targets (the 2026 rows only add)', () => {
  assert.match(byId.d1.target, /^12 to 15%/);
  assert.match(byId.d7.target, /^2 to 3%/);
  assert.match(byId.d30.target, /^0\.5 to 1\.5%/);
  assert.match(byId['session-length'].target, /^At least 10 min/);
  assert.ok(!/annotat|superseded/i.test(JSON.stringify([byId.d1, byId.d7, byId.d30, byId['session-length']])), 'no note was added to them');
});
