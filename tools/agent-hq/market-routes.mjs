// Market routes: GET /api/market (with history), POST /api/market/refresh, GET /api/market/games/:universeId.
// Moved out of server.mjs. All of them sit behind the same token check as every other /api route.
import * as D from './db.mjs';
import { velocity, computeBreakouts } from './market.mjs';
import { initHistory, recordPoints, historyView, gameDetail, getMeta, upsertMeta, staleMetaIds } from './market-history.mjs';

const META_CAP = 600; // icons fetched per refresh
const BATCH = 50;
const DAY = 86400000;

export function mountMarket(route, { db, fetchers, fetchCharts, now, nowIso, HttpError }) {
  initHistory(db);

  const marketView = () => {
    const [latest, previous] = D.latestMarketSnapshots(db, 2);
    const cur = latest ?? { fetchedAt: null, sorts: [] };
    return {
      latest: cur, previous: previous ?? null, velocity: velocity(cur, previous ?? null),
      sorts: cur.sorts.map((x) => ({ id: x.id, name: x.name, count: x.games.length })),
      history: historyView(db, cur, { cadenceHours: D.getSetting(db, 'marketEveryHours', 6) || 6 }), // 0 (off) falls back to the default tolerance
    };
  };
  route('GET', /^\/api\/market$/, () => marketView());

  route('GET', /^\/api\/market\/games\/([^/]+)$/, async ({ m }) => {
    if (!/^\d{1,15}$/.test(m[1])) throw new HttpError(400, 'universeId must be digits');
    const id = Number(m[1]);
    const latest = D.latestMarketSnapshots(db, 1)[0];
    const meta = getMeta(db, id);
    if (!meta?.updatedAt || now() - Date.parse(meta.updatedAt) > DAY) {
      // one try; a failure keeps the cached values
      const [d, icons] = (await Promise.allSettled([fetchers.details([id]), fetchers.icons([id])])).map((r) => r.value ?? {});
      if (d[id] || icons[id]) {
        const name = latest?.sorts?.flatMap((s) => s.games ?? []).find((g) => Number(g.universeId) === id)?.name;
        upsertMeta(db, { universeId: id, name, iconUrl: icons[id], ...d[id] }, nowIso());
      }
    }
    const out = gameDetail(db, id, latest, now());
    if (!out.meta && !out.series.length && !out.ranks.length) throw new HttpError(404, 'no data for that game');
    return out;
  });

  // returns the details it fetched so the meta refresh can reuse them
  async function refreshBreakouts() {
    const snaps = D.latestMarketSnapshots(db, 30);
    const ids = [...new Set((snaps[0]?.sorts ?? []).flatMap((x) => x.games.map((g) => g.universeId)))].slice(0, 600);
    const details = await fetchers.details(ids);
    D.setSetting(db, 'breakouts', { rows: computeBreakouts(snaps, details, now()), at: nowIso() });
    D.setSetting(db, 'breakoutsAt', nowIso());
    return details;
  }

  // icons (and whatever details we already have) for the games with no meta, no icon, or meta older than 7 days; busiest games first
  async function refreshMeta(snap, details) {
    const seen = new Map();
    for (const s of snap.sorts ?? []) for (const g of s.games ?? []) {
      const id = Number(g.universeId);
      const e = seen.get(id);
      if (!e) seen.set(id, { name: g.name, playing: g.playerCount ?? 0 });
      else e.playing = Math.max(e.playing, g.playerCount ?? 0);
    }
    const byPlaying = [...seen.keys()].sort((a, b) => seen.get(b).playing - seen.get(a).playing);
    const ids = staleMetaIds(db, byPlaying, now()).slice(0, META_CAP);
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const icons = await fetchers.icons(batch);
      upsertMeta(db, batch.map((id) => ({ universeId: id, name: seen.get(id).name, iconUrl: icons[id], ...details?.[id] })), nowIso());
    }
  }

  async function refreshMarket() {
    D.setSetting(db, 'marketAttemptAt', nowIso());
    let snap;
    try { snap = await fetchCharts(); } catch (e) { throw new HttpError(502, `market fetch failed: ${e.message}`); }
    D.saveMarketSnapshot(db, snap);
    let breakoutsError = null; let metaError = null; let details = {};
    try { details = await refreshBreakouts(); } catch (e) { breakoutsError = e.message; }
    // history and icons are extras: a failure here never fails the refresh
    try { recordPoints(db, snap); await refreshMeta(snap, details); } catch (e) { metaError = e.message; }
    return { ...marketView(), breakoutsError, metaError };
  }
  route('POST', /^\/api\/market\/refresh$/, () => refreshMarket());

  return { refreshMarket };
}
