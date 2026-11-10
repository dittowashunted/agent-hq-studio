// Ctrl K command palette: pages, roles, tasks, pitches, games, a few actions.
import { h, ic, store, api, act, roleLabel, avatar, plain, gameName, go, ago, scope, setScope } from './core.js';
import { openTaskDrawer, newTaskModal } from './tasks.js';

const PAGES = [['Home', 'home', 'home'], ['Lead', 'lead', 'lead'], ['Team', 'team', 'team'], ['Tasks', 'tasks', 'tasks'], ['Review', 'review', 'review'],
  ['Games', 'games', 'games'], ['Pitches', 'pitches', 'pitches'], ['Market', 'market', 'market'], ['Library', 'library', 'library'], ['Notebook', 'notebook', 'pencil'], ['Pro', 'pro', 'gem'], ['Settings', 'settings', 'settings'], ['Help', 'help', 'help']];

let openState = null;

function items() {
  const paused = !!store.settings.paused;
  const out = [];
  for (const [label, id, icon] of PAGES) out.push({ g: 'Pages', label, sub: 'Go to page', icon, run: () => go('#/' + id) });
  out.push({ g: 'Actions', label: 'New task', sub: 'Queue work for an agent', icon: 'plus', run: () => newTaskModal() });
  out.push({ g: 'Actions', label: paused ? 'Resume all' : 'Pause all', sub: paused ? 'Let queued tasks start again' : 'Stop new tasks from starting', icon: paused ? 'play' : 'pause',
    run: () => act(() => api('POST', paused ? '/api/resume' : '/api/pause')) });
  if (scope()) out.push({ g: 'Actions', label: 'Show all games', sub: 'Stop narrowing to ' + gameName(scope()), icon: 'grid', run: () => setScope(null) });
  for (const r of store.roles) out.push({ g: 'Agents', label: r.label, sub: r.job, role: r.id, run: () => go('#/team/' + r.id) });
  const games = store.gameList.length ? store.gameList : store.games;
  for (const g of games) out.push({ g: 'Games', label: g.name, sub: 'Open game', icon: 'games', run: () => go('#/games/' + g.slug) });
  for (const p of store.pitches) out.push({ g: 'Pitches', label: plain(p.title), sub: 'Pitch · ' + p.state, icon: 'pitches', run: () => go('#/pitches') });
  for (const t of [...store.tasks].sort((a, b) => ((b.createdAt || '') < (a.createdAt || '') ? -1 : 1)).slice(0, 80)) {
    out.push({ g: 'Tasks', label: plain(t.title), sub: `${roleLabel(t.role)} · ${t.state}${t.game ? ' · ' + gameName(t.game) : ''}`, icon: 'tasks', run: () => openTaskDrawer(t.id) });
  }
  return out;
}

function filter(all, q) {
  const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return all.filter((i) => ['Pages', 'Actions', 'Agents'].includes(i.g)).slice(0, 24);
  return all
    .map((i) => ({ i, hay: (i.g === 'Conversations' ? i.label : i.label + ' ' + i.sub).toLowerCase(), l: i.label.toLowerCase() }))
    .filter((x) => toks.every((t) => x.hay.includes(t)))
    .sort((a, b) => (b.l.startsWith(toks[0]) - a.l.startsWith(toks[0])))
    .map((x) => x.i).reduce((acc, i) => { if (i.g !== 'Conversations' || acc.conv < 8) acc.list.push(i); if (i.g === 'Conversations') acc.conv++; return acc; }, { list: [], conv: 0 }).list.slice(0, 30);
}

export function closePalette() { openState?.close(); }

export function openPalette() {
  if (openState) { openState.input.focus(); return; }
  const all = items();
  let hits = []; // conversation matches from the server, past chats included
  let timer = 0; let seq = 0;
  let shown = [];
  let sel = 0;
  const list = h('div', { class: 'pal-list', role: 'listbox', id: 'pal-list' });
  const input = h('input', { class: 'pal-input', type: 'text', placeholder: 'Search pages, agents, tasks, pitches, games, conversations…', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'pal-list', autocomplete: 'off', spellcheck: 'false' });
  const root = document.getElementById('overlay');

  function close() {
    document.removeEventListener('keydown', onKey, true);
    back.remove();
    openState = null;
  }
  function run(i) { close(); setTimeout(() => i.run(), 0); }
  function paint() {
    shown = [...filter(all, input.value), ...hits];
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    let last = '';
    list.replaceChildren(...(shown.length ? shown.flatMap((i, idx) => {
      const rows = [];
      if (i.g !== last) { last = i.g; rows.push(h('div', { class: 'pal-group' }, i.g)); }
      rows.push(h('div', { class: 'pal-item', role: 'option', 'aria-selected': String(idx === sel), onmousemove: () => { if (sel !== idx) { sel = idx; mark(); } }, onclick: () => run(i) },
        i.role ? avatar(i.role, 24) : h('span', { class: 'pal-ic' }, ic(i.icon || 'search', 16)),
        h('span', { class: 'grow clip' }, i.label), h('span', { class: 'muted small clip pal-sub' }, i.sub)));
      return rows;
    }) : [h('div', { class: 'empty' }, 'Nothing matches')]));
    mark();
  }
  function mark() {
    list.querySelectorAll('.pal-item').forEach((el, idx) => el.setAttribute('aria-selected', String(idx === sel)));
    list.querySelectorAll('.pal-item')[sel]?.scrollIntoView({ block: 'nearest' });
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[sel]) run(shown[sel]); }
  }
  function searchChats() {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { if (hits.length) { hits = []; paint(); } return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const r = await api('GET', '/api/messages/search?q=' + encodeURIComponent(q));
        if (mine !== seq || !openState) return;
        hits = (Array.isArray(r) ? r : r.results || []).slice(0, 8).map((m) => ({ g: 'Conversations', label: plain(m.snippet || m.text).slice(0, 100), sub: `${roleLabel(m.role)} · ${m.from === 'owner' ? 'you' : 'agent'}${m.archive ? ' · past chat' : ''} · ${ago(m.createdAt)}`, role: m.role, run: () => go(m.role === 'lead' ? '#/lead' : '#/team/' + m.role) }));
        paint();
      } catch { /* older server: no message search */ }
    }, 200);
  }
  input.addEventListener('input', () => { sel = 0; paint(); searchChats(); });
  const back = h('div', { class: 'backdrop top', onmousedown: (e) => { if (e.target === back) close(); } },
    h('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search or jump to' },
      h('div', { class: 'pal-head' }, ic('search', 16), input, h('kbd', {}, 'Esc')), list,
      h('div', { class: 'pal-foot muted small' }, 'Arrow keys to move · Enter to open')));
  root.append(back);
  document.addEventListener('keydown', onKey, true);
  openState = { close, input };
  paint();
  input.focus();
}
