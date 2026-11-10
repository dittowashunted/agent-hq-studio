// Games: Overview, Live numbers, Pipeline. One tab per game.
import { h, ic, store, api, act, btn, empty, pageHead, statePill, roleLabel, avatar, ago, fmtTime, openDrawer, openModal, notify, toast, field } from './core.js';
import { render as renderGate, requestActions } from './gate.js';
import { chip, segmented } from './charts.js';
import { liveBoard } from './live.js';

export const STAGES = [
  { id: 'pitched', name: 'Pitched', owner: 'Scout', roles: ['scout'] },
  { id: 'designed', name: 'Designed', owner: 'Architect', roles: ['architect'] },
  { id: 'assets', name: 'Assets ready', owner: 'Librarian', roles: ['librarian'] },
  { id: 'built', name: 'Built', owner: 'Builder + UI', roles: ['builder', 'ui'] },
  { id: 'balanced', name: 'Balanced', owner: 'Economy', roles: ['economy'] },
  { id: 'art', name: 'Art done', owner: 'Thumbnails', roles: ['thumbnails', 'designer'] },
  { id: 'ready', name: 'Ready to publish', owner: 'Builder', roles: ['merchant', 'producer'] },
  { id: 'live', name: 'Live', owner: 'Only you', roles: [] },
  { id: 'graded', name: 'Graded', owner: 'Live ops', roles: ['liveops'] },
];
const stageIdx = (id) => STAGES.findIndex((s) => s.id === id);
const stageName = (id) => STAGES.find((s) => s.id === id)?.name || id;
const stageOfRole = (role) => STAGES.find((s) => s.roles.includes(role))?.id || null;

// Shared bits live in charts.js; re-exported here for the other pages.
export { num, chip, tile, segmented, lineChart } from './charts.js';

// ---------- data ----------
let gamesList = null;
let gamesAt = 0;
let loadingGames = false;
const liveCache = {};
const reqCache = { rows: null, at: 0 };
let slug = '';
let tab = 'overview';
let chartTab = 'trends';

async function loadGames(force) {
  if (loadingGames || (!force && gamesList && Date.now() - gamesAt < 15000)) return;
  loadingGames = true;
  try {
    const r = await api('GET', '/api/games');
    const next = Array.isArray(r) ? r : r.games || [];
    const same = JSON.stringify(next) === JSON.stringify(gamesList);
    gamesList = next; gamesAt = Date.now();
    loadingGames = false;
    if (same) return;
  } catch (e) { toast(e.message, 'error'); gamesList = gamesList || []; gamesAt = Date.now(); }
  loadingGames = false;
  notify();
}
async function loadRequests(force) {
  if (reqCache.loading || (!force && reqCache.rows && Date.now() - reqCache.at < 15000)) return;
  reqCache.loading = true;
  let changed = true;
  try {
    const r = await api('GET', '/api/stage-requests');
    const next = Array.isArray(r) ? r : r.requests || r.rows || [];
    changed = JSON.stringify(next) !== JSON.stringify(reqCache.rows); reqCache.rows = next;
  } catch { changed = !reqCache.rows; reqCache.rows = reqCache.rows || []; }
  reqCache.at = Date.now(); reqCache.loading = false;
  if (changed) notify();
}
async function loadLive(g, force) {
  const c = liveCache[g] || (liveCache[g] = {});
  if (c.loading || (!force && c.data && Date.now() - c.at < 30000)) return;
  c.loading = true;
  let changed = true;
  try { const next = await api('GET', `/api/games/${encodeURIComponent(g)}/live`); changed = JSON.stringify(next) !== JSON.stringify(c.data); c.data = next; } catch (e) { c.error = e.message; changed = !c.data; c.data = c.data || { series: [], metrics: {}, targets: {}, attention: [] }; }
  c.at = Date.now(); c.loading = false;
  if (changed) notify();
}
const kickedCache = { rows: null, at: 0 };
async function loadKicked(force) {
  if (kickedCache.loading || (!force && kickedCache.rows && Date.now() - kickedCache.at < 15000)) return;
  kickedCache.loading = true;
  let changed = true;
  try { const r = await api('GET', '/api/stage-requests?state=rejected'); const next = Array.isArray(r) ? r : r.requests || r.rows || []; changed = JSON.stringify(next) !== JSON.stringify(kickedCache.rows); kickedCache.rows = next; } catch { changed = !kickedCache.rows; kickedCache.rows = kickedCache.rows || []; }
  kickedCache.at = Date.now(); kickedCache.loading = false; if (changed) notify();
}
const reloadAll = async (g) => { await Promise.all([loadGames(true), loadRequests(true), loadKicked(true), g ? loadLive(g, true) : null]); };

// ---------- overview ----------
function editableText(label, value, onSave, { multiline = false, placeholder = '' } = {}) {
  let editing = false;
  const box = h('div', {});
  const draw = () => {
    box.replaceChildren();
    if (!editing) {
      box.append(h('div', { class: 'pg-inline-edit' },
        h('span', { class: value ? '' : 'muted' }, value || placeholder || 'Nothing yet'),
        btn('Edit', () => { editing = true; draw(); }, { kind: 'sm' })));
      return;
    }
    const input = multiline ? h('textarea', { class: 'pg-input', rows: 3, value: value || '', maxlength: 2000 }) : h('input', { class: 'pg-input grow', value: value || '', maxlength: 300 });
    box.append(h('div', { class: 'pg-inline-edit' }, input,
      btn('Save', async () => { if (await act(() => onSave(input.value.trim()), 'Saved')) { editing = false; } }, { kind: 'primary sm' }),
      btn('Cancel', () => { editing = false; draw(); }, { kind: 'sm' })));
    input.focus();
  };
  draw();
  return h('div', { class: 'pg-kv' }, h('h4', {}, label), box);
}

const patchGame = (g, body) => api('PATCH', `/api/games/${encodeURIComponent(g.slug)}`, body).then(() => reloadAll(g.slug));

function openWork(g) {
  const rows = store.tasks.filter((t) => t.game === g.slug && ['queued', 'working', 'review'].includes(t.state));
  const order = { working: 0, review: 1, queued: 2 };
  rows.sort((a, b) => order[a.state] - order[b.state]);
  return h('section', { class: 'pg-card' },
    h('h3', {}, `Open work (${rows.length})`),
    rows.length ? h('div', { class: 'pg-work' }, rows.map((t) => h('div', { class: 'pg-work-row' },
      h('div', { class: 'row gap', style: 'min-width:0' }, avatar(t.role, 24), h('a', { class: 'title', href: '#/tasks', title: t.title }, t.title),
        h('span', { class: 'muted nowrap' }, roleLabel(t.role))),
      statePill(t.state)))) : h('p', { class: 'muted' }, 'Nothing open for this game. Ask the Lead to plan the next step.'));
}

function todoCard(g) {
  const todos = g.todos || [];
  return h('section', { class: 'pg-card' },
    h('h3', {}, `On your to-do list (${todos.length})`),
    todos.length ? h('ul', { class: 'pg-list' }, todos.map((a) => h('li', {},
      chip(a.kind === 'try' ? 'try it' : a.kind, 'warn'), h('span', {}, a.title), h('a', { href: '#/review' }, 'Open in Review'))))
      : h('p', { class: 'muted' }, 'Nothing is waiting on you for this game.'));
}

function overview(g) {
  const cl = g.changelog;
  const si = stageIdx(g.stage);
  const nextStage = STAGES[si + 1];
  return h('div', { class: 'stack' },
    h('div', { class: 'pg-grid2' },
      h('section', { class: 'pg-card' },
        h('div', { class: 'row gap wrap' }, h('h3', {}, 'Version ', h('span', { class: 'pg-ver' }, 'v' + (g.version ?? 1))), chip(stageName(g.stage), 'accent'),
          g.versionType ? chip(g.versionType) : null, h('span', { class: 'muted push' }, g.updatedAt ? 'updated ' + ago(g.updatedAt) + (ago(g.updatedAt) === 'just now' ? '' : ' ago') : '')),
        editableText('Next step', g.nextStep, (v) => patchGame(g, { nextStep: v }), { placeholder: 'Not set' }),
        editableText('Note', g.note, (v) => patchGame(g, { note: v }), { multiline: true, placeholder: 'Add a note for the team' }),
        nextStage ? h('p', { class: 'pg-note' }, `Next stage: ${nextStage.name} (${nextStage.owner}). Agents ask for it with a stage request; you decide in Review.`) : null,
        g.reworkCount ? h('p', { class: 'pg-note' }, `Sent back for rework ${g.reworkCount} ${g.reworkCount === 1 ? 'time' : 'times'}.`) : null,
        h('div', { class: 'row gap' }, h('a', { class: 'btn', href: `#/games/${encodeURIComponent(g.slug)}/gate` }, ic('lock', 14), 'Open the publish gate'))),
      h('section', { class: 'pg-card' },
        h('h3', {}, `What's new in v${g.version ?? 1}`),
        cl && (cl.heading || (cl.bullets || []).length) ? h('div', { class: 'stack sm' },
          cl.heading ? h('strong', {}, cl.heading) : null,
          h('ul', { class: 'pg-bullets' }, (cl.bullets || []).map((b) => h('li', {}, b))))
          : h('div', { class: 'pg-empty' }, ic('sparkles', 22), h('strong', {}, 'Nothing new yet'), h('p', {}, 'The Producer fills this in with what changed when a version ships.')))),
    h('div', { class: 'pg-grid2' }, openWork(g), todoCard(g)));
}

// ---------- live numbers ----------
function liveTab(g) {
  const c = liveCache[g.slug];
  if (!c || !c.data) { loadLive(g.slug); return empty('Reading the studio'); }
  return liveBoard(g, c.data, { chartTab, setChartTab: (id) => { chartTab = id; notify(); }, reload: () => reloadAll(g.slug), all: gamesList || [] });
}

// ---------- pipeline ----------
function stageRequestsFor(g) { return (reqCache.rows || []).filter((r) => r.game === g.slug); }

function drawerForGame(g) {
  const reqs = stageRequestsFor(g).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const reload = () => reloadAll(g.slug);
  const tone = { approved: 'ok', rejected: 'err', held: 'warn', open: 'warn' };
  const body = h('div', { class: 'stack' },
    h('div', { class: 'row gap wrap' }, chip(stageName(g.stage), 'accent'), h('span', { class: 'muted' }, 'v' + (g.version ?? 1)),
      g.reworkCount ? chip(`sent back ${g.reworkCount}x`, 'warn') : null),
    h('p', {}, g.nextStep ? 'Next: ' + g.nextStep : 'No next step set.'),
    h('h4', {}, 'Stage history and requests'),
    reqs.length ? h('ul', { class: 'pg-hist' }, reqs.map((r) => h('li', {},
      h('div', { class: 'row gap wrap' }, h('strong', {}, `${stageName(r.fromStage)} to ${stageName(r.toStage)}`), chip(r.state, tone[r.state])),
      h('span', { class: 'muted' }, `${roleLabel(r.role)} asked ${ago(r.createdAt)}${ago(r.createdAt) === 'just now' ? '' : ' ago'}`),
      r.evidence ? h('p', { class: 'pre' }, r.evidence) : null,
      r.reason ? h('p', { class: 'pre' }, h('strong', {}, 'Your reason: '), r.reason) : null,
      (r.criteriaFailed || []).length ? h('div', { class: 'row gap wrap' }, r.criteriaFailed.map((c) => chip(c, 'err'))) : null,
      ['open', 'held'].includes(r.state) ? requestActions(r, reload) : null)))
      : h('p', { class: 'muted' }, 'No stage requests yet. When a role thinks the game is ready for the next stage it asks here.'),
    g.stage === 'ready' ? h('div', { class: 'pg-foot' },
      h('p', { class: 'pg-note' }, 'Only you publish. After publishing the game yourself in Roblox, go to the publish gate to mark it live.'),
      h('a', { class: 'btn primary', href: `#/games/${encodeURIComponent(g.slug)}/gate`, onclick: () => document.querySelector('.backdrop')?.remove() }, ic('lock', 14), 'Open the publish gate')) : null);
  openDrawer(g.name, body);
}

function kickedBack(g) {
  const rows = (kickedCache.rows || []).filter((r) => r.game === g.slug);
  if (!rows.length) return null;
  return h('section', { class: 'pg-card' },
    h('h3', {}, `Kicked back (${rows.length})`),
    h('p', { class: 'pg-note' }, 'Requests you rejected. For context only; the role reworks and asks again.'),
    h('ul', { class: 'pg-list' }, rows.slice(0, 12).map((r) => h('li', {},
      h('strong', {}, `${stageName(r.fromStage)} to ${stageName(r.toStage)}`), h('span', { class: 'muted' }, roleLabel(r.role) + ', ' + ago(r.decidedAt || r.createdAt) + ' ago'),
      r.reason ? h('span', {}, r.reason) : null, ...(r.criteriaFailed || []).map((c) => chip(c, 'err'))))));
}

function pipeline(g) {
  if (!reqCache.rows) { loadRequests(); }
  loadKicked();
  const reqs = stageRequestsFor(g).filter((r) => r.state === 'open');
  const tasks = store.tasks.filter((t) => t.game === g.slug && ['queued', 'working', 'review'].includes(t.state));
  const cur = stageIdx(g.stage);
  return h('div', { class: 'stack' },
    h('p', { class: 'pg-note' }, 'Each column is a stage and the role that owns it. The game card sits in its current stage. Open stage requests (a role asking to move on) and open tasks show in the column they belong to. Only the next stage can be requested, and "Live" is yours alone.'),
    h('div', { class: 'pg-board' }, STAGES.map((s, i) => {
      const cards = [];
      if (s.id === g.stage) {
        cards.push(h('button', { type: 'button', class: 'pg-pcard', 'data-kind': 'game', onclick: () => drawerForGame(g) },
          h('span', { class: 't' }, g.name), h('span', { class: 'm' }, chip('here now', 'accent'), 'v' + (g.version ?? 1), g.updatedAt ? 'updated ' + ago(g.updatedAt) : ''),
          h('span', { class: 'm' }, i < STAGES.length - 1 ? 'Next role: ' + STAGES[i + 1].owner : 'Last stage')));
      }
      for (const r of reqs.filter((r) => r.fromStage === s.id)) {
        cards.push(h('button', { type: 'button', class: 'pg-pcard', 'data-kind': 'request', onclick: () => drawerForGame(g) },
          h('span', { class: 't' }, `Ready for ${stageName(r.toStage)}?`), h('span', { class: 'm' }, chip('waiting for you', 'warn'), roleLabel(r.role), ago(r.createdAt))));
      }
      for (const t of tasks.filter((t) => stageOfRole(t.role) === s.id)) {
        cards.push(h('button', { type: 'button', class: 'pg-pcard', onclick: () => drawerForGame(g) },
          h('span', { class: 't' }, t.title), h('span', { class: 'm' }, statePill(t.state), roleLabel(t.role), ago(t.createdAt), t.reworkCount ? chip(`reworked ${t.reworkCount}x`, 'warn') : null)));
      }
      return h('section', { class: 'pg-col', 'data-current': String(s.id === g.stage), 'aria-label': s.name },
        h('div', { class: 'pg-col-head' }, h('span', { class: 'n' }, s.name, h('span', { class: 'pg-count' }, cards.length)), h('span', { class: 'o' }, s.owner)),
        h('div', { class: 'pg-col-body' }, cards.length ? cards : h('span', { class: 'pg-col-empty' }, i < cur ? 'Done' : 'Nothing here')));
    })),
    kickedBack(g));
}

// ---------- page ----------
export function addGame() {
  const name = h('input', { class: 'pg-input', placeholder: 'Run a ___', maxlength: 80 });
  const id = h('input', { class: 'pg-input', placeholder: 'short-id', maxlength: 40 });
  let close;
  const form = h('form', { class: 'pg-form', onsubmit: async (e) => {
    e.preventDefault();
    const n = name.value.trim(); const s = (id.value.trim() || n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!n || !s) { toast('Give the game a name', 'error'); return; }
    if (await act(() => api('POST', '/api/games', { slug: s, name: n }), 'Game added')) { slug = s; tab = 'overview'; close(); await loadGames(true); }
  } },
  field('Name', name), field('Short id', id, 'Letters, numbers and dashes. Leave empty to build it from the name.'),
  h('div', { class: 'row gap end' }, btn('Add game', null, { kind: 'primary' })));
  form.querySelector('button').type = 'submit';
  close = openModal('Add a game', form);
}

export function render(param) {
  const [first, second] = String(param || '').split('/');
  if (first && second === 'gate') return renderGate(first);
  param = first;
  loadGames();
  if (!reqCache.rows) loadRequests();
  const list = gamesList || (store.games || []).map((g) => ({ ...g, stage: 'built', version: 1 }));
  if (param && list.some((g) => g.slug === param)) slug = param;
  if (!list.some((g) => g.slug === slug)) slug = list[0]?.slug || '';
  const g = list.find((x) => x.slug === slug);
  const head = pageHead('Games', 'Where each game is, how it is doing, and what stands between it and the next stage.', btn('Add game', addGame, { icon: 'plus' }));
  if (!g) return h('div', { class: 'page' }, head, empty(gamesList ? 'No games yet.' : 'Loading'));
  const items = [['overview', 'Overview'], ['live', 'Live numbers'], ['pipeline', 'Pipeline']];
  const open = store.tasks.filter((t) => t.game === g.slug && ['queued', 'working', 'review'].includes(t.state)).length;
  return h('div', { class: 'page' }, head,
    list.length > 1 ? h('div', { class: 'pg-gametabs', role: 'tablist', 'aria-label': 'Games' }, list.map((x) => h('button', { type: 'button', role: 'tab', class: 'pg-gametab', 'aria-selected': String(x.slug === slug),
      onclick: () => { slug = x.slug; location.hash = '#/games/' + x.slug; notify(); } }, x.name))) : h('h2', {}, g.name),
    h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Game view' }, items.map(([id, label]) => h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(id === tab), onclick: () => { tab = id; notify(); } },
      label, id === 'overview' && open ? h('span', { class: 'count', 'data-tone': 'violet' }, open) : null))),
    tab === 'overview' ? overview(g) : tab === 'live' ? liveTab(g) : pipeline(g));
}
