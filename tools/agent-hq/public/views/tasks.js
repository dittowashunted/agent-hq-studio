// Tasks list and task drawer.
import { h, store, api, act, ic, btn, empty, pageHead, statePill, roleLabel, avatar, ago, fmtTime, engineLabel, selectEl, plain, gameName, creatorLabel, mediaUrl,
  openModal, openDrawer, subscribe, onLog, upsert, notify, go, loadState, toast, inScope, scope, multiGame, byGame, gameHead, gameChip, token } from './core.js';
import { popMenu } from './menu.js';
import { taskForm } from './taskform.js';

let roleFilter = '';
let gameFilter = '';
let showDone = false;

const GROUPS = [
  ['review', 'Back to you', 'Finished: check it, then Looks good or Needs changes', ['review'], 'amber'],
  ['working', 'Working now', "Live in the agent's chat", ['working'], 'green'],
  ['queued', 'Queued', 'Runs as soon as the agent is free, in order', ['queued'], 'blue'],
];
const PILL = { review: ['amber', 'Back to you'], working: ['green', 'Working now'], queued: ['blue', 'Queued'] };

// Tinted status pill for the list rows (no dot, no border); the drawer keeps statePill.
function rowPill(state) {
  const [tone, text] = PILL[state] || ['grey', state];
  return h('span', { class: 'tpill', 'data-tone': tone }, text);
}

const since = (iso) => ago(iso) + (ago(iso) === 'just now' ? '' : ' ago');
// Working rows say when they started; every other row says how long ago it last changed.
function startedText(t) {
  if (t.state === 'working') return 'started ' + since(t.startedAt);
  return since(t.state === 'queued' ? t.createdAt : t.endedAt || t.startedAt || t.createdAt);
}

export function taskRow(t) {
  const gate = t.createdBy === 'gate' || t.gateFor;
  const meta = [roleLabel(t.role), 'from ' + creatorLabel(t.createdBy), startedText(t)].filter(Boolean).join(' · ');
  return h('button', { type: 'button', class: 'trow', 'data-state': t.state, onclick: () => openTaskDrawer(t.id) },
    avatar(t.role, 30),
    h('span', { class: 'trow-main' },
      h('span', { class: 'trow-title' }, plain(t.title),
        scope() ? null : gameChip(t.game),
        gate ? h('span', { class: 'chip static', title: 'Automatic check of another task' }, 'gate') : null,
        t.attempt > 1 ? h('span', { class: 'chip static', title: 'Rework round' }, 'attempt ' + t.attempt) : null,
        t.reworkCount > 0 ? h('span', { class: 'chip static', title: 'Times sent back for rework' }, `sent back ${t.reworkCount}x`) : null,
        t.needsStudio ? h('span', { class: 'chip static', title: 'Needs Studio' }, ic('lock', 11), 'Studio') : null),
      h('span', { class: 'trow-meta muted' }, meta)),
    t.state === 'working' ? h('span', { class: 'spin-ring', role: 'img', 'aria-label': 'Working' }) : null,
    rowPill(t.state),
    ic('chevron', 16));
}

// ---- Back to you: a finished task waiting for the owner's verdict ----
const btyOpen = new Set();
const btyDraft = {};
export const pendingGates = (t) => store.tasks.some((g) => g.gateFor === t.id && ['queued', 'working'].includes(g.state));
export const isBackToYou = (t) => t.state === 'review' && t.createdBy !== 'gate' && !t.gateFor && !pendingGates(t);

export function backToYou(t, { compact = false } = {}) {
  const open = btyOpen.has(t.id);
  const ta = open ? h('textarea', { class: 'textarea', rows: 3, placeholder: 'What should change?', 'aria-label': 'What should change', oninput: (e) => { btyDraft[t.id] = e.target.value; } }) : null;
  if (ta) ta.value = btyDraft[t.id] || '';
  const send = async (verdict, note) => {
    const r = await act(() => api('POST', `/api/tasks/${t.id}/verdict`, note ? { verdict, note } : { verdict }), verdict === 'approve' ? 'Done. Marked as finished.' : 'Sent back for rework');
    if (r) { btyOpen.delete(t.id); delete btyDraft[t.id]; loadState().catch(() => {}); notify(); }
  };
  return h('div', { class: 'block bty' + (compact ? ' compact' : '') },
    compact ? null : h('h4', {}, 'Back to you'),
    h('h4', {}, 'What was asked'),
    h('p', { class: 'pre' }, plain(t.title) + (t.body && !compact ? '\n' + t.body : '')),
    h('h4', {}, 'Result'),
    h('p', { class: 'pre' + (t.summary ? '' : ' muted') }, t.summary || 'The agent did not write a summary.'),
    ta,
    h('div', { class: 'row gap wrap' },
      btn('Looks good', () => send('approve'), { kind: 'primary', icon: 'check' }),
      open
        ? btn('Send it back', () => { const n = ta.value.trim(); if (!n) { ta.focus(); toast('Say what should change', 'error'); return; } send('changes', n); }, { kind: 'danger' })
        : btn('Needs changes: say what', () => { btyOpen.add(t.id); notify(); }),
      open ? btn('Cancel', () => { btyOpen.delete(t.id); notify(); }, { kind: 'ghost' }) : null));
}

export function newTaskModal(role) {
  const close = openModal(role ? 'New task for ' + roleLabel(role) : 'New task',
    taskForm({ key: 'modal:' + (role || ''), role, onDone: () => { close(); notify(); } }));
}

// One list, or under All games with several games a list per game (No game last).
const rowsByGame = (list) => (multiGame() ? byGame(list, (t) => t.game).map(([g, l]) => [gameHead(g, l.length), h('div', { class: 'tlist' }, l.map(taskRow))]) : h('div', { class: 'tlist' }, list.map(taskRow)));
const clearFinished = async () => {
  const body = h('div', { class: 'stack' }, h('p', {}, 'This deletes done and canceled tasks that ended over an hour ago, and their answered requests. Open work is kept.'),
    h('div', { class: 'row gap end' }, btn('Cancel', () => close(), { kind: 'ghost' }), btn('Clear finished work', async () => {
      const r = await act(() => api('POST', '/api/tasks/clear-finished'), 'Cleared');
      close();
      if (r) { await loadState().catch(() => {}); notify(); }
    }, { kind: 'danger' })));
  const close = openModal('Clear finished work?', body);
};

export function render() {
  const games = store.gameList.length ? store.gameList : store.games;
  const tasks = store.tasks.filter((t) => inScope(t) && (!roleFilter || t.role === roleFilter) && (!gameFilter || t.game === gameFilter));
  const byAge = (a, b) => (a.createdAt < b.createdAt ? -1 : 1);
  const groups = GROUPS.map(([id, label, sub, states, tone]) => {
    const list = tasks.filter((t) => states.includes(t.state)).sort(byAge);
    return list.length ? h('section', { class: 'tgroup', 'aria-label': label },
      h('h2', { class: 'tgroup-head' }, h('span', { class: 'count', 'data-tone': tone }, list.length), h('span', { class: 'tgroup-title' }, label), h('span', { class: 'muted tgroup-sub' }, sub)),
      rowsByGame(list)) : null;
  }).filter(Boolean);
  const done = tasks.filter((t) => ['done', 'failed', 'canceled'].includes(t.state))
    .sort((a, b) => ((b.endedAt || b.createdAt) < (a.endedAt || a.createdAt) ? -1 : 1));
  const doneBox = done.length ? h('details', { class: 'tdone', open: showDone, ontoggle: (e) => { showDone = e.target.open; } },
    h('summary', {}, `Show done and dropped (${done.length})`),
    rowsByGame(done.slice(0, 100))) : null;
  return h('div', { class: 'page' },
    pageHead('Tasks', 'Everything queued for the team.',
      selectEl([{ value: '', label: 'All games' }, ...games.map((g) => ({ value: g.slug, label: g.name }))], gameFilter, (v) => { gameFilter = v; notify(); }, 'sm'),
      selectEl([{ value: '', label: 'All agents' }, ...store.roles.map((r) => ({ value: r.id, label: r.label }))], roleFilter, (v) => { roleFilter = v; notify(); }, 'sm'),
      btn('New task', () => newTaskModal(), { kind: 'primary tk-new', icon: 'plus' }),
      token ? popMenu({ label: 'More task actions', items: [{ text: 'Clear finished work', icon: 'trash', run: clearFinished }] }) : null),
    groups.length || doneBox ? [groups, doneBox] : empty('No tasks yet. Ask the Lead, or press New task.'));
}

// ---- log formatting (stream-json lines) ----
function fmtLine(raw) {
  if (raw == null) return null;
  let o = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { return raw; } }
  if (!o || typeof o !== 'object') return String(o);
  if (o.type === 'assistant' && o.message?.content) {
    const out = [];
    for (const c of Array.isArray(o.message.content) ? o.message.content : []) {
      if (c.type === 'text' && c.text) out.push(c.text);
      else if (c.type === 'tool_use') out.push('> ' + c.name + ' ' + JSON.stringify(c.input || {}).slice(0, 140));
    }
    return out.join('\n') || null;
  }
  if (o.type === 'result') return 'Result: ' + (o.result || o.subtype || 'finished') + (o.total_cost_usd != null ? '  ($' + Number(o.total_cost_usd).toFixed(3) + ')' : '');
  if (o.type === 'user' || o.type === 'system') return null;
  if (typeof o.text === 'string') return o.text;
  return JSON.stringify(o).slice(0, 300);
}

export function openTaskDrawer(id) {
  const head = h('div');
  const reviewBox = h('div');
  const logBox = h('pre', { class: 'log', tabindex: '0', 'aria-label': 'Task log' }, 'Loading log');
  const find = () => store.tasks.find((t) => t.id === id);
  let sig = '';
  let reviewState = '';

  function paintHead() {
    const t = find();
    if (!t) { head.replaceChildren(empty('Task not found')); return; }
    const s = JSON.stringify([t.state, t.summary, t.error, t.costUsd, t.startedAt, t.endedAt, t.reworkCount, pendingGates(t)]);
    if (s === sig) return;
    sig = s;
    const meta = [
      ['Role', roleLabel(t.role)], ['Engine', engineLabel(t.engine) + (t.model ? ' / ' + t.model : '')],
      ['Created', fmtTime(t.createdAt) + ' by ' + t.createdBy], ['Started', fmtTime(t.startedAt) || 'not yet'],
      ['Ended', fmtTime(t.endedAt) || 'not yet'], ['Cost', t.costUsd != null ? '$' + Number(t.costUsd).toFixed(3) : 'unknown'],
      t.needsStudio ? ['Studio', 'needed'] : null, t.parentId ? ['Parent', t.parentId] : null, t.gateFor ? ['Checks', t.gateFor] : null, t.attempt > 1 ? ['Attempt', String(t.attempt)] : null, t.reworkCount > 0 ? ['Sent back', `${t.reworkCount} time${t.reworkCount === 1 ? '' : 's'} for rework`] : null,
    ].filter(Boolean);
    const actions = h('div', { class: 'row gap wrap' },
      ['queued', 'working'].includes(t.state) ? btn('Cancel', () => act(() => api('POST', `/api/tasks/${id}/cancel`), 'Canceled'), { kind: 'danger', icon: 'x' }) : null,
      ['failed', 'canceled', 'review', 'done'].includes(t.state) ? btn('Retry', () => act(() => api('POST', `/api/tasks/${id}/retry`), 'Back in the queue'), { icon: 'refresh' }) : null);
    const gameList = store.gameList.length ? store.gameList : store.games;
    const gamePick = h('label', { class: 'row gap game-pick' }, h('span', { class: 'muted' }, 'Game'),
      selectEl([{ value: '', label: 'No game' }, ...gameList.map((g) => ({ value: g.slug, label: g.name }))], t.game || '', (v) => act(() => api('POST', `/api/tasks/${id}/game`, { game: v || null }), 'Moved with its follow-up tasks'), 'sm'));
    head.replaceChildren(
      h('div', { class: 'row gap between' }, h('h3', { class: 'drawer-title' }, plain(t.title)), statePill(t.state)),
      h('dl', { class: 'meta' }, meta.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      gamePick,
      t.body ? h('div', { class: 'block' }, h('h4', {}, 'Brief'), h('p', { class: 'pre' }, t.body)) : null,
      Array.isArray(t.attachPaths) && t.attachPaths.length ? h('div', { class: 'block' }, h('h4', {}, 'Attached'), h('div', { class: 'attach-grid' }, t.attachPaths.map((p) => h('a', { href: mediaUrl(p), target: '_blank', rel: 'noopener' }, h('img', { class: 'md-img', src: mediaUrl(p), alt: 'Attached screenshot', loading: 'lazy' }))))) : null,
      t.summary ? h('div', { class: 'block' }, h('h4', {}, 'Summary'), h('p', { class: 'pre' }, t.summary)) : null,
      t.error ? h('div', { class: 'block err' }, h('h4', {}, 'Error'), h('p', { class: 'pre' }, t.error)) : null,
      actions);
    const rs = t.state + (isBackToYou(t) ? ':b' : pendingGates(t) ? ':g' : '');
    if (rs !== reviewState) {
      reviewState = rs;
      reviewBox.replaceChildren(isBackToYou(t) ? backToYou(t) : t.state === 'review' && pendingGates(t) ? h('p', { class: 'muted block' }, 'Waiting for the automatic checks to finish.') : '');
    }
  }

  // log
  const lines = [];
  let ready = false;
  const pending = [];
  function appendLine(raw) {
    const f = fmtLine(raw);
    if (f == null) return;
    const near = logBox.scrollHeight - logBox.scrollTop - logBox.clientHeight < 40;
    if (!lines.length) logBox.textContent = '';
    lines.push(f);
    if (lines.length > 500) { lines.shift(); logBox.firstChild?.remove(); }
    logBox.append(h('div', { class: 'log-line' }, f));
    if (near) logBox.scrollTop = logBox.scrollHeight;
  }
  const offLog = onLog(({ taskId, line }) => { if (taskId !== id) return; if (ready) appendLine(line); else pending.push(line); });
  api('GET', `/api/tasks/${id}/log`).then((r) => {
    logBox.textContent = '';
    const got = r.lines || [];
    got.forEach(appendLine);
    const tail = new Set(got.slice(-20).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));
    pending.forEach((p) => { if (!tail.has(typeof p === 'string' ? p : JSON.stringify(p))) appendLine(p); });
    ready = true;
    if (!lines.length) logBox.textContent = 'No output yet';
    logBox.scrollTop = logBox.scrollHeight;
  }).catch((e) => { ready = true; logBox.textContent = e.message; });

  paintHead();
  const unsub = subscribe(paintHead);
  openDrawer('Task', h('div', { class: 'stack' }, head, reviewBox, h('div', { class: 'block' }, h('h4', {}, 'Live log'), logBox)), () => { unsub(); offLog(); });
}
