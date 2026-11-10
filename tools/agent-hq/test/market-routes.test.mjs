import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const HOUR = 3600000;
const opened = [];
after(async () => { for (const s of opened) await s.close().catch(() => {}); });

// A server with a fake clock, charts and fetchers: nothing here reaches the network.
async function boot({ games = [[1, 'Alpha', 1000], [2, 'Beta', 800]], fetchers = {} } = {}) {
  const clock = { ms: Date.parse('2026-10-20T00:00:00Z') };
  const calls = { icons: [], details: [] };
  const s = await startServer({
    root, port: 0, stateDir: fs.mkdtempSync(path.join(os.tmpdir(), 'hq-mkt-')), now: () => clock.ms,
    fetchCharts: async () => ({ fetchedAt: new Date(clock.ms).toISOString(), sorts: [{ id: 'top', name: 'Top', games: games.map(([universeId, name, playerCount]) => ({ universeId, name, playerCount, up: 9, down: 1, genre: '', sponsored: false })) }] }),
    fetchers: {
      details: async (ids) => { calls.details.push(ids); return Object.fromEntries(ids.map((id) => [id, { visits: 5e6, favorites: 7, created: '2020-01-01T00:00:00Z', creator: 'Studio', maxPlayers: 20 }])); },
      icons: async (ids) => { calls.icons.push(ids); return Object.fromEntries(ids.map((id) => [id, `https://tr.rbxcdn.com/${id}.png`])); },
      ...fetchers,
    },
  });
  opened.push(s);
  const base = `http://127.0.0.1:${s.port}`;
  const api = async (method, p, body, token = s.ownerToken) => {
    const r = await fetch(base + p, { method, headers: { ...(token ? { 'x-hq-token': token } : {}), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  return { s, base, api, clock, calls };
}

test('GET /api/market keeps its old fields and adds an empty history', async () => {
  const { api } = await boot();
  const r = (await api('GET', '/api/market')).json;
  assert.deepEqual([r.latest.fetchedAt, r.previous, r.sorts], [null, null, []]);
  assert.deepEqual(r.velocity, { moves: [], perSort: {} });
  assert.deepEqual(r.history, { snapshots: 0, since: null, baselineAt: null, playersDelta: null, biggestJump: null, rising: [], newOnCharts: [], rows: {} });
});

test('refresh records points and icons, and only stale ids are fetched again', async () => {
  const { api, clock, calls } = await boot();
  const first = (await api('POST', '/api/market/refresh')).json;
  assert.deepEqual(calls.icons, [[1, 2]]); // busiest first
  assert.equal(first.history.snapshots, 1);
  assert.equal(first.history.rows[1].iconUrl, 'https://tr.rbxcdn.com/1.png');
  clock.ms += 6 * HOUR;
  await api('POST', '/api/market/refresh');
  assert.equal(calls.icons.length, 1); // both have an icon and fresh meta
  clock.ms += 8 * 24 * HOUR;
  await api('POST', '/api/market/refresh');
  assert.equal(calls.icons.length, 2); // meta is now older than 7 days
});

test('same-time baseline: 6h of history gives none, 24h gives vs-yesterday numbers', async () => {
  const { api, clock } = await boot();
  await api('POST', '/api/market/refresh');
  clock.ms += 6 * HOUR;
  let r = (await api('POST', '/api/market/refresh')).json;
  assert.equal(r.history.baselineAt, null); // 6h of history is not "yesterday"
  assert.equal(r.history.rows[1].vsYesterdayPct, null);
  clock.ms += 18 * HOUR;
  r = (await api('POST', '/api/market/refresh')).json;
  assert.equal(r.history.baselineAt, '2026-10-20T00:00:00.000Z');
  assert.equal(r.history.rows[1].vsYesterdayPct, 0);
  assert.equal(r.history.playersDelta, 0);
});

test('marketEveryHours 0 invents no baseline', async () => {
  const { api, clock } = await boot();
  await api('POST', '/api/settings', { key: 'marketEveryHours', value: 0 });
  await api('POST', '/api/market/refresh');
  clock.ms += 3 * HOUR;
  const r = (await api('POST', '/api/market/refresh')).json;
  assert.deepEqual([r.history.baselineAt, r.history.playersDelta, r.history.rising, r.history.biggestJump], [null, null, [], null]);
});

test('a meta failure leaves the refresh OK and the snapshot saved', async () => {
  const { api } = await boot({ fetchers: { icons: async () => { throw new Error('icons down'); } } });
  const r = await api('POST', '/api/market/refresh');
  assert.equal(r.status, 200);
  assert.equal(r.json.metaError, 'icons down');
  assert.equal(r.json.latest.sorts.length, 1);
  assert.equal(r.json.history.snapshots, 1); // the points were written before the icons failed
});

test('GET /api/market/games/:id needs the token, a numeric id, and known data', async () => {
  const { api, base } = await boot({ fetchers: { details: async () => ({}), icons: async () => ({}) } }); // Roblox knows nothing about 99
  assert.equal((await fetch(`${base}/api/market/games/1`)).status, 401);
  for (const bad of ['abc', '1.5', '1234567890123456', '1%20or%201']) assert.equal((await api('GET', `/api/market/games/${bad}`)).status, 400, bad);
  assert.equal((await api('GET', '/api/market/games/99')).status, 404); // never seen
});

test('game detail: series, ranks, stats, meta cached for a day and kept when the fetch fails', async () => {
  let fail = false;
  const { api, clock, calls } = await boot({ fetchers: { details: async (ids) => { if (fail) throw new Error('down'); return { [ids[0]]: { visits: 123, favorites: 4, created: '2020-01-01T00:00:00Z', creator: 'Studio', maxPlayers: 12 } }; } } });
  for (let i = 0; i < 3; i++) { await api('POST', '/api/market/refresh'); clock.ms += 6 * HOUR; }
  const d = (await api('GET', '/api/market/games/1')).json;
  assert.equal(d.universeId, 1);
  assert.equal(d.series.length, 3);
  assert.deepEqual(d.ranks, [{ sortId: 'top', sortName: 'Top', rank: 1 }]);
  assert.deepEqual([d.stats.playing, d.stats.likePct, d.stats.visits, d.stats.favorites], [1000, 90, 123, 4]);
  assert.deepEqual([d.meta.name, d.meta.iconUrl, d.meta.creator], ['Alpha', 'https://tr.rbxcdn.com/1.png', 'Studio']);
  const iconCalls = calls.icons.length;
  await api('GET', '/api/market/games/1'); // meta is fresh: no new fetch
  assert.equal(calls.icons.length, iconCalls);
  clock.ms += 25 * HOUR;
  fail = true;
  const again = await api('GET', '/api/market/games/1');
  assert.equal(again.status, 200);
  assert.equal(again.json.meta.visits, 123); // cached values survive the failed refetch
});

test('the page CSP lets Roblox icon hosts load', async () => {
  const { base } = await boot();
  const csp = (await fetch(`${base}/`)).headers.get('content-security-policy');
  assert.match(csp, /img-src [^;]*https:\/\/\*\.rbxcdn\.com/);
  assert.match(csp, /img-src [^;]*https:\/\/cdn\.polyhaven\.com/);
});
