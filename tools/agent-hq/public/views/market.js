// Market: 1 charts, 2 corpus, 3 titles, 4 benchmarks, 5 breakouts.
import { h, ic, store, api, act, btn, empty, pageHead, fmtTime, notify, toast } from './core.js';
import { chip, num, tile, hbars } from './charts.js';
import { openLightbox } from './lightbox.js';
import { when, gameHref, gameIcon, K, pctText, splitSorts, risingRail, newList, chartTable } from './rising.js';

let step = 'charts';
let sel = '';
let refreshing = false;
const data = { market: undefined, corpus: undefined, benchmarks: undefined, breakouts: undefined, titles: undefined };
const busy = new Set();

const rowsOf = (r, ...keys) => (Array.isArray(r) ? r : keys.map((k) => r?.[k]).find(Array.isArray) || []);

async function load(key, path, shape) {
  if (busy.has(key)) return;
  busy.add(key);
  try { data[key] = shape(await api('GET', path)); } catch (e) { toast(e.message, 'error'); data[key] = data[key] === undefined ? null : data[key]; }
  busy.delete(key);
  notify();
}
const loaders = {
  market: () => load('market', '/api/market', (r) => (r && (r.latest || r.sorts) ? r : null)),
  corpus: () => load('corpus', '/api/market/corpus', (r) => rowsOf(r, 'games', 'rows')),
  titles: () => load('titles', '/api/market/titles', (r) => (r && typeof r.sample === 'number' ? r : null)),
  benchmarks: () => load('benchmarks', '/api/market/benchmarks', (r) => rowsOf(r, 'rows', 'benchmarks')),
  breakouts: () => load('breakouts', '/api/market/breakouts', (r) => ({ rows: rowsOf(r, 'rows', 'breakouts'), at: r?.at || null })),
};
const need = (key) => { if (data[key] === undefined) { loaders[key](); return true; } return false; };

async function refresh() {
  refreshing = true; notify();
  const r = await act(() => api('POST', '/api/market/refresh'), 'Charts refreshed');
  if (r) { data.titles = undefined; await Promise.all([loaders.market(), loaders.breakouts(), loaders.titles()]); }
  refreshing = false; notify();
}

function askScout(name, id, sortName) {
  return act(() => api('POST', '/api/tasks', {
    role: 'scout', title: `Study ${name}`.slice(0, 200),
    body: `Look at "${name}"${id ? ` (universe ${id})` : ''}${sortName ? ` from the "${sortName}" chart` : ''}. What makes it work, and could we make a Mild, original take on the pattern? Cite evidence.`,
    createdBy: 'owner',
  }), 'Scout is on it');
}

const th = (cols) => h('thead', {}, h('tr', {}, cols.map(([c, numeric, help]) => h('th', { class: numeric ? 'num' : '', scope: 'col', title: help || null }, c, help ? h('span', { class: 'pg-help' }, help) : null))));

// ---- 1 charts ----
const shortDate = (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });

function panel(icon, title, sub, ...body) {
  return h('section', { class: 'mk-panel' },
    h('header', { class: 'mk-panel-head' }, h('span', { class: 'mk-ptile' }, ic(icon, 16)), h('div', {}, h('h3', {}, title), sub ? h('p', { class: 'muted' }, sub) : null)),
    ...body);
}

function kpis(hist) {
  const d = hist?.playersDelta; const j = hist?.biggestJump;
  return h('div', { class: 'mk-kpis' },
    tile('Rising since yesterday', d == null ? null : `${d > 0 ? '+' : ''}${Number(d).toLocaleString()} players`, d == null ? null : `${d >= 0 ? 'more' : 'fewer'} players than at the same time yesterday`, d > 0 ? 'ok' : null),
    tile('Biggest jump in a day', j ? pctText(j.deltaPct) : null, j ? j.name : null, j ? 'ok' : null));
}

function youngPanel(hist) {
  const rows = (data.breakouts?.rows || []).slice(0, 5);
  return panel('pulse', 'Young breakouts', 'New games with a lot of players for how little they have been visited.',
    rows.length ? h('ul', { class: 'mk-new' }, rows.map((r) => h('li', {},
      h('a', { class: 'mk-newrow', href: gameHref(r.universeId) }, gameIcon(hist?.rows?.[r.universeId]?.iconUrl, r.name, 36),
        h('span', { class: 'nm' }, h('strong', { title: r.name }, r.name), h('span', { class: 'muted' }, r.growth != null ? `${Number(r.growth).toFixed(1)}x since first seen` : 'new')),
        h('span', { class: 'mk-num' }, K(r.playing), h('span', { class: 'muted' }, ' playing'))))))
      : h('p', { class: 'muted' }, 'None yet. They appear after the charts have been refreshed a few times.'),
    btn('See all breakouts', () => { step = 'breakouts'; notify(); }, { kind: 'sm ghost' }));
}

function chartsStep() {
  if (need('market')) return empty('Loading charts');
  const m = data.market;
  if (!m || !m.latest) return empty('No chart data yet. Press Refresh to fetch the Roblox charts.');
  const hist = m.history || null;
  const { main, more } = splitSorts(m.sorts && m.sorts.length ? m.sorts : m.latest.sorts.map((s) => ({ id: s.id, name: s.name, count: s.games.length })));
  if (![...main, ...more].some((s) => s.id === sel)) sel = (main[0] || more[0])?.id || '';
  const cur = m.latest.sorts.find((x) => x.id === sel);
  const measured = !!hist?.baselineAt;
  return h('div', { class: 'stack mk-stack' },
    kpis(hist),
    measured ? null : h('p', { class: 'pg-note' }, `Not measured yet: the same-time comparison needs a snapshot from about a day earlier. HQ has ${hist?.snapshots ?? 1} so far, one every ${store.settings.marketEveryHours || 6} hours.`),
    panel('trend', 'Rising fastest', 'The biggest jumps in players since this time yesterday, and why.', risingRail(hist?.rising, { limit: 12, key: 'market' })),
    h('div', { class: 'mk-two' },
      panel('clock', 'New on the charts', 'Games that reached the charts in the last 7 days.', newList(hist?.newOnCharts)),
      youngPanel(hist)),
    panel('market', 'The charts', "Roblox charts from the latest snapshot. Move, vs yesterday and 7 days come from HQ's own history.",
      h('div', { class: 'tabs mk-tabs', role: 'tablist', 'aria-label': 'Chart lists' },
        main.map((s) => h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(s.id === sel), onclick: () => { sel = s.id; notify(); } }, s.label)),
        more.length ? h('select', { class: 'select mk-more', 'aria-label': 'More lists', onchange: (e) => { if (e.target.value) { sel = e.target.value; notify(); } } },
          h('option', { value: '' }, 'More lists'), more.map((s) => h('option', { value: s.id, selected: s.id === sel }, s.label))) : null),
      cur ? chartTable(cur, hist, m.velocity, { extra: true, hasPrev: !!m.previous, onAsk: askScout }) : empty('No games in this list.')),
    h('div', { class: 'pg-foot' },
      h('p', { class: 'pg-note' }, 'Likes is the share of all votes that are thumbs up. Roblox tends to recommend games that hold 80% or more, so treat a lower number as a warning sign. Votes is the total count behind that share; a small count makes the share noisy.'),
      h('p', { class: 'pg-note' }, 'Move compares rank with the snapshot before this one. Vs yesterday compares players with the same time of day yesterday, and says "not measured" until HQ has a snapshot from about a day earlier. On lists is how many chart lists the game is on right now; a game on many lists is pushed by several signals, not just one.')));
}

// ---- 2 corpus ----
function corpusStep() {
  if (need('corpus')) return empty('Loading reference games');
  const list = data.corpus || [];
  const input = h('input', { class: 'pg-input', placeholder: 'Universe id', inputmode: 'numeric', maxlength: 20, 'aria-label': 'Universe id' });
  const add = async () => {
    const v = input.value.trim();
    if (!/^\d{1,20}$/.test(v)) { toast('A universe id is digits only', 'error'); return; }
    if (await act(() => api('POST', '/api/market/corpus', { universeId: v }), 'Added to the reference set')) { input.value = ''; await loaders.corpus(); }
  };
  const safe = (u) => (/^https:\/\//i.test(u || '') ? u : '');
  return h('div', { class: 'stack' },
    h('p', { class: 'pg-note' }, 'Games we study as references: what they look like and how they present themselves. Add any game by its universe id (the number from its Roblox page API or creator page).'),
    h('div', { class: 'row gap wrap' }, input, btn('Add game', add, { kind: 'primary', icon: 'plus' })),
    list.length ? h('div', { class: 'pg-corpus' }, list.map((g) => {
      const shots = [...new Set([...(Array.isArray(g.thumbnails) ? g.thumbnails : []), g.thumbnail])].filter((u) => safe(u));
      return h('article', { class: 'pg-game' },
      shots.length ? h('img', { class: 'thumb', src: shots[0], alt: g.name ? g.name + ' screenshot' : '', loading: 'lazy', referrerpolicy: 'no-referrer', style: 'cursor:zoom-in', title: 'Click to enlarge' + (shots.length > 1 ? ` (${shots.length} images)` : ''),
        onclick: () => openLightbox(shots.map((u, i) => ({ src: u, title: `${g.name || g.universeId} ${i + 1}` })), 0) }) : h('div', { class: 'thumb' }),
      h('div', { class: 'info' },
        h('div', { class: 'row1' }, safe(g.icon) ? h('img', { class: 'icon', src: safe(g.icon), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: 'icon' }), h('span', { class: 'nm', title: g.name }, g.name || 'Game ' + g.universeId)),
        h('span', { class: 'muted mono' }, g.universeId),
        h('div', { class: 'row gap' },
          btn('Ask scout', () => askScout(g.name || g.universeId, g.universeId), { kind: 'sm' }),
          btn('Remove', async () => { if (await act(() => api('DELETE', `/api/market/corpus/${encodeURIComponent(g.universeId)}`), 'Removed')) await loaders.corpus(); }, { kind: 'sm', icon: 'trash' }))));
    })) : empty('No reference games yet. Add one above.'));
}

// ---- title analysis ----
function titlesStep() {
  if (need('titles')) return empty('Reading the titles');
  const t = data.titles;
  if (!t) return empty('No title analysis yet. Refresh the charts first.');
  const pc = (x) => (x ? `${x.pct}% (${x.count})` : null);
  return h('div', { class: 'stack' },
    h('p', { class: 'pg-note' }, `How the games on the charts are named, across ${num(t.sample)} titles in the latest snapshot. Use it to name ours like the winners, not to copy them.`),
    h('div', { class: 'pg-tiles' },
      tile('Titles read', num(t.sample)), tile('Verb, article, noun', pc(t.verbArticleNoun), 'like "Steal a Brainrot"'),
      tile('Verb first, no article', pc(t.verbInitialNoArticle), 'like "Grow Garden"'), tile('With an emoji or symbol', pc(t.withEmoji)),
      tile('Words per title', t.words?.mean != null ? String(t.words.mean) : null, 'average'), tile('Characters per title', t.length?.mean != null ? String(t.length.mean) : null, 'average')),
    h('div', { class: 'pg-grid2' },
      hbars('Words in the title', (t.words?.histogram || []).map((r) => ({ label: r.words + (r.words === 1 ? ' word' : ' words'), value: r.count })), { note: 'No titles.' }),
      hbars('Title length (characters)', (t.length?.buckets || []).map((r) => ({ label: r.label, value: r.count })), { note: 'No titles.' }),
      hbars('Most common first words', (t.commonFirstWords || []).map((r) => ({ label: r.word, value: r.count })), { note: 'No titles.' })),
    h('div', { class: 'pg-foot' },
      h('p', { class: 'pg-note' }, 'A title counts as verb-first when its first word is an action word from a built-in list, so treat the shares as a guide, not an exact count. Emoji and symbols are counted when the title contains any.')));
}

// ---- 3 benchmarks ----
function benchStep() {
  if (need('benchmarks')) return empty('Loading benchmarks');
  const rows = data.benchmarks || [];
  if (!rows.length) return empty('No benchmarks found.');
  const tone = (t) => ({ gate: 'warn', health: 'accent' }[t] || null);
  return h('div', { class: 'stack' },
    h('p', { class: 'pg-note' }, 'The numbers a game should hit, where each one is measured, and what a miss tells you. A gate must pass before a stage moves on, health numbers show how the game is doing once it has players, and watch items are signals to keep an eye on. The evidence column says whether a number is documented or only a creator rule of thumb.'),
    h('div', { class: 'pg-scroll' }, h('table', { class: 'pg-tbl' },
      th([['Benchmark'], ['Target'], ['Measured by'], ['Tier'], ['If it fails'], ['Source and evidence']]),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('td', { class: 'wrapc' }, h('strong', {}, r.benchmark)), h('td', { class: 'wrapc' }, r.target), h('td', { class: 'wrapc' }, r.measuredBy),
        h('td', {}, r.tier ? chip(r.tier, tone(r.tier)) : ''), h('td', { class: 'wrapc' }, r.failureMeaning),
        h('td', { class: 'wrapc muted' }, /^https:\/\/\S+$/.test(r.source || '') ? h('a', { href: r.source, target: '_blank', rel: 'noopener noreferrer' }, r.source.replace(/^https:\/\/(www\.)?/, '')) : r.source, r.label ? h('div', {}, r.label) : null)))))),
    h('p', { class: 'pg-note' }, 'Rows from the GameAnalytics 2026 report describe large games only. A median there is a floor for healthy, not a target for a new release; a small game that beats it is a strong signal.'));
}

// ---- 4 breakouts ----
function breakStep() {
  if (need('breakouts')) return empty('Loading breakouts');
  const b = data.breakouts || { rows: [], at: null };
  return h('div', { class: 'stack' },
    h('p', { class: 'pg-note' }, 'Young games that are growing fast: under 300,000 visits, over 500 players right now, and new or first seen in the last 7 days. Players per 1K visits shows how sticky the game is (higher means players stay). Growth is the latest player count divided by the earliest one we saw.'),
    b.at ? h('p', { class: 'muted' }, 'Computed ' + when(b.at)) : null,
    b.rows.length ? h('div', { class: 'pg-scroll' }, h('table', { class: 'pg-tbl' },
      th([['Game'], ['Playing', true, 'players now'], ['Peak', true, 'highest in 7 days'], ['Visits', true, 'lifetime'], ['Age (days)', true, 'since created'], ['Per 1K visits', true, 'players per 1K visits: high means young and pushed'], ['Growth', true, 'since first seen'], ['Likes', true], ['Genre'], ['First seen'], ['']]),
      h('tbody', {}, b.rows.map((r) => h('tr', {},
        h('td', { class: 'wrapc' }, r.name), h('td', { class: 'num' }, num(r.playing)), h('td', { class: 'num' }, num(r.peak)), h('td', { class: 'num' }, num(r.visits)),
        h('td', { class: 'num' }, r.ageDays ?? 'n/a'), h('td', { class: 'num' }, r.perThousandVisits != null ? Number(r.perThousandVisits).toFixed(1) : 'n/a'),
        h('td', { class: 'num' }, r.growth != null ? Number(r.growth).toFixed(2) + 'x' : 'n/a'), h('td', { class: 'num' }, r.likePct != null ? Math.round(r.likePct <= 1 ? r.likePct * 100 : r.likePct) + '%' : 'n/a'),
        h('td', { class: 'muted' }, r.genre || ''), h('td', { class: 'muted' }, r.firstSeen ? fmtTime(r.firstSeen) : ''),
        h('td', { class: 'end-text' }, btn('Ask scout', () => askScout(r.name, r.universeId), { kind: 'sm' }))))))) : empty('No breakouts yet. They appear after the charts have been refreshed a few times.'));
}

export function render() {
  if (step !== 'breakouts') need('breakouts');
  if (step !== 'charts') need('market');
  const items = [['charts', '1 · Charts'], ['corpus', '2 · Corpus'], ['titles', '3 · Titles'], ['benchmarks', '4 · Benchmarks'], ['breakouts', '5 · Breakouts']];
  const latest = data.market?.latest; const hist = data.market?.history;
  const fetched = latest?.fetchedAt;
  const sub = hist?.snapshots
    ? `From our chart history: ${hist.snapshots} snapshots since ${shortDate(hist.since)}. Updated ${when(fetched)}. All public Roblox data.`
    : `Charts ${fetched ? when(fetched) : 'not fetched yet'} · breakouts ${data.breakouts?.at ? when(data.breakouts.at) : 'not computed yet'}. All public Roblox data.`;
  return h('div', { class: 'page' },
    pageHead('Market', sub,
      latest?.sample ? h('span', { class: 'chip static', 'data-tone': 'work' }, 'Sample data') : null,
      h('a', { class: 'chip mk-prochip', href: '#/pro' }, ic('gem', 13), 'Pro'),
      btn(refreshing ? 'Refreshing' : 'Refresh', refresh, { kind: 'mk-act', icon: 'refresh', disabled: refreshing })),
    h('div', { class: 'tabs mk-tabs', role: 'tablist', 'aria-label': 'Market steps' }, items.map(([id, l]) => h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(id === step), onclick: () => { step = id; notify(); } }, l))),
    step === 'charts' ? chartsStep() : step === 'corpus' ? corpusStep() : step === 'titles' ? titlesStep() : step === 'benchmarks' ? benchStep() : breakStep());
}
