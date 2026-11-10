// Notebook: short notes the owner and the agents leave for each other. Newest first, live on the `notebook` event.
import { markdown } from './library.js';
import { h, store, api, act, btn, ic, empty, pageHead, field, selectEl, notify, toast, token, avatar, roleLabel, gameName, ago, fmtTime, inScope } from './core.js';

let data = null; // { entries, doc }
let bible = null; // { syncedAt, source, sections: [{ id, title, words }] }
const open = new Map(); // section id -> text | null (loading)
let err = '';
let asked = false;
let es = null;
let timer = 0;
const draft = { text: '', game: '' };

async function load() {
  try { data = await api('GET', '/api/notebook?limit=200'); err = ''; } catch (e) { err = e.message; data ??= { entries: [], doc: null }; }
  try { bible = await api('GET', '/api/notebook/doc'); } catch { bible ??= { syncedAt: null, source: null, sections: [] }; }
  notify();
}
const soon = () => { clearTimeout(timer); timer = setTimeout(load, 200); };

// One extra event stream while this page is open (the shared one does not carry notebook events).
function listen() {
  if (es) return;
  es = new EventSource('/api/events?token=' + encodeURIComponent(token));
  es.addEventListener('notebook', soon);
  es.onopen = () => { if (asked) soon(); };
  const stop = () => { if (!location.hash.startsWith('#/notebook')) { es?.close(); es = null; window.removeEventListener('hashchange', stop); } };
  window.addEventListener('hashchange', stop);
}

const isOwner = (e) => e.who === 'owner' || e.who === 'you' || !e.role;
const when = (iso) => { const a = ago(iso); return a === 'just now' ? a : a + ' ago'; };

async function add() {
  const text = draft.text.trim();
  if (!text) { toast('Write a note first', 'error'); return; }
  if (await act(() => api('POST', '/api/notebook', { text, ...(draft.game ? { game: draft.game } : {}) }), 'Note added')) { draft.text = ''; await load(); }
}
async function remove(e) {
  if (await act(() => api('DELETE', '/api/notebook/' + encodeURIComponent(e.id)), 'Note deleted')) await load();
}

async function toggle(id) {
  if (open.has(id)) { open.delete(id); notify(); return; }
  open.set(id, null); notify();
  try { open.set(id, (await api('GET', '/api/notebook/doc/' + encodeURIComponent(id))).text || 'This section is empty.'); } catch (e) { open.set(id, 'Could not load: ' + e.message); }
  notify();
}

// Section index grouped by game: S is the studio, G1 (with its title) and so on.
function biblePanel() {
  const secs = bible?.sections || [];
  const src = typeof bible?.source === 'string' && bible.source.startsWith('https://docs.google.com/') ? bible.source : null;
  const head = h('div', { class: 'row gap wrap' }, h('h2', { class: 'section-title' }, 'Game bible'),
    h('span', { class: 'muted small push' }, bible?.syncedAt ? 'Synced ' + when(bible.syncedAt) : 'Never synced'),
    src ? h('a', { href: src, target: '_blank', rel: 'noopener noreferrer' }, 'Open doc') : null);
  if (!secs.length) return h('section', { class: 'card stack sm nb-bible', 'aria-label': 'Game bible' }, head,
    h('p', { class: 'muted' }, 'Nothing synced yet. The hourly worker fills this from your Google Doc, or run hqctl notebook-mirror <file>.'));
  const groups = new Map();
  for (const s of secs) { const g = s.id === 'top' ? 'top' : s.id[0] === 'S' ? 'S' : s.id.split('.')[0]; (groups.get(g) ?? groups.set(g, []).get(g)).push(s); }
  const label = (g, list) => (g === 'top' ? 'Intro' : g === 'S' ? 'Studio' : g + ' ' + (list.find((x) => x.id === g)?.title || ''));
  return h('section', { class: 'card stack sm nb-bible', 'aria-label': 'Game bible' }, head,
    [...groups].map(([g, list]) => h('div', { class: 'stack sm' }, h('h3', { class: 'nb-bible-h' }, label(g, list)),
      list.map((s) => h('div', { class: 'nb-sec' },
        h('button', { type: 'button', class: 'nb-sec-btn', 'aria-expanded': String(open.has(s.id)), onclick: () => toggle(s.id) },
          ic(open.has(s.id) ? 'chevronDown' : 'chevron', 14), h('strong', {}, s.id), h('span', { class: 'grow' }, s.title), h('span', { class: 'muted small' }, s.words + ' words')),
        open.has(s.id) ? h('div', { class: 'nb-sec-body' }, open.get(s.id) === null ? 'Loading' : markdown(open.get(s.id))) : null)))));
}

function entry(e) {
  const mine = isOwner(e);
  return h('li', { class: 'nb-entry card' },
    mine ? h('span', { class: 'nb-you', 'aria-hidden': 'true' }, ic('user', 16)) : avatar(e.role, 32),
    h('div', { class: 'grow nb-body' },
      h('div', { class: 'row gap wrap nb-meta' },
        h('strong', {}, mine ? (store.settings.ownerName || 'You') : roleLabel(e.role)),
        e.game ? h('span', { class: 'pg-chip' }, gameName(e.game)) : null,
        h('time', { class: 'muted small', datetime: e.at, title: fmtTime(e.at) }, when(e.at))),
      h('p', { class: 'nb-text' }, e.text)),
    mine ? h('button', { type: 'button', class: 'icon-btn nb-del', 'aria-label': 'Delete this note', title: 'Delete', onclick: () => remove(e) }, ic('trash', 16)) : null);
}

export function render() {
  listen();
  if (!asked) { asked = true; load(); }
  const doc = typeof data?.doc === 'string' && data.doc.startsWith('https://docs.google.com/') ? data.doc : null;
  const entries = (data?.entries || []).filter(inScope);
  const games = store.gameList.length ? store.gameList : store.games;
  const text = h('textarea', { class: 'textarea', rows: 3, maxlength: 2000, 'aria-label': 'New note', placeholder: 'A fact, a decision or a warning the team should know', oninput: (ev) => { draft.text = ev.target.value; } });
  text.value = draft.text;
  return h('div', { class: 'page' },
    pageHead('Notebook', 'Short notes you and the agents leave for each other. Agents read it at the start of a task.'),
    h('p', { class: 'hint nb-doc' }, ic('external', 13), doc
      ? h('a', { href: doc, target: '_blank', rel: 'noopener noreferrer' }, 'Open the Google Doc')
      : h('span', {}, 'Not linked to a Google Doc. ', h('a', { href: '#/settings' }, 'Add one in Settings.'))),
    h('section', { class: 'card stack sm nb-compose', 'aria-label': 'Add a note' },
      text,
      h('div', { class: 'row gap wrap' },
        games.length ? field('Game', selectEl([{ value: '', label: 'Any game' }, ...games.map((g) => ({ value: g.slug, label: g.name }))], draft.game, (v) => { draft.game = v; })) : null,
        h('span', { class: 'push' }, btn('Add note', add, { kind: 'primary', icon: 'plus' })))),
    biblePanel(),
    err ? h('p', { class: 'pg-warn', role: 'alert' }, 'Could not load the notebook: ' + err) : null,
    data === null ? empty('Loading') : entries.length ? h('ul', { class: 'nb-list', 'aria-label': 'Notes, newest first' }, entries.map(entry)) : empty('No notes yet. Add the first one above.'));
}
