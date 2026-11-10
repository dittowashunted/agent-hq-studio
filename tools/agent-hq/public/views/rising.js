// Market and Pro share these: game icons, the rising rail, "new on the charts" and the chart table.
// Everything here reads the history block of GET /api/market (market-history.mjs). Icons are hot-linked Roblox URLs, never copied.
import { h, ic, ago, notify } from './core.js';
import { sparkline } from './charts.js';

export const when = (iso) => (iso ? `${ago(iso)}${ago(iso) === 'just now' ? '' : ' ago'}` : 'never');
export const gameHref = (id) => '#/pro/history/' + id;

// ---- chart lists live in sorts.js (exact ids first, names as fallback) ----
export { REF_SORTS, splitSorts } from './sorts.js';

// ---- small formatters ----
export const K = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  return v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}K` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(Math.round(v));
};
export const pctText = (p) => `${p > 0 ? '+' : ''}${Math.abs(p) >= 10 ? Math.round(p) : Number(p).toFixed(1)}%`;
export const likeText = (p) => (p == null ? '—' : `${Math.round(p)}%`); // whole percent, as the server sends it

/** Change badge: an arrow shape plus a signed number, so direction never rests on colour alone. null = not measured. */
export function trend(p, suffix) {
  if (p == null || !Number.isFinite(Number(p))) return h('span', { class: 'mk-delta', 'data-dir': 'none' }, 'not measured');
  const n = Number(p);
  const dir = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  return h('span', { class: 'mk-delta', 'data-dir': dir }, dir === 'flat' ? '–' : ic(dir === 'up' ? 'triUp' : 'triDown', 12), pctText(n), suffix ? h('span', { class: 'sfx' }, ' ' + suffix) : null);
}

/** Game icon: a Roblox https URL, or a lettered tile when there is none (or it fails to load). */
export function gameIcon(url, name, size = 40) {
  const px = `width:${size}px;height:${size}px`;
  const tile = () => {
    const letter = (String(name || '').match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase();
    const hue = [...String(name || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
    return h('span', { class: 'mk-icon mk-mono', style: `${px};--hue:${hue}`, 'aria-hidden': 'true' }, letter);
  };
  if (!/^https:\/\//i.test(url || '')) return tile();
  const img = h('img', { class: 'mk-icon', src: url, alt: '', width: size, height: size, loading: 'lazy', referrerpolicy: 'no-referrer', style: px });
  img.addEventListener('error', () => img.replaceWith(tile()));
  return img;
}

// ---- rising rail ----
const opened = new Set(); // rails the owner expanded; kept here because pages re-render on every change

function risingCard(r) {
  return h('a', { class: 'mk-card', href: gameHref(r.universeId) },
    h('div', { class: 'mk-card-top' }, gameIcon(r.iconUrl, r.name, 48),
      h('div', { class: 'mk-card-title' }, h('strong', { title: r.name }, r.name),
        r.earningRank ? h('span', { class: 'mk-rank' }, ic('dollar', 12), `#${r.earningRank} top earning`) : null)),
    h('div', { class: 'mk-card-mid' },
      h('div', {}, h('span', { class: 'mk-big' }, K(r.playing)), ' ', h('span', { class: 'muted' }, 'playing'), h('div', {}, trend(r.deltaPct, 'vs yesterday'))),
      sparkline(r.spark, { w: 96, h: 34 })),
    r.why?.length ? h('div', { class: 'mk-why' }, h('span', { class: 'overline' }, 'Why it is rising'),
      h('div', { class: 'mk-whys' }, r.why.slice(0, 3).map((w) => h('span', { class: 'mk-whychip' }, w)))) : null);
}

/** Horizontal rail of the fastest climbers. rows come from history.rising. More than `limit` rows adds "Show all N". */
export function risingRail(rows, { limit = 12, key = 'rail' } = {}) {
  const list = rows || [];
  if (!list.length) return h('p', { class: 'muted' }, 'Nothing has risen against the same time yesterday.');
  const all = opened.has(key);
  const shown = all ? list : list.slice(0, limit);
  return h('div', { class: 'mk-railwrap' },
    h('div', { class: 'mk-rail' + (all ? ' all' : ''), role: 'list' }, shown.map((r) => h('div', { role: 'listitem', class: 'mk-rail-item' }, risingCard(r)))),
    list.length > limit ? h('button', { type: 'button', class: 'btn sm ghost mk-showall', 'aria-expanded': String(all), onclick: () => { if (all) opened.delete(key); else opened.add(key); notify(); } },
      all ? 'Show fewer' : `Show all ${list.length}`) : null);
}

/** Games that reached a chart within the last 7 days. rows come from history.newOnCharts. */
export function newList(rows) {
  if (!rows?.length) return h('p', { class: 'muted' }, 'No game has reached the charts in the last 7 days. This needs a week of chart history.');
  return h('ul', { class: 'mk-new' }, rows.slice(0, 8).map((r) => h('li', {},
    h('a', { class: 'mk-newrow', href: gameHref(r.universeId) }, gameIcon(r.iconUrl, r.name, 36),
      h('span', { class: 'nm' }, h('strong', { title: r.name }, r.name), h('span', { class: 'muted' }, 'first seen ' + when(r.firstSeen))),
      h('span', { class: 'mk-num' }, K(r.playing), h('span', { class: 'muted' }, ' playing')),
      sparkline(r.spark, { w: 64, h: 24 })))));
}

// ---- chart table ----
function rowsFor(sort, velocity) {
  const fromVel = velocity?.perSort?.[sort.id];
  if (Array.isArray(fromVel) && fromVel.length) return fromVel;
  return (sort.games || []).map((g, i) => ({ rank: i + 1, name: g.name, universeId: g.universeId, playing: g.playerCount, rankDelta: null, likePct: g.up + g.down ? Math.round((g.up / (g.up + g.down)) * 100) : null, votes: (g.up || 0) + (g.down || 0), sortsCount: null }));
}

function move(r, info, hasPrev) {
  if (info.isNew) return h('span', { class: 'mk-newtag' }, 'NEW');
  const d = r.rankDelta;
  if (!hasPrev || !d) return h('span', { class: 'mk-move', 'data-dir': 'flat', title: hasPrev ? 'No change in rank' : 'Needs a second snapshot' }, '–', h('span', { class: 'sr' }, ' no change'));
  return h('span', { class: 'mk-move', 'data-dir': d > 0 ? 'up' : 'down' }, ic(d > 0 ? 'triUp' : 'triDown', 12), Math.abs(d), h('span', { class: 'sr' }, d > 0 ? ' places up' : ' places down'));
}

/**
 * One chart list as a table. sort = a latest.sorts entry ({ id, name, games }), history = GET /api/market history block,
 * velocity = GET /api/market velocity. opts: limit (rows shown), extra (HQ columns: votes, on lists, universe, Ask scout), onAsk(name, id, sortName).
 */
export function chartTable(sort, history, velocity, { limit = 0, extra = false, onAsk = null, hasPrev = false } = {}) {
  const all = rowsFor(sort, velocity);
  const rows = limit ? all.slice(0, limit) : all;
  if (!rows.length) return h('p', { class: 'muted' }, 'No games in this list.');
  const cols = [['#', 'num'], ['Move', '', 'Rank change since the previous snapshot'], ['Game'], ['Playing', 'num'], ['Vs yesterday', 'num', 'Players now against the same time yesterday'], ['Likes', 'num'], ['Earning', 'num', 'Rank on the top-earning chart'], ['7 days']];
  if (extra) cols.push(['Votes', 'num'], ['On lists', 'num', 'How many chart lists the game is on right now'], ['Universe'], ['']);
  return h('div', { class: 'mk-scroll' }, h('table', { class: 'mk-tbl' },
    h('thead', {}, h('tr', {}, cols.map(([c, cls, tip]) => h('th', { scope: 'col', class: cls || null, title: tip || null }, c)))),
    h('tbody', {}, rows.map((r, i) => {
      const info = history?.rows?.[r.universeId] || {};
      return h('tr', { onclick: (e) => { if (!e.target.closest('a,button')) location.hash = gameHref(r.universeId); } },
        h('td', { class: 'num muted' }, r.rank ?? i + 1),
        h('td', {}, move(r, info, hasPrev)),
        h('td', { class: 'game' }, h('a', { class: 'mk-game', href: gameHref(r.universeId) }, gameIcon(info.iconUrl, r.name, 32), h('span', { title: r.name }, r.name))),
        h('td', { class: 'num', title: r.playing != null ? Number(r.playing).toLocaleString() : null }, K(r.playing ?? r.playerCount)),
        h('td', { class: 'num' }, trend(info.vsYesterdayPct)),
        h('td', { class: 'num' }, likeText(info.likePct ?? r.likePct)),
        h('td', { class: 'num' }, info.earningRank ? '#' + info.earningRank : '—'),
        h('td', {}, sparkline(info.spark, { w: 72, h: 24 }) || h('span', { class: 'muted' }, '—')),
        extra ? [
          h('td', { class: 'num' }, r.votes != null ? Number(r.votes).toLocaleString() : 'n/a'),
          h('td', { class: 'num' }, r.sortsCount ?? 'n/a'),
          h('td', { class: 'mono muted' }, r.universeId ?? ''),
          h('td', { class: 'end-text' }, onAsk ? h('button', { type: 'button', class: 'btn sm', title: 'Ask the Scout about this game', onclick: () => onAsk(r.name, r.universeId, sort.name) }, 'Ask scout') : null),
        ] : null);
    }))));
}
