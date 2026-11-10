import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, saveMarketSnapshot } from '../db.mjs';
import { initHistory, recordPoints, sameTimeBaseline, historyView, gameDetail, upsertMeta, staleMetaIds } from '../market-history.mjs';

const H = 3600000;
const T0 = Date.parse('2026-10-01T00:00:00Z');
const at = (hours) => new Date(T0 + hours * H).toISOString();
const g = (id, name, playerCount, up = 90, down = 10) => ({ universeId: id, name, playerCount, up, down });
const snap = (hours, ...lists) => ({ fetchedAt: at(hours), sorts: lists.map(([id, name, games]) => ({ id, name, games })) });
const mem = () => { const db = openDb(':memory:'); initHistory(db); return db; };
const count = (db) => db.prepare('SELECT COUNT(*) AS n FROM game_points').get().n;

test('baseline: nearest to latest minus 24h at 6h cadence', () => {
  const ats = [0, 6, 12, 18, 24, 30, 36, 42, 48].map(at);
  assert.equal(sameTimeBaseline(ats, at(48)), at(24));
  // off the grid: the closer one wins, whichever side it is on
  assert.equal(sameTimeBaseline([0, 6, 12, 18, 25, 30, 36, 42, 48].map(at), at(48)), at(25));
  assert.equal(sameTimeBaseline([0, 6, 12, 18, 23, 30, 36, 42, 48].map(at), at(48)), at(23));
  // the latest itself is never its own baseline
  assert.equal(sameTimeBaseline([at(48)], at(48)), null);
});

test('baseline: null when nothing is within tolerance or history is under 24h', () => {
  assert.equal(sameTimeBaseline([0, 6, 12, 18].map(at), at(18)), null); // 18h of history
  assert.equal(sameTimeBaseline([at(0), at(40)], at(48)), null); // 8h and 24h away from the target, 3h tolerance
  assert.equal(sameTimeBaseline([], at(48)), null);
});

test('baseline: tolerance widens with the cadence', () => {
  assert.equal(sameTimeBaseline([at(18), at(42)], at(48), { cadenceHours: 6 }), null); // 6h from target, tolerance 3
  assert.equal(sameTimeBaseline([at(18), at(42)], at(48), { cadenceHours: 12 }), at(18)); // tolerance 6
  assert.equal(sameTimeBaseline([at(18), at(42)], at(48), { cadenceHours: 2 }), null); // never below 3h
});

test('recordPoints: one row per unique game, best rank, max players, lists', () => {
  const db = mem();
  const n = recordPoints(db, snap(0, ['a', 'A', [g(1, 'One', 100), g(2, 'Two', 50)]], ['b', 'B', [g(2, 'Two', 80, 3, 1), g(3, 'Three', 10, 0, 0)]]));
  assert.equal(n, 3);
  const rows = Object.fromEntries(db.prepare('SELECT * FROM game_points').all().map((r) => [r.universeId, { ...r }]));
  assert.deepEqual(rows[2], { universeId: 2, at: at(0), playing: 80, bestRank: 1, lists: 2, likePct: 90 });
  assert.equal(rows[3].likePct, null); // no votes
  recordPoints(db, snap(0, ['a', 'A', [g(1, 'One', 100)]])); // same snapshot again replaces, not duplicates
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_points WHERE at = ?').get(at(0)).n, 3);
});

test('recordPoints prunes rows older than 180 days, relative to the snapshot', () => {
  const db = mem();
  recordPoints(db, snap(0, ['a', 'A', [g(1, 'One', 1)]]));
  recordPoints(db, snap(179 * 24, ['a', 'A', [g(1, 'One', 2)]]));
  assert.equal(count(db), 2); // 179 days apart: both stay
  recordPoints(db, snap(181 * 24, ['a', 'A', [g(1, 'One', 3)]]));
  assert.deepEqual(db.prepare('SELECT playing FROM game_points ORDER BY at').all().map((r) => r.playing), [2, 3]); // day 0 is 181 days old
});

test('backfill from stored snapshots runs once', () => {
  const db = openDb(':memory:');
  for (const h of [0, 6, 12]) saveMarketSnapshot(db, snap(h, ['a', 'A', [g(1, 'One', 10 + h), g(2, 'Two', 5)]]));
  initHistory(db);
  assert.equal(count(db), 6);
  db.exec('DELETE FROM game_points WHERE universeId = 2');
  initHistory(db); // table is not empty, so nothing is refilled
  assert.equal(count(db), 3);
});

test('history on empty data is nulls and empty arrays', () => {
  const db = mem();
  const h = historyView(db, { fetchedAt: null, sorts: [] });
  assert.deepEqual(h, { snapshots: 0, since: null, baselineAt: null, playersDelta: null, biggestJump: null, rising: [], newOnCharts: [], rows: {} });
  recordPoints(db, snap(0, ['a', 'A', [g(1, 'One', 100)]]));
  const one = historyView(db, snap(0, ['a', 'A', [g(1, 'One', 100)]]));
  assert.deepEqual([one.snapshots, one.since, one.baselineAt, one.playersDelta, one.rising], [1, at(0), null, null, []]);
});

test('history: rising list, baseline, KPI numbers, why chips', () => {
  const db = mem();
  const at54 = (h, order, alpha, beta, tiny) => snap(h,
    ['trending', 'Trending', order.map((n) => (n === 'Alpha' ? g(1, 'Alpha', alpha) : n === 'Beta' ? g(2, 'Beta', beta) : g(3, 'Tiny', tiny)))],
    ['top-earning', 'Top earning', [g(9, 'Whale', 5000), g(1, 'Alpha', alpha)]]);
  for (let h = 0; h <= 48; h += 6) recordPoints(db, at54(h, ['Beta', 'Alpha', 'Tiny'], 1000, 800, 50));
  const latest = at54(54, ['Alpha', 'Beta', 'Tiny'], 1500, 700, 200);
  recordPoints(db, latest);
  const h = historyView(db, latest);
  assert.equal(h.baselineAt, at(30)); // 54 - 24
  assert.deepEqual([h.snapshots, h.since], [10, at(0)]);
  assert.equal(h.playersDelta, 500 - 100 + 150 + 0); // Alpha, Beta, Tiny and Whale, all present at both times
  assert.deepEqual(h.rising.map((r) => r.name), ['Alpha']); // Beta fell; Tiny had under 100 players yesterday
  assert.deepEqual(h.biggestJump, { universeId: 1, name: 'Alpha', deltaPct: 50 });
  const a = h.rising[0];
  assert.deepEqual([a.playing, a.deltaPlayers, a.deltaPct, a.rank, a.sortName, a.earningRank, a.likePct], [1500, 500, 50, 1, 'Trending', 2, 90]);
  assert.deepEqual(a.why, ['Up 1 place on Trending', '#2 top earning', '90% liked', 'On 2 lists']);
  assert.equal(a.spark.length, 10); // every point is inside the last 7 days
  assert.equal(h.rows[2].vsYesterdayPct, -12.5);
  assert.equal(h.rows[3].vsYesterdayPct, 300); // the table shows it even for a small game
  assert.equal(h.rows[9].earningRank, 1);
  assert.equal(h.rows[9].vsYesterdayPct, 0);
  assert.equal(h.rows[1].iconUrl, null);
  upsertMeta(db, { universeId: 1, name: 'Alpha', iconUrl: 'https://tr.rbxcdn.com/a.png' }, at(54));
  assert.equal(historyView(db, latest).rising[0].iconUrl, 'https://tr.rbxcdn.com/a.png');
});

test('history: isNew is false for everything until 7 days of coverage exist', () => {
  const db = mem();
  const at6 = (h) => snap(h, ['a', 'A', h >= 5 * 24 ? [g(1, 'Old', 100), g(2, 'Newcomer', 50)] : [g(1, 'Old', 100)]]);
  for (let h = 0; h <= 6 * 24; h += 6) recordPoints(db, at6(h));
  let v = historyView(db, at6(6 * 24));
  assert.deepEqual([v.rows[2].isNew, v.rows[1].isNew, v.newOnCharts], [false, false, []]); // only 6 days of history
  for (let h = 6 * 24 + 6; h <= 8 * 24; h += 6) recordPoints(db, at6(h));
  v = historyView(db, at6(8 * 24));
  assert.deepEqual([v.rows[1].isNew, v.rows[2].isNew], [false, true]); // Newcomer first seen on day 5, latest is day 8
  assert.deepEqual(v.newOnCharts.map((x) => [x.name, x.firstSeen]), [['Newcomer', at(5 * 24)]]);
});

test('meta: upsert keeps stored fields when the new value is null, and staleness', () => {
  const db = mem();
  const now = Date.parse('2026-10-20T00:00:00Z');
  const iso = (ms) => new Date(ms).toISOString();
  assert.deepEqual(staleMetaIds(db, [1, 2, 3], now), [1, 2, 3]); // no rows yet
  upsertMeta(db, [{ universeId: 1, name: 'One', iconUrl: 'https://x/1.png', visits: 10 }, { universeId: 2, name: 'Two' }], iso(now));
  upsertMeta(db, { universeId: 3, name: 'Three', iconUrl: 'https://x/3.png' }, iso(now - 8 * 24 * H));
  assert.deepEqual(staleMetaIds(db, [1, 2, 3], now), [2, 3]); // 2 has no icon, 3 is 8 days old
  upsertMeta(db, { universeId: 1, visits: 99 }, iso(now));
  const row = db.prepare('SELECT * FROM game_meta WHERE universeId = 1').get();
  assert.deepEqual([row.name, row.iconUrl, row.visits], ['One', 'https://x/1.png', 99]);
});

test('gameDetail: 30 days of points, ranks on the latest charts, stats null when off the charts', () => {
  const db = mem();
  const mk = (h, p) => snap(h, ['trending', 'Trending', [g(7, 'Other', 900), g(1, 'One', p)]], ['top-earning', 'Top earning', [g(1, 'One', p)]]);
  recordPoints(db, mk(0, 1)); // 40 days before the clock
  for (let d = 10; d <= 40; d += 10) recordPoints(db, mk(d * 24, d));
  const now = T0 + 40 * 24 * H;
  const d = gameDetail(db, '1', mk(40 * 24, 40), now);
  assert.deepEqual(d.series.map((s) => s.playing), [10, 20, 30, 40]); // day 0 is outside the 30-day window (rows are kept 180 days); day 10 is exactly 30 days back
  assert.deepEqual(d.ranks, [{ sortId: 'top-earning', sortName: 'Top earning', rank: 1 }, { sortId: 'trending', sortName: 'Trending', rank: 2 }]);
  assert.deepEqual([d.stats.playing, d.stats.likePct, d.stats.visits], [40, 90, null]);
  const off = gameDetail(db, 1, snap(40 * 24, ['trending', 'Trending', [g(7, 'Other', 900)]]), now);
  assert.deepEqual([off.ranks, off.stats.playing, off.stats.likePct], [[], null, null]);
  assert.equal(off.meta, null);
});
