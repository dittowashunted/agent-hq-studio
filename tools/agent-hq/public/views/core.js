// Shared store, API helper, SSE, DOM helpers, overlays.
import { svg } from '../icons.js';

// Owner sign-in: scripts/Agent HQ.bat opens #owner=<token>. The fragment never reaches the server; keep it in this
// browser's storage and strip it from the address bar so it does not linger in history or screenshots.
function readOwnerToken() {
  const m = location.hash.match(/(?:^#|&)owner=([0-9a-f]{64})/);
  if (m) {
    try { localStorage.setItem('hq-owner', m[1]); } catch { /* private mode: token lives for this page only */ }
    history.replaceState(null, '', location.pathname + location.search + '#/home');
    return m[1];
  }
  try { return localStorage.getItem('hq-owner') || ''; } catch { return ''; }
}
export const token = readOwnerToken();
// A signed-in link opened in an existing tab only changes the fragment (no reload), so catch it here too.
window.addEventListener('hashchange', () => {
  const m = location.hash.match(/(?:^#|&)owner=([0-9a-f]{64})/);
  if (m && m[1] !== token) { readOwnerToken(); location.reload(); }
});
export function signOut() { try { localStorage.removeItem('hq-owner'); } catch { /* nothing stored */ } location.reload(); }

export const store = {
  tasks: [], asks: [], pitches: [], settings: {}, roles: [], running: [],
  studio: { holder: null }, engines: {}, lanes: {}, games: [],
  messages: {}, threads: {}, market: undefined, vault: null, library: null,
  gameList: [], freshness: null, freshAt: 0, lastChange: Date.now(), stageRequests: [],
  loaded: false, connected: false,
};

// ---------- subscriptions ----------
const subs = new Set();
let timer = 0;
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function notify() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = 0;
    for (const f of [...subs]) { try { f(); } catch (e) { console.error(e); } }
  }, 60);
}
const logSubs = new Set();
export function onLog(fn) { logSubs.add(fn); return () => logSubs.delete(fn); }

// ---------- API ----------
export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'x-hq-token': token, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error((data && (data.error || data.message)) || `Request failed (${res.status})`);
  return data;
}

// Run an async action, toast the result. Returns the value or undefined on error.
export async function act(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r === undefined ? true : r;
  } catch (e) {
    toast(e.message, 'error');
    return undefined;
  }
}

export function upsert(arr, row) {
  if (!row || !row.id) return;
  const i = arr.findIndex((x) => x.id === row.id);
  if (i >= 0) arr[i] = row; else arr.unshift(row);
}

let stateTimer = 0;
let threadTimer = 0;
export async function loadThreads() {
  try {
    const r = await api('GET', '/api/threads');
    const next = {};
    for (const t of Array.isArray(r) ? r : r.threads || []) next[t.role] = t;
    store.threads = next;
    notify();
  } catch { /* older server: no thread summaries */ }
}
export function threadsSoon() { clearTimeout(threadTimer); threadTimer = setTimeout(loadThreads, 300); }
export async function markRead(role) {
  const t = store.threads[role];
  if (t) t.unread = 0;
  try { await api('POST', `/api/threads/${encodeURIComponent(role)}/read`, {}); } catch { /* ignore */ }
}
export async function reloadMessages(role) {
  const r = await api('GET', '/api/messages?role=' + encodeURIComponent(role));
  store.messages[role] = Array.isArray(r) ? r : (r.messages || []);
  notify();
}
export async function loadState() {
  const s = await api('GET', '/api/state');
  for (const k of ['tasks', 'asks', 'pitches', 'roles', 'running', 'games']) if (Array.isArray(s[k])) store[k] = s[k];
  if (s.settings) store.settings = s.settings;
  if (s.studio) store.studio = s.studio;
  if (s.engines) store.engines = s.engines;
  if (s.lanes) store.lanes = s.lanes;
  if (Array.isArray(s.stageRequests)) store.stageRequests = s.stageRequests.filter((r) => r.state === 'open' || r.state === 'held');
  store.loaded = true;
  notify();
  loadThreads();
  loadGames();
}
function refreshSoon() {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => loadState().catch(() => {}), 250);
}

const loadingMsgs = new Set();
export async function loadMessages(role) {
  if (loadingMsgs.has(role)) return;
  loadingMsgs.add(role);
  try {
    const r = await api('GET', '/api/messages?role=' + encodeURIComponent(role));
    store.messages[role] = Array.isArray(r) ? r : (r.messages || []);
    notify();
  } catch (e) { toast(e.message, 'error'); } finally { loadingMsgs.delete(role); }
}

function dispatch(type, p) {
  if (type !== 'log' && !(type === 'settings' && p?.key === 'lanes')) store.lastChange = Date.now();
  if (type === 'task') { upsert(store.tasks, p); refreshSoon(); }
  else if (type === 'ask') { upsert(store.asks, p); }
  else if (type === 'pitch') { upsert(store.pitches, p); }
  else if (type === 'game') {
    const i = store.gameList.findIndex((g) => g.slug === p?.slug);
    if (i >= 0) store.gameList[i] = { ...store.gameList[i], ...p }; else if (p?.slug) store.gameList.push(p);
    refreshSoon();
  } else if (type === 'stage') {
    store.stageRequests = store.stageRequests.filter((r) => r.id !== p?.id);
    if (p?.state === 'open' || p?.state === 'held') store.stageRequests.unshift(p);
  }
  else if (type === 'message') {
    if (p && store.messages[p.role] && !store.messages[p.role].some((m) => m.id === p.id)) store.messages[p.role].push(p);
    threadsSoon();
  } else if (type === 'settings') {
    if (p && p.key === 'lanes') { store.lanes = p.value || {}; notify(); return; } // fires on every worker poll
    if (p && p.key) store.settings = { ...store.settings, [p.key]: p.value }; else refreshSoon();
    refreshSoon();
  } else if (type === 'log') {
    for (const f of [...logSubs]) f(p || {});
    return;
  } else return;
  notify();
}

export function startEvents() {
  const es = new EventSource('/api/events?token=' + encodeURIComponent(token));
  es.onopen = () => { const was = store.connected; store.connected = true; if (!was && store.loaded) refreshSoon(); notify(); };
  es.onerror = () => { store.connected = false; notify(); };
  for (const t of ['task', 'ask', 'pitch', 'settings', 'log', 'game', 'stage']) {
    es.addEventListener(t, (ev) => { try { dispatch(t, JSON.parse(ev.data)); } catch { /* ignore */ } });
  }
  // "message" is also the default SSE event name.
  es.onmessage = (ev) => {
    try {
      const d = JSON.parse(ev.data);
      if (d && d.type && 'payload' in d) dispatch(d.type, d.payload);
      else if (d && d.role && d.text !== undefined) dispatch('message', d);
    } catch { /* ignore */ }
  };
}

// ---------- DOM ----------
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v; // trusted icon markup only
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') e[k] = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return e;
}
export const ic = (name, size = 16) => h('span', { class: 'ic', html: svg(name, size) });

export function btn(label, onclick, { kind = '', icon = '', title = '', disabled = false } = {}) {
  return h('button', { type: 'button', class: 'btn ' + kind, onclick, title, disabled },
    icon ? ic(icon, 14) : null, label);
}

export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
}

export function selectEl(options, value, onchange, cls = '') {
  const s = h('select', { class: 'select ' + cls, onchange: (e) => onchange(e.target.value) },
    options.map((o) => h('option', { value: o.value }, o.label)));
  s.value = value ?? '';
  return s;
}

export function empty(text) { return h('div', { class: 'empty' }, text); }

export function pageHead(title, sub, ...actions) {
  return h('header', { class: 'page-head' },
    h('div', {}, h('h1', {}, title), sub ? h('p', { class: 'muted' }, sub) : null),
    h('div', { class: 'row gap' }, actions));
}

// ---------- helpers ----------
export const roleById = (id) => store.roles.find((r) => r.id === id);
export const roleLabel = (id) => roleById(id)?.label || id || '';
export function ago(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm';
  if (s < 86400) return Math.round(s / 3600) + 'h';
  return Math.round(s / 86400) + 'd';
}
export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export function mediaUrl(p) {
  if (!p) return '';
  const clean = String(p).replace(/\\/g, '/').replace(/^\.agent-hq\/media\//, '').replace(/^\/+/, '');
  return '/media/' + clean.split('/').map(encodeURIComponent).join('/');
}
export const assetUrl = (rel) => '/media/assets/' + String(rel).replace(/^assets\//, '').split('/').map(encodeURIComponent).join('/');
export const go = (hash) => { location.hash = hash; };
export const ENGINES = [
  { value: 'app', label: 'Claude app' },
  { value: 'antigravity', label: 'Antigravity (design)' },
  { value: 'claude-cli', label: 'Claude CLI (optional)' },
  { value: 'groq', label: 'Groq' },
  { value: 'nim', label: 'NVIDIA NIM' },
  { value: 'echo', label: 'Echo (test)' },
];
const LEGACY = { claude: 'claude-cli', agy: 'antigravity', manual: 'app' };
export const normEngine = (e) => LEGACY[e] || e || '';
export const engineLabel = (e) => ENGINES.find((x) => x.value === normEngine(e))?.label || e || '';
export function engineOf(roleId) {
  const r = roleById(roleId);
  const o = store.settings.roleEngines?.[roleId] || {};
  return { engine: normEngine(o.engine) || r?.engine || 'app', model: o.model || r?.model || '' };
}

// ---- roles: avatar and status ----
export const roleColor = (id) => roleById(id)?.color || '#8d95a5';
export const roleColor2 = (id) => roleById(id)?.color2 || roleColor(id);
export const roleIcon = (id) => roleById(id)?.icon || 'flag';
export function avatar(id, size = 36) {
  const st = roleStatus(id);
  const ring = st.state === 'working' ? 'working' : st.queued ? 'queued' : null;
  return h('span', { class: 'avatar', 'data-ring': ring, style: `--c:${roleColor(id)};--c2:${roleColor2(id)};width:${size}px;height:${size}px`, title: roleLabel(id) }, ic(roleIcon(id), Math.round(size * 0.5)));
}
// Dollars spent by tasks that started in the last `days` days.
// ponytail: /api/state caps tasks at 500, so a very busy week undercounts; add a server-side sum if that matters.
export function agentSpend(days = 7) {
  const from = Date.now() - days * 86400000;
  return store.tasks.reduce((sum, t) => sum + (t.costUsd > 0 && t.startedAt && new Date(t.startedAt).getTime() >= from ? Number(t.costUsd) : 0), 0);
}
// working > review > queued > idle
export function roleStatus(id) {
  let q = 0; let rv = false; let w = null;
  for (const t of store.tasks) {
    if (t.role !== id) continue;
    if (t.state === 'working') w = w || t;
    else if (t.state === 'review') rv = true;
    else if (t.state === 'queued') q++;
  }
  return { state: w ? 'working' : rv ? 'review' : q ? 'queued' : 'idle', task: w, queued: q };
}

export const LANE_DEFAULTS = {
  app: { enabled: true, everyMinutes: 60, activeFrom: '00:00', activeTo: '24:00', maxTasks: 8 },
  antigravity: { enabled: true, everyMinutes: 20, activeFrom: '00:00', activeTo: '24:00', maxTasks: 6 },
};
export const laneCfg = (id) => ({ ...LANE_DEFAULTS[id], ...(store.settings.laneSchedules?.[id] || {}) });

export const LANES = [
  { id: 'app', name: 'Claude app worker', how: 'In Claude Code desktop, run /hq-worker, or let the scheduled HQ worker run it.' },
  { id: 'antigravity', name: 'Antigravity design lane', how: "Enable 'Agent HQ design lane' in Antigravity > Automations, or run /hq-design in Antigravity." },
];
export function lastSeen(laneId) {
  const iso = store.lanes?.[laneId]?.lastSeenAt;
  if (!iso) return 'never';
  const a = ago(iso);
  return a === 'just now' ? a : a + ' ago';
}
export function laneFresh(laneId) {
  const iso = store.lanes?.[laneId]?.lastSeenAt;
  return !!iso && Date.now() - new Date(iso).getTime() < 30 * 60 * 1000;
}

export function statePill(state) { return h('span', { class: 'pill', 'data-state': state }, state); }

// ---------- toasts and overlays ----------
export function toast(msg, kind = '') {
  const t = h('div', { class: 'toast ' + kind, role: kind === 'error' ? 'alert' : 'status' }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3000);
}

function overlay(cls, title, body, onClose) {
  const root = document.getElementById('overlay');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    back.remove();
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: cls, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'overlay-head' },
      h('h2', {}, title),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: close, html: svg('x') })),
    h('div', { class: 'overlay-body' }, body));
  const back = h('div', { class: 'backdrop', onmousedown: (e) => { if (e.target === back) close(); } }, box);
  root.append(back);
  document.addEventListener('keydown', onKey);
  return close;
}
export const openModal = (title, body, onClose) => overlay('modal', title, body, onClose);
export const openDrawer = (title, body, onClose) => overlay('drawer', title, body, onClose);

// ---------- r5 helpers: games, freshness, uploads, role suggestion ----------
export const plain = (s) => String(s || '')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/[*`~]/g, '')
  .replace(/^\s*(#{1,6}|[-*>]|\d+\.)\s+/gm, '')
  .replace(/\s+/g, ' ')
  .trim();

export const gameName = (slug) => (store.gameList.find((g) => g.slug === slug) || store.games.find((g) => g.slug === slug))?.name || slug || '';

// ---------- game scope: the topbar switcher narrows Home, Tasks, Review and Pitches to one game ----------
const knownGames = () => (store.gameList.length ? store.gameList : store.games);
let scopeSlug = null;
try { scopeSlug = localStorage.getItem('hq-scope') || null; } catch { /* private mode: scope lasts for this page only */ }
// A saved scope for a game that no longer exists must not hide everything, so it reads as "all games" until the list says otherwise.
export function scope() {
  const list = knownGames();
  return scopeSlug && (!list.length || list.some((g) => g.slug === scopeSlug)) ? scopeSlug : null;
}
export function setScope(slug) {
  scopeSlug = slug || null;
  try { if (scopeSlug) localStorage.setItem('hq-scope', scopeSlug); else localStorage.removeItem('hq-scope'); } catch { /* not persisted */ }
  notify();
}
// The game an item belongs to: a task or pitch carries it; an ask takes its task's game. Empty when it has none.
// A pitch's `game` is an object (howItPlays, first60s...), not a slug, so only a string counts.
export const itemGame = (item) => (typeof item?.game === 'string' && item.game) || (item?.taskId ? store.tasks.find((t) => t.id === item.taskId)?.game : '') || '';
export function inScope(item) {
  const s = scope();
  if (!s) return true;
  const g = itemGame(item);
  return !g || g === s;
}
// Under "All games" with more than one game, lists group by game. byGame returns [[slug or '', items]], No game last.
export const multiGame = () => !scope() && knownGames().length > 1;
export function byGame(list, gameOf = itemGame) {
  const m = new Map();
  for (const x of list) { const g = gameOf(x) || ''; if (!m.has(g)) m.set(g, []); m.get(g).push(x); }
  return [...m].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : knownGames().findIndex((g) => g.slug === a) - knownGames().findIndex((g) => g.slug === b)));
}
export const gameHead = (slug, n) => h('h3', { class: 'game-group' }, slug ? gameName(slug) : 'No game', h('span', { class: 'count' }, n));
export const gameChip = (slug) => (slug ? h('span', { class: 'chip static game-chip', title: 'Game' }, gameName(slug)) : null);
// Role display order for the sidebar team grid and Live now; ids not listed keep their place at the end.
const ROSTER = ['lead', 'scout', 'architect', 'librarian', 'builder', 'ui', 'world', 'playtester', 'kid-tester', 'economy', 'thumbnails', 'producer', 'liveops', 'merchant', 'reviewer', 'designer'];
export function rosterOrder(roles) {
  const at = (r) => { const i = ROSTER.indexOf(r.id ?? r); return i < 0 ? ROSTER.length : i; };
  return [...roles].sort((a, b) => at(a) - at(b));
}

export function creatorLabel(c) {
  if (!c || c === 'owner') return 'you';
  if (c === 'lead') return 'Lead';
  if (c === 'schedule') return 'a schedule';
  if (c === 'gate') return 'a check';
  return roleById(c) ? roleLabel(c) : c;
}

export async function loadGames() {
  try {
    const r = await api('GET', '/api/games');
    store.gameList = Array.isArray(r) ? r : r.games || [];
    notify();
  } catch { /* server without /api/games: state.games is used */ }
}
export async function loadFreshness() {
  store.freshAt = Date.now();
  try { store.freshness = await api('GET', '/api/freshness'); } catch { store.freshness = store.freshness || {}; }
  notify();
}
export async function refreshAll() {
  await Promise.all([loadState(), loadFreshness()]);
  toast('Refreshed');
}

// First matching keyword group wins; the order matters ("shop buttons" is a UI job).
const SUGGEST = [
  ['ui', /\b(ui|screens?|buttons?|hud|menus?|layout|panels?)\b/],
  ['thumbnails', /\b(thumbnails?|icons?)\b/],
  ['designer', /\b(concepts?|mock-?ups?|mock ups?)\b/],
  ['merchant', /\b(price|prices|pricing|shop|passes|pass|gamepass|robux|products?)\b/],
  ['builder', /\b(server|remotes?|saves?|saving|bugs?|datastore|crash(es)?)\b/],
  ['economy', /\b(balance|balancing|economy|rewards?|payouts?)\b/],
  ['kid-tester', /\b(kids?|new players?|beginners?)\b/],
  ['playtester', /\b(tests?|testing|play|playtest)\b/],
  ['scout', /\b(ideas?|trends?|market|competitors?)\b/],
  ['world', /\b(map|terrain|lighting|world|environment)\b/],
  ['architect', /\b(plan|spec|architecture)\b/],
  ['reviewer', /\b(review|security|audit|exploits?)\b/],
  ['librarian', /\b(assets?|models?|sounds?|music)\b/],
  ['liveops', /\b(funnels?|retention|metrics|analytics)\b/],
  ['producer', /\b(stage|ship|release)\b/],
];
export function suggestRole(text) {
  const t = String(text || '').toLowerCase();
  for (const [role, re] of SUGGEST) if (re.test(t) && roleById(role)) return role;
  return '';
}

// Upload a pasted or dropped image. Returns the stored path ("uploads/<id>.png").
export async function uploadImage(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Only PNG, JPEG or WebP images can be attached');
  if (file.size > 5 * 1024 * 1024) throw new Error('That image is over 5 MB');
  const dataBase64 = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = () => reject(new Error('Could not read the image'));
    fr.readAsDataURL(file);
  });
  const r = await api('POST', '/api/uploads', { name: file.name || 'screenshot.png', mime: file.type, dataBase64 });
  return r.path;
}
export const imageFiles = (dt) => [...(dt?.files || [])].filter((f) => f.type.startsWith('image/'));

// Studio locks, tolerant of the older {holder} shape.
export function studioLocks() {
  const s = store.studio || {};
  if (Array.isArray(s.locks)) return s.locks;
  const t = s.holder ? store.tasks.find((x) => x.id === s.holder) : null;
  return t ? [{ taskId: t.id, role: t.role, game: t.game, since: t.startedAt, lane: 1 }] : [];
}
