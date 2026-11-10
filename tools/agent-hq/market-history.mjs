// Per-game chart history. One point per game per snapshot (game_points, kept 180 days) and cached game details
// (game_meta: icon, visits, ...). Tables are created here with CREATE TABLE IF NOT EXISTS, not in db.mjs.
// Pure functions of (db, snapshot, clock); no network. market-routes.mjs does the fetching.
import { latestMarketSnapshots } from './db.mjs';

const HOUR = 3600000;
const DAY = 24 * HOUR;
export const RETAIN_DAYS = 180;
const MIN_BASE = 100; // under this many players at the baseline a % change says nothing, so the game is not ranked as rising
const RISING_MAX = 16;
const NEW_MAX = 20;
const pct1 = (n) => Math.round(n * 10) / 10;
const iso = (ms) => new Date(ms).toISOString();

export function inTx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/** Create the tables; when game_points is empty, fill it once from the stored full snapshots (oldest first). */
export function initHistory(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS game_points (universeId INTEGER, at TEXT, playing INTEGER, bestRank INTEGER, lists INTEGER, likePct REAL, PRIMARY KEY(universeId, at)) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS game_points_at ON game_points(at);
    CREATE TABLE IF NOT EXISTS game_meta (universeId INTEGER PRIMARY KEY, name TEXT, iconUrl TEXT, visits INTEGER, favorites INTEGER, created TEXT, creator TEXT, maxPlayers INTEGER, updatedAt TEXT);`);
  if (!db.prepare('SELECT 1 FROM game_points LIMIT 1').get()) for (const snap of latestMarketSnapshots(db, 30).reverse()) recordPoints(db, snap);
}

/** One entry per unique game: Map(universeId -> { name, playing (max over lists), rank (best), sortName, lists, like (whole %), earning }). */
function flatten(snap) {
  const out = new Map();
  for (const s of snap?.sorts ?? []) {
    (s.games ?? []).forEach((g, i) => {
      const id = Number(g.universeId);
      if (!Number.isSafeInteger(id)) return;
      const p = out.get(id) ?? { name: g.name, playing: 0, rank: Infinity, sortName: null, lists: 0, like: null, earning: null };
      p.playing = Math.max(p.playing, g.playerCount ?? 0);
      if (i + 1 < p.rank) { p.rank = i + 1; p.sortName = s.name; }
      p.lists++;
      if (p.like === null && g.up + g.down > 0) p.like = Math.round((g.up / (g.up + g.down)) * 100);
      if (s.id === 'top-earning' && p.earning === null) p.earning = i + 1;
      out.set(id, p);
    });
  }
  return out;
}

/** Write one row per unique game for this snapshot and drop rows older than 180 days (relative to the snapshot). Returns the row count. */
export function recordPoints(db, snap) {
  const t = Date.parse(snap?.fetchedAt);
  if (Number.isNaN(t)) return 0;
  const games = flatten(snap);
  const ins = db.prepare('INSERT OR REPLACE INTO game_points (universeId, at, playing, bestRank, lists, likePct) VALUES (?,?,?,?,?,?)');
  inTx(db, () => {
    for (const [id, p] of games) ins.run(id, iso(t), p.playing, p.rank, p.lists, p.like);
    db.prepare('DELETE FROM game_points WHERE at < ?').run(iso(t - RETAIN_DAYS * DAY));
  });
  return games.size;
}

/**
 * The stored `at` nearest to (latest - hours), within max(3, cadenceHours / 2) hours of it, or null.
 * Null also when the history is too short to reach back that far (nothing lands inside the tolerance).
 */
export function sameTimeBaseline(ats, latestAt, { hours = 24, cadenceHours = 6 } = {}) {
  const latest = Date.parse(latestAt);
  const target = latest - hours * HOUR;
  const tol = Math.max(3, cadenceHours / 2) * HOUR;
  let best = null; let bestD = Infinity;
  for (const at of ats) {
    const ms = Date.parse(at);
    const d = Math.abs(ms - target);
    if (ms < latest && d <= tol && d < bestD) { best = at; bestD = d; }
  }
  return best;
}

const EMPTY = { snapshots: 0, since: null, baselineAt: null, playersDelta: null, biggestJump: null, rising: [], newOnCharts: [], rows: {} };

/** The `history` block of GET /api/market (contract C7). `latest` is the newest full snapshot. Never throws on empty data. */
export function historyView(db, latest, { cadenceHours = 6 } = {}) {
  const ats = db.prepare('SELECT DISTINCT at FROM game_points ORDER BY at').all().map((r) => r.at);
  const latestMs = Date.parse(latest?.fetchedAt);
  if (!ats.length || Number.isNaN(latestMs)) return { ...EMPTY, snapshots: ats.length, since: ats[0] ?? null };

  const cur = flatten(latest);
  const baselineAt = sameTimeBaseline(ats, iso(latestMs), { cadenceHours });
  const base = new Map(baselineAt ? db.prepare('SELECT universeId, playing, bestRank FROM game_points WHERE at = ?').all(baselineAt).map((r) => [r.universeId, r]) : []);
  const icons = new Map(db.prepare('SELECT universeId, iconUrl FROM game_meta WHERE iconUrl IS NOT NULL').all().map((r) => [r.universeId, r.iconUrl]));

  const weekAgo = latestMs - 7 * DAY;
  const points = new Map(); // id -> [{ at, playing }] for the last 7 days, oldest first
  for (const r of db.prepare('SELECT universeId, at, playing FROM game_points WHERE at >= ? AND at <= ? ORDER BY at').all(iso(weekAgo), iso(latestMs))) {
    if (!points.has(r.universeId)) points.set(r.universeId, []);
    points.get(r.universeId).push(r);
  }
  // "new": first ever point is inside the last 7 days, and we have data from before that to say it was not there
  const covered = Date.parse(ats[0]) <= weekAgo;
  const seenBefore = db.prepare('SELECT 1 FROM game_points WHERE universeId = ? AND at <= ? LIMIT 1');

  const rows = {}; const rising = []; const fresh = []; let playersDelta = baselineAt ? 0 : null;
  for (const [id, p] of cur) {
    const pts = points.get(id) ?? [];
    const spark = pts.map((x) => x.playing);
    const b = base.get(id);
    const deltaPlayers = b ? p.playing - b.playing : null;
    const deltaPct = b && b.playing > 0 ? pct1((deltaPlayers / b.playing) * 100) : null;
    const isNew = covered && pts.length > 0 && Date.parse(pts[0].at) > weekAgo && !seenBefore.get(id, iso(weekAgo));
    rows[id] = { iconUrl: icons.get(id) ?? null, earningRank: p.earning, likePct: p.like, vsYesterdayPct: deltaPct, spark, isNew };
    if (b) playersDelta += deltaPlayers;
    if (isNew) fresh.push({ universeId: id, name: p.name, iconUrl: icons.get(id) ?? null, playing: p.playing, firstSeen: pts[0].at, spark });
    if (b && b.playing >= MIN_BASE && deltaPlayers > 0) {
      const up = b.bestRank - p.rank;
      const why = [
        up > 0 ? `Up ${up} ${up === 1 ? 'place' : 'places'} on ${p.sortName}` : null,
        p.earning ? `#${p.earning} top earning` : null,
        p.like !== null ? `${p.like}% liked` : null,
        p.lists >= 2 ? `On ${p.lists} lists` : null,
      ].filter(Boolean);
      rising.push({ universeId: id, name: p.name, iconUrl: icons.get(id) ?? null, playing: p.playing, deltaPlayers, deltaPct, rank: p.rank, sortName: p.sortName, earningRank: p.earning, likePct: p.like, why, spark });
    }
  }
  rising.sort((a, c) => c.deltaPct - a.deltaPct);
  fresh.sort((a, c) => c.playing - a.playing);
  const top = rising[0];
  return {
    snapshots: ats.length, since: ats[0], baselineAt, playersDelta,
    biggestJump: top ? { universeId: top.universeId, name: top.name, deltaPct: top.deltaPct } : null,
    rising: rising.slice(0, RISING_MAX), newOnCharts: fresh.slice(0, NEW_MAX), rows,
  };
}

export const getMeta = (db, universeId) => {
  const r = db.prepare('SELECT * FROM game_meta WHERE universeId = ?').get(Number(universeId));
  return r ? { ...r } : null;
};

/** Insert or update meta rows (one object or an array). A null field keeps the value already stored. */
export function upsertMeta(db, rows, updatedAt) {
  const q = db.prepare(`INSERT INTO game_meta (universeId, name, iconUrl, visits, favorites, created, creator, maxPlayers, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(universeId) DO UPDATE SET name = COALESCE(excluded.name, name), iconUrl = COALESCE(excluded.iconUrl, iconUrl), visits = COALESCE(excluded.visits, visits),
      favorites = COALESCE(excluded.favorites, favorites), created = COALESCE(excluded.created, created), creator = COALESCE(excluded.creator, creator),
      maxPlayers = COALESCE(excluded.maxPlayers, maxPlayers), updatedAt = excluded.updatedAt`);
  inTx(db, () => {
    for (const m of [rows].flat()) q.run(Number(m.universeId), m.name ?? null, m.iconUrl ?? null, m.visits ?? null, m.favorites ?? null, m.created ?? null, m.creator ?? null, m.maxPlayers ?? null, updatedAt);
  });
}

/** The ids with no meta row, no icon, or meta older than 7 days (nowMs is the clock), in the order given. */
export function staleMetaIds(db, ids, nowMs, maxAgeMs = 7 * DAY) {
  const cutoff = iso(nowMs - maxAgeMs);
  const get = db.prepare('SELECT iconUrl, updatedAt FROM game_meta WHERE universeId = ?');
  return ids.filter((id) => { const m = get.get(Number(id)); return !m || !m.iconUrl || !m.updatedAt || m.updatedAt < cutoff; });
}

/** `GET /api/market/games/:id` body (contract C8). 30 days of points, the ranks on the latest charts, cached meta. */
export function gameDetail(db, universeId, latest, nowMs) {
  const id = Number(universeId);
  const series = db.prepare('SELECT at, playing, bestRank, likePct FROM game_points WHERE universeId = ? AND at >= ? ORDER BY at').all(id, iso(nowMs - 30 * DAY)).map((r) => ({ ...r }));
  const ranks = [];
  for (const s of latest?.sorts ?? []) {
    const i = (s.games ?? []).findIndex((g) => Number(g.universeId) === id);
    if (i >= 0) ranks.push({ sortId: s.id, sortName: s.name, rank: i + 1 });
  }
  ranks.sort((a, b) => a.rank - b.rank);
  const meta = getMeta(db, id);
  const on = flatten(latest).get(id); // null stats mean "not on the charts now"
  return { universeId: id, meta, series, ranks, stats: { playing: on?.playing ?? null, likePct: on?.like ?? null, visits: meta?.visits ?? null, favorites: meta?.favorites ?? null } };
}
