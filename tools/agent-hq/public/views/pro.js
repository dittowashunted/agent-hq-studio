// Pro: ten steps in the owner's order. Five run on HQ's own data; five are marked Soon and do nothing yet.
// Routes: #/pro/<step> and #/pro/history/<universeId>. No gating, no licence checks, no autoplay.
import { h, ic, store, api, act, btn, empty, field, pageHead, selectEl, notify, toast, go, roleLabel } from './core.js';
import { chip, lineChart, scoreRing, scoreTone, num } from './charts.js';
import { gameIcon, risingRail, chartTable, splitSorts, trend, K, likeText, when } from './rising.js';
import { openTaskDrawer } from './tasks.js';
import { thumbtestStep } from './thumbtest.js';

const SOON = 'Not built yet. Nothing here to click.';
const STEPS = [
  { id: 'rising', label: 'Rising right now', icon: 'trend', sub: 'The games climbing fastest against the same time yesterday.' },
  { id: 'history', label: 'Chart history', icon: 'tasks', sub: 'Six Roblox charts, with a week of players for every game. Open a game for its month.' },
  { id: 'score', label: 'Score my idea', icon: 'sparkles', sub: 'The Scout scores an idea out of 10 against the chart data before you build it.' },
  { id: 'ideas', label: 'Weekly game ideas', icon: 'pitches', sub: 'Pitches from the last 7 days. Deciding on them happens in Pitches.' },
  { id: 'packs', label: 'Asset packs', icon: 'box', sub: 'What the Library catalog holds right now.' },
  { id: 'ads', label: 'Ads helper', icon: 'send', soon: 'Plan ad variants and judge them once they have enough impressions.' },
  { id: 'thumbtest', label: 'Thumbnail tester', icon: 'grid', sub: 'See your icon or thumbnail beside today\'s trending games, as it would look on a PC or a phone.' },
  { id: 'promo', label: 'Promo clips', icon: 'play', soon: 'Short vertical clips for social posts.' },
  { id: 'thumbmaker', label: 'Thumbnail maker', icon: 'image', soon: 'Draft icon and thumbnail options that match your game\'s look.' },
  { id: 'builder', label: 'Asset builder', icon: 'hammer', soon: 'Describe a model or an effect and get a few variants back.' },
];

// ---- data ----
const data = { market: undefined, ideas: undefined, catalog: undefined, detail: {} };
const at = {}; // when each key was last loaded, so a long visit refreshes
const busy = new Set();
let sel = ''; // chart tab on Chart history
const form = { title: '', idea: '' };
let picked = '';
let submitting = false;
const seen = new Map(); // idea id -> last seen state of its task

async function load(key, path, shape, { keep } = {}) {
  const bk = keep || key;
  if (busy.has(bk)) return;
  busy.add(bk);
  try { const v = shape(await api('GET', path)); if (keep) data.detail[keep] = v; else data[key] = v; }
  catch (e) {
    if (keep) data.detail[keep] = null; // a game HQ knows nothing about answers 404; the page says so
    else { toast(e.message, 'error'); if (data[key] === undefined) data[key] = null; }
  }
  at[bk] = Date.now();
  busy.delete(bk);
  notify();
}
const stale = (k, ttl) => !busy.has(k) && (at[k] === undefined || Date.now() - at[k] > ttl);
const loaders = {
  market: () => load('market', '/api/market', (r) => (r && (r.latest || r.sorts) ? r : null)),
  ideas: () => load('ideas', '/api/idea-scores', (r) => (Array.isArray(r?.ideas) ? r.ideas : [])),
  catalog: () => load('catalog', '/api/catalog?limit=1', (r) => (r && typeof r.total === 'number' ? r : null)),
};
const TTL = { market: 300000, ideas: 600000, catalog: 600000 };
function need(key) { if (data[key] === undefined || stale(key, TTL[key])) { if (!busy.has(key)) loaders[key](); } return data[key] === undefined; }
function needDetail(id) {
  if (data.detail[id] === undefined || stale(id, 300000)) { if (!busy.has(id)) load('detail', `/api/market/games/${id}`, (r) => r, { keep: id }); }
  return data.detail[id] === undefined;
}

const shortDate = (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
const gameName = (id) => {
  for (const s of data.market?.latest?.sorts || []) { const g = s.games.find((x) => String(x.universeId) === String(id)); if (g) return g.name; }
  return '';
};
const note = (text) => h('p', { class: 'pg-note' }, text);
const measuredNote = (m) => (m?.history?.baselineAt ? null : note('Not measured yet: the same-time comparison needs a snapshot from about a day earlier. HQ adds one every few hours, so check back later.'));

// ---- 1 rising ----
function risingStep() {
  if (need('market')) return empty('Loading the charts');
  const m = data.market;
  if (!m?.latest?.fetchedAt) return empty('No chart data yet. Open Market and press Refresh to fetch the Roblox charts.');
  return h('div', { class: 'stack' }, measuredNote(m), risingRail(m.history?.rising, { limit: 16, key: 'pro' }),
    note(`Chart snapshot from ${when(m.latest.fetchedAt)}. Rising means more players than at the same time yesterday, for games with at least 100 players then.`));
}

// ---- 2 chart history ----
function chartTabs(m) {
  const { main, more } = splitSorts(m.sorts && m.sorts.length ? m.sorts : m.latest.sorts.map((s) => ({ id: s.id, name: s.name })));
  const list = (main.length ? main : more).slice(0, 6);
  if (!list.some((s) => s.id === sel)) sel = list[0]?.id || '';
  return list;
}

function weekDelta(series) {
  const last = series.at(-1);
  if (!last) return null;
  const target = Date.parse(last.at) - 7 * 86400000;
  let best = null;
  for (const p of series) if (Math.abs(Date.parse(p.at) - target) <= 12 * 3600000 && (!best || Math.abs(Date.parse(p.at) - target) < Math.abs(Date.parse(best.at) - target))) best = p;
  return best && best.playing > 0 ? Math.round(((last.playing - best.playing) / best.playing) * 1000) / 10 : null;
}
const stat = (label, value) => h('div', { class: 'pro-stat' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, value));

function detailStep(id) {
  need('market');
  const back = h('a', { class: 'btn sm pro-back mk-act', href: '#/pro/history' }, ic('back', 14), 'Chart history');
  if (needDetail(id)) return h('div', { class: 'stack' }, back, empty('Loading the game'));
  const d = data.detail[id];
  if (!d) return h('div', { class: 'stack' }, back, empty('HQ has no history for this game yet. It shows up once it has been on a chart.'));
  const info = data.market?.history?.rows?.[id] || {};
  const rising = (data.market?.history?.rising || []).some((r) => String(r.universeId) === String(id));
  const series = d.series || [];
  const name = d.meta?.name || gameName(id) || `Game ${id}`;
  const peak = series.length ? Math.max(...series.map((p) => p.playing || 0)) : null;
  const playing = d.stats?.playing ?? series.at(-1)?.playing;
  const like = d.stats?.likePct ?? series.at(-1)?.likePct;
  const wk = weekDelta(series);
  return h('div', { class: 'stack' },
    h('div', { class: 'pro-detail-top' }, back, series.length ? h('span', { class: 'mono muted' }, `${shortDate(series[0].at)} to ${shortDate(series.at(-1).at)}`) : null),
    h('div', { class: 'pro-game' }, gameIcon(d.meta?.iconUrl || info.iconUrl, name, 56),
      h('div', {}, h('h3', {}, name), h('div', { class: 'row gap wrap' },
        info.isNew ? chip('New on the charts') : null, rising ? chip('Rising fast', 'ok') : null,
        series.length ? h('span', { class: 'muted small' }, `In our history since ${shortDate(series[0].at)}`) : null))),
    h('div', { class: 'pro-stats' },
      stat('Playing now', playing != null ? Number(playing).toLocaleString() : 'not on the charts'),
      stat('Vs yesterday', trend(info.vsYesterdayPct)), stat('Vs last week', trend(wk)),
      stat('Likes', like != null ? likeText(like) : 'not measured')),
    lineChart('Players, last 30 days', series.map((p) => ({ x: p.at, y: p.playing })), { area: true }),
    peak || d.stats?.visits != null || d.stats?.favorites != null ? h('p', { class: 'muted small' }, [
      peak ? `Peak ${peak.toLocaleString()} players in this window.` : '',
      d.stats?.visits != null ? ` ${K(d.stats.visits)} visits.` : '', d.stats?.favorites != null ? ` ${K(d.stats.favorites)} favorites.` : ''].join('').trim()) : null,
    d.ranks?.length ? h('div', { class: 'row gap wrap pro-ranks' }, h('span', { class: 'muted small' }, 'On the charts'), d.ranks.map((r) => chip(`${r.sortName} #${r.rank}`))) : null);
}

function historyStep(arg) {
  if (arg && /^\d{1,15}$/.test(arg)) return detailStep(arg);
  if (need('market')) return empty('Loading the charts');
  const m = data.market;
  if (!m?.latest?.fetchedAt) return empty('No chart data yet. Open Market and press Refresh to fetch the Roblox charts.');
  const list = chartTabs(m);
  const cur = m.latest.sorts.find((s) => s.id === sel);
  return h('div', { class: 'stack' }, measuredNote(m),
    h('div', { class: 'tabs mk-tabs', role: 'tablist', 'aria-label': 'Chart lists' }, list.map((s) => h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(s.id === sel), onclick: () => { sel = s.id; notify(); } }, s.label))),
    cur ? chartTable(cur, m.history, m.velocity, { limit: 10, hasPrev: !!m.previous }) : empty('No games in this list.'),
    note('Ten rows per chart. Open a game to see its month. The full lists are on the Market page.'));
}

// ---- 3 score my idea ----
const TASK_WORD = { queued: 'Waiting in the Scout\'s queue', working: 'The Scout is scoring it now', review: 'The Scout finished its task without sending a score', done: 'The Scout finished its task without sending a score', failed: 'The Scout could not finish', canceled: 'The task was canceled' };

async function submitIdea() {
  const title = form.title.trim(); const idea = form.idea.trim();
  if (!title || !idea) { toast('Add a title and say what the game is', 'error'); return; }
  submitting = true; notify();
  const r = await act(() => api('POST', '/api/idea-scores', { title, idea }), 'The Scout is scoring your idea');
  submitting = false;
  if (r && r.id) { form.title = ''; form.idea = ''; picked = r.id; await loaders.ideas(); } else notify();
}

function ideaForm() {
  return h('form', { class: 'pro-form', onsubmit: (e) => { e.preventDefault(); submitIdea(); } },
    field('Title', h('input', { class: 'input', maxlength: 120, value: form.title, placeholder: 'A short name', oninput: (e) => { form.title = e.target.value; } })),
    field('The idea', h('textarea', { class: 'textarea', rows: 3, maxlength: 1200, value: form.idea, placeholder: 'What you do, why it is fun, and which game it is like', oninput: (e) => { form.idea = e.target.value; } })),
    h('div', { class: 'row gap' }, h('button', { type: 'submit', class: 'btn primary', disabled: submitting }, ic('sparkles', 14), submitting ? 'Sending' : 'Score it'), h('span', { class: 'muted small' }, 'Goes to the Scout as a task. Scores are advice, not a promise.')));
}

function scoreRow(r) {
  const n = Number(r.score) || 0; const tone = scoreTone(n);
  return h('div', { class: 'pro-row', 'data-tone': tone },
    h('div', { class: 'top' }, h('strong', {}, r.name), h('span', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.max(0, Math.min(100, n * 10))}%` })),
      h('span', { class: 'n' }, Number.isInteger(n) ? n : n.toFixed(1), h('span', { class: 'sr' }, ` out of 10, ${tone === 'high' ? 'strong' : tone === 'mid' ? 'middling' : 'weak'}`))),
    r.evidence ? h('p', { class: 'muted' }, r.evidence) : null);
}

function ideaView(i) {
  if (i.state === 'scored') {
    return h('div', { class: 'pro-score' },
      h('div', { class: 'pro-score-head' }, scoreRing(i.score),
        h('div', {}, h('span', { class: 'overline' }, 'Your idea'), h('h3', {}, i.title), i.verdict ? h('span', { class: 'pro-verdict', 'data-tone': scoreTone(Number(i.score)) }, i.verdict) : null)),
      h('div', { class: 'pro-rows' }, (i.rows || []).map(scoreRow)),
      i.change ? h('div', { class: 'pro-advice' }, ic('sparkles', 16), h('p', {}, h('strong', {}, 'Raise the score: '), i.change)) : null,
      i.scoredAt ? h('p', { class: 'muted small' }, `Scored ${when(i.scoredAt)}.`) : null);
  }
  const t = store.tasks.find((x) => x.id === i.taskId);
  const failed = i.state === 'failed';
  return h('div', { class: 'pro-score pro-wait' },
    h('div', { class: 'pro-score-head' }, failed ? ic('alert', 22) : h('span', { class: 'spin-ring', 'aria-hidden': 'true' }), h('div', {}, h('span', { class: 'overline' }, 'Your idea'), h('h3', {}, i.title))),
    h('p', {}, failed ? 'The Scout could not score this one.' : 'Waiting for the Scout to send the score.', ' ', t ? (TASK_WORD[t.state] || '') + (t.role ? ` (${roleLabel(t.role)})` : '') + '.' : ''),
    h('p', { class: 'muted' }, i.idea),
    h('div', { class: 'row gap' }, t ? btn('Open the task', () => openTaskDrawer(t.id), { kind: 'sm' }) : null,
      failed ? btn('Score it again', async () => { form.title = i.title; form.idea = i.idea; await submitIdea(); }, { kind: 'sm', icon: 'refresh' }) : null));
}

// Refetch when an open idea's task changes state; pages already re-render on task events, so there is no new SSE event.
function watchIdeas() {
  const open = (data.ideas || []).filter((i) => i.state === 'open');
  let changed = false;
  for (const i of open) { const s = store.tasks.find((t) => t.id === i.taskId)?.state || '?'; if (seen.has(i.id) && seen.get(i.id) !== s) changed = true; seen.set(i.id, s); }
  for (const id of [...seen.keys()]) if (!open.some((i) => i.id === id)) seen.delete(id);
  if (changed && !busy.has('ideas')) loaders.ideas();
}

function scoreStep() {
  if (need('ideas')) return h('div', { class: 'stack' }, ideaForm(), empty('Loading your ideas'));
  const list = data.ideas || [];
  if (!list.some((i) => i.id === picked)) picked = list[0]?.id || '';
  const cur = list.find((i) => i.id === picked);
  return h('div', { class: 'stack' }, ideaForm(),
    list.length ? h('div', { class: 'seg pro-seg', role: 'group', 'aria-label': 'Your ideas' }, list.slice(0, 8).map((i) => h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(i.id === picked), onclick: () => { picked = i.id; notify(); } },
      i.title.length > 24 ? i.title.slice(0, 23) + '…' : i.title))) : null,
    cur ? ideaView(cur) : empty('No ideas scored yet. Describe one above and the Scout will score it.'));
}

// ---- 4 weekly ideas ----
const PITCH_STATE = { proposed: ['open', 'Open'], approved: ['yours', 'Yours'], withdrawn: ['taken', 'Taken'] };
function ideasStep() {
  const week = Date.now() - 7 * 86400000;
  const list = store.pitches.filter((p) => PITCH_STATE[p.state] && Date.parse(p.createdAt) >= week).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (!list.length) return empty('No pitches in the last 7 days. Ask the Scout for ideas from Pitches.');
  return h('div', { class: 'stack' }, h('div', { class: 'pro-ideas' }, list.map((p) => {
    const [tone, word] = PITCH_STATE[p.state];
    return h('a', { class: 'pro-idea', href: '#/pitches' }, gameIcon(null, p.title, 56),
      h('div', { class: 'body' }, h('span', { class: 'overline' }, p.format || 'Game idea'), h('strong', {}, p.title), p.oneLiner ? h('span', { class: 'muted' }, p.oneLiner) : null),
      h('span', { class: 'pro-state', 'data-tone': tone }, tone === 'yours' ? ic('check', 13) : null, word));
  })), note('Open means waiting for your decision, Yours means you approved it, Taken means it was withdrawn when another pitch was approved. Decide in Pitches.'));
}

// ---- 5 asset packs ----
const KIND = { model: ['Models', 'Ready to drop into a place'], texture: ['Textures', 'Surfaces and materials'], hdri: ['Skies', 'Lighting and backdrops'], pack: ['Packs', 'Bundles you unzipped into assets/packs'], vfx: ['Effects', 'Particles and visual effects'], material: ['Materials', 'Material sets'], sky: ['Skyboxes', 'Sky images'], animation: ['Animations', 'Motion clips'] };
function packsStep() {
  if (need('catalog')) return empty('Loading the catalog');
  const c = data.catalog;
  const kinds = Object.entries(c?.types || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (!c || !c.total) return h('div', { class: 'stack' }, empty('The catalog is empty. Open the Library, go to Catalog and press Refresh.'), h('a', { class: 'btn sm', href: '#/library/catalog' }, 'Open the catalog'));
  return h('div', { class: 'stack' }, h('div', { class: 'pro-packs' }, kinds.map(([k, n]) => h('a', { class: 'pro-pack', href: '#/library/catalog' },
    h('span', { class: 'mk-ptile' }, ic('box', 16)), h('strong', {}, (KIND[k] || [k[0].toUpperCase() + k.slice(1)])[0]), h('span', { class: 'big' }, n.toLocaleString()), h('span', { class: 'muted' }, (KIND[k] || [])[1] || 'In the catalog')))),
    h('div', { class: 'row gap wrap' }, Object.entries(c.sources || {}).map(([s, n]) => chip(`${s} ${num(n)}`)), c.refreshedAt ? h('span', { class: 'muted small' }, `Catalog refreshed ${when(c.refreshedAt)}`) : null),
    h('a', { class: 'btn sm', href: '#/library/catalog' }, ic('external', 13), 'Browse the catalog'));
}

// ---- 6 to 10 soon ----
const soonStep = (s) => h('div', { class: 'pro-soon-card' }, h('span', { class: 'mk-ptile' }, ic(s.icon, 18)), h('div', {}, h('strong', {}, s.soon), h('p', { class: 'muted' }, SOON)));

// ---- page ----
function stepList(cur) {
  return h('nav', { class: 'pro-steps', 'aria-label': 'Pro steps' }, h('ol', {}, STEPS.map((s, k) => h('li', { 'data-state': k < cur ? 'done' : k === cur ? 'now' : 'next' },
    h('span', { class: 'pro-dot', 'aria-hidden': 'true' }),
    h('a', { href: '#/pro/' + s.id, 'aria-current': k === cur ? 'page' : null }, ic(s.icon, 16), h('span', { class: 'nm' }, s.label), s.soon ? h('span', { class: 'pro-soon' }, 'Soon') : null)))));
}

// Below 900px the list becomes a segmented progress strip with previous and next arrows.
function strip(cur) {
  const arrow = (k, dir) => (STEPS[k] ? h('a', { class: 'pro-arrow', href: '#/pro/' + STEPS[k].id, 'aria-label': `${dir} step: ${STEPS[k].label}` }, ic(dir === 'Previous' ? 'back' : 'chevron', 18)) : h('span', { class: 'pro-arrow off', 'aria-hidden': 'true' }, ic(dir === 'Previous' ? 'back' : 'chevron', 18)));
  return h('div', { class: 'pro-strip' },
    h('div', { class: 'pro-progress', 'aria-hidden': 'true' }, STEPS.map((_, k) => h('i', { class: k <= cur ? 'on' : '' }))),
    h('div', { class: 'pro-strip-row' }, arrow(cur - 1, 'Previous'),
      selectEl(STEPS.map((s, k) => ({ value: s.id, label: `${k + 1}. ${s.label}${s.soon ? ' (soon)' : ''}` })), STEPS[cur].id, (v) => go('#/pro/' + v), 'pro-pick'),
      arrow(cur + 1, 'Next')));
}

export function render(param = '') {
  const [slug, arg] = String(param).split('/');
  const cur = Math.max(0, STEPS.findIndex((s) => s.id === slug));
  const s = STEPS[cur];
  need('market');
  if (data.ideas) watchIdeas();
  const sample = data.market?.latest?.sample === true;
  const body = s.soon ? soonStep(s) : s.id === 'rising' ? risingStep() : s.id === 'history' ? historyStep(arg) : s.id === 'score' ? scoreStep() : s.id === 'ideas' ? ideasStep() : s.id === 'thumbtest' ? thumbtestStep(data.market) : packsStep();
  return h('div', { class: 'page pro' },
    pageHead('Pro', 'Trend research and idea scoring, built on HQ\'s own chart history.', sample ? h('span', { class: 'chip static', 'data-tone': 'work' }, 'Sample data') : null),
    h('div', { class: 'pro-body' }, stepList(cur),
      h('section', { class: 'pro-panel', 'aria-labelledby': 'pro-title' }, strip(cur),
        h('header', { class: 'pro-head' }, h('h2', { id: 'pro-title' }, s.label), h('p', { class: 'muted' }, s.sub || 'On the list for later.')),
        body)));
}
