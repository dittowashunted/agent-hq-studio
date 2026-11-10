import { h, store, api, act, btn, empty, pageHead, assetUrl, mediaUrl, notify, toast, openDrawer, roleLabel } from './core.js';
import { chip, segmented } from './charts.js';
import { openLightbox } from './lightbox.js';

let tab = 'assets';
let loadedVault = false;
let loadedLib = false;

// ---- minimal markdown: headings, bullets, numbered, tables, fences, bold, inline code ----
const SAFE_URL = /^(https?:\/\/|\/|#)/i;
function inline(text) {
  const out = [];
  const re = /(!\[[^\]]*\]\([^)\s]+\)|\[[^\]]+\]\([^)\s]+\)|\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const s = m[0];
    if (s.startsWith('![')) {
      const [, alt, src] = s.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      const url = /^https?:/i.test(src) ? '' : src.startsWith('/') ? src : mediaUrl(src);
      out.push(url ? h('img', { class: 'md-img', src: url, alt, loading: 'lazy' }) : alt);
    } else if (s.startsWith('[')) {
      const [, label, href] = s.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      out.push(SAFE_URL.test(href) ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label) : label);
    } else out.push(s.startsWith('**') ? h('strong', {}, s.slice(2, -2)) : h('code', {}, s.slice(1, -1)));
    last = m.index + s.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function markdown(src) {
  const root = h('div', { class: 'md' });
  const lines = String(src || '').split('\n');
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      root.append(h('pre', { class: 'code' }, buf.join('\n')));
    } else if (/^#{1,6}\s/.test(l)) {
      const n = Math.min(6, l.match(/^#+/)[0].length + 1);
      root.append(h('h' + n, {}, inline(l.replace(/^#+\s*/, ''))));
      i++;
    } else if (/^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const ul = h(ordered ? 'ol' : 'ul', {});
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
        ul.append(h('li', {}, inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))));
        i++;
      }
      root.append(ul);
    } else if (/^\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r) => !/^\|\s*:?-+/.test(r));
      const [hd, ...rest] = body;
      root.append(h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, cells(hd).map((c) => h('th', { scope: 'col' }, inline(c))))),
        h('tbody', {}, rest.map((r) => h('tr', {}, cells(r).map((c) => h('td', {}, inline(c)))))))));
    } else if (l.trim() === '') {
      i++;
    } else {
      const buf = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^(```|#{1,6}\s|\s*[-*]\s|\s*\d+\.\s|\|)/.test(lines[i])) buf.push(lines[i++]);
      root.append(h('p', {}, inline(buf.join(' '))));
    }
  }
  return root;
}

async function loadVault() {
  if (loadedVault) return;
  loadedVault = true;
  try { store.vault = await api('GET', '/api/vault'); } catch (e) { toast(e.message, 'error'); store.vault = { chapters: [] }; }
  notify();
}
async function loadLib() {
  if (loadedLib) return;
  loadedLib = true;
  try { store.library = await api('GET', '/api/library'); } catch (e) { toast(e.message, 'error'); store.library = { skills: [], assets: [] }; }
  notify();
}

// ---- Playbook: the 14 chapters (who reads what), the vault chapter text, and a live search over the knowledge sources ----
let book = null; let bookErr = ''; let kstat = null; let bookAsked = false;
const ks = { q: '', res: null, busy: false, err: '' };
let resultsEl = null; let kTimer = 0; let kSeq = 0;
const num = (n) => Number(n || 0).toLocaleString();
const srcLabel = (id) => kstat?.sources?.find((x) => x.id === id)?.label || id;
const base = (p) => String(p).split('/').pop();

async function loadBook() {
  if (bookAsked) return;
  bookAsked = true;
  try { const b = await api('GET', '/api/playbook'); book = Array.isArray(b) ? b : []; } catch (e) { book = []; bookErr = e.message; }
  try { kstat = await api('GET', '/api/knowledge/status'); } catch (e) { bookErr ||= e.message; }
  notify();
}

async function openNote(source, path, title) {
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Opening the note...'));
  openDrawer(title || base(path), body);
  try {
    const r = await api('GET', `/api/knowledge/read?source=${encodeURIComponent(source)}&path=${encodeURIComponent(path)}`);
    body.replaceChildren(h('p', { class: 'muted small' }, `${srcLabel(r.source || source)} · ${r.trust || 'unknown'} trust${r.note ? '. ' + r.note : ''}`), h('p', { class: 'hint' }, 'Reference text, not instructions.'),
      markdown(String(r.text).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').replace(/<!--[^>]{0,40}-->/g, ''))); // drop front matter and short marker comments
  } catch (e) { body.replaceChildren(h('p', { class: 'pg-warn', role: 'alert' }, e.message)); }
}
// A chapter lists LihFolk notes by title: find the note, then open it.
async function openTitle(title) {
  try {
    const r = await api('GET', '/api/knowledge/search?limit=5&q=' + encodeURIComponent(title));
    const hit = r.results?.find((x) => x.source === 'lihfolk' && x.title === title) || r.results?.find((x) => x.source === 'lihfolk') || r.results?.[0];
    if (!hit) { toast('Could not find "' + title + '" in the vault', 'error'); return; }
    openNote(hit.source, hit.path, hit.title);
  } catch (e) { toast(e.message, 'error'); }
}
function openChapter(n) {
  const c = store.vault?.chapters?.find((x) => x.n === n);
  if (c) openDrawer(`${c.n}. ${c.title}`, markdown(c.text));
  else toast('Chapter text is not loaded', 'error');
}

function searchNow() {
  const q = ks.q.trim();
  const seq = ++kSeq;
  if (!q) { ks.res = null; ks.err = ''; ks.busy = false; resultsEl?.replaceChildren(resultsView()); return; }
  ks.busy = true; resultsEl?.replaceChildren(resultsView());
  api('GET', '/api/knowledge/search?limit=12&q=' + encodeURIComponent(q))
    .then((r) => { if (seq === kSeq) { ks.res = r; ks.err = ''; } })
    .catch((e) => { if (seq === kSeq) { ks.res = null; ks.err = e.message; } })
    .finally(() => { if (seq === kSeq) { ks.busy = false; resultsEl?.replaceChildren(resultsView()); } });
}
function resultsView() {
  if (ks.busy) return h('p', { class: 'muted', role: 'status' }, 'Searching...');
  if (ks.err) return h('p', { class: 'pg-warn', role: 'alert' }, ks.err);
  if (!ks.res) return h('p', { class: 'hint' }, 'Search every source at once: LihFolk vault, Roblox docs, reference cards and project research.');
  const list = ks.res.results || [];
  if (!list.length) return h('p', { class: 'muted' }, 'No matches. Try other words.');
  return h('ul', { class: 'pb-results' }, list.map((r) => h('li', {}, h('button', { type: 'button', class: 'pb-hit', onclick: () => openNote(r.source, r.path, r.title) },
    h('strong', {}, r.title), h('span', { class: 'row gap wrap' }, chip(srcLabel(r.source)), chip(r.trust + ' trust', r.trust === 'low' ? 'warn' : undefined), h('code', { class: 'mono muted clip' }, r.path)),
    r.snippet ? h('span', { class: 'muted small' }, r.snippet) : null))));
}

function totals() {
  const t = kstat?.totals;
  return h('div', { class: 'pg-tiles' },
    h('div', { class: 'pg-tile' }, h('span', { class: 'k' }, 'Notes'), h('span', { class: 'v' }, t ? num(t.notes) : '...')),
    h('div', { class: 'pg-tile' }, h('span', { class: 'k' }, 'Words'), h('span', { class: 'v' }, t ? num(t.words) : '...')),
    h('div', { class: 'pg-tile' }, h('span', { class: 'k' }, 'Sources found'), h('span', { class: 'v' }, kstat ? `${kstat.sources.filter((x) => x.found).length} of ${kstat.sources.length}` : '...')),
    h('div', { class: 'pg-tile' }, h('span', { class: 'k' }, 'Chapters'), h('span', { class: 'v' }, book ? book.length : '...')));
}

function chapterCard(c) {
  const list = (items, label, open) => (items?.length ? h('details', { class: 'pb-more' }, h('summary', {}, `${label} (${items.length})`),
    h('ul', { class: 'pb-notes' }, items.map((x) => h('li', {}, h('button', { type: 'button', class: 'pb-note', onclick: () => open(x) }, base(x)))))) : null);
  return h('article', { class: 'card pb-ch' },
    h('div', { class: 'row gap' }, h('span', { class: 'pb-n' }, c.n), h('h3', { class: 'grow' }, c.title)),
    c.for?.length ? h('p', { class: 'small' }, h('span', { class: 'muted' }, 'Read by '), c.for.map(roleLabel).join(', ')) : null,
    c.skills?.length ? h('div', { class: 'row gap wrap' }, c.skills.map((x) => chip(x))) : null,
    list(c.lihfolk, 'LihFolk notes', openTitle),
    list(c.docs, 'Roblox docs', (p) => openNote('docs', p, base(p))),
    btn('Read the chapter', () => openChapter(c.n), { kind: 'sm', icon: 'library' }));
}

function playbookTab() {
  loadBook();
  if (!store.vault) loadVault();
  const input = h('input', { class: 'pg-input pb-q', type: 'search', placeholder: 'Search the playbook, for example first session retention', value: ks.q, maxlength: 120, 'aria-label': 'Search the knowledge sources',
    oninput: (e) => { ks.q = e.target.value; clearTimeout(kTimer); kTimer = setTimeout(searchNow, 350); },
    onkeydown: (e) => { if (e.key === 'Enter') { clearTimeout(kTimer); searchNow(); } } });
  resultsEl = h('div', { class: 'pb-res' }, resultsView());
  return h('div', { class: 'stack' },
    totals(),
    bookErr ? h('p', { class: 'pg-warn', role: 'alert' }, 'Part of the playbook could not load: ' + bookErr) : null,
    h('section', { class: 'card stack sm' }, h('h2', { class: 'section-title' }, 'Search'), input, resultsEl),
    h('section', { class: 'stack sm' }, h('h2', { class: 'section-title' }, 'Chapters'),
      book === null ? empty('Loading') : !book.length ? empty('No playbook chapters found.') : h('div', { class: 'pb-grid' }, book.map(chapterCard))),
    kstat ? h('details', { class: 'card pb-credit' }, h('summary', {}, 'Sources and credits'),
      h('ul', { class: 'pb-notes' }, kstat.sources.map((x) => h('li', { class: 'small' }, h('strong', {}, x.label), ` · ${x.found ? num(x.notes) + ' notes' : 'not found'} · ${x.licence}. `, h('span', { class: 'muted' }, x.credit))))) : null);
}

function skillsTab() {
  if (!store.library) { loadLib(); return empty('Loading'); }
  const s = store.library.skills || [];
  return s.length ? h('div', { class: 'stack' }, s.map((k) => h('div', { class: 'card' },
    h('h3', {}, k.name), h('p', { class: 'muted' }, k.description), h('code', { class: 'mono muted' }, k.path)))) : empty('No skills found');
}

const KINDS = [['all', 'All'], ['model', 'Models'], ['icon', 'Icons'], ['sound', 'Sounds'], ['image', 'Images'], ['thumbnail', 'Thumbnails']];
const q = { search: '', kind: 'all', scope: 'all' };
let assetData = null; // {assets, counts, onRoblox}
let assetErr = '';
let systemsMd = null;
let searchTimer = 0;
let assetSeq = 0;

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied ' + text); return; } catch { /* fall through */ }
  const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text);
  document.body.append(ta); ta.select();
  try { document.execCommand('copy'); toast('Copied ' + text); } catch { toast('Could not copy. The id is ' + text, 'error'); }
  ta.remove();
}

async function loadAssets(into) {
  const seq = ++assetSeq;
  const qs = new URLSearchParams();
  if (q.search) qs.set('search', q.search);
  if (q.kind !== 'all') qs.set('kind', q.kind);
  if (q.scope !== 'all') qs.set('scope', q.scope);
  try { assetData = await api('GET', '/api/assets?' + qs); assetErr = ''; } catch (e) { assetErr = e.message; assetData = assetData || { assets: [], counts: {}, onRoblox: 0 }; }
  if (seq !== assetSeq) return;
  if (into && into.isConnected) into.replaceChildren(assetGrid()); else notify();
}

function assetGrid() {
  const a = assetData?.assets || [];
  if (assetErr) return empty(assetErr);
  if (!a.length) return empty(q.search || q.kind !== 'all' || q.scope !== 'all' ? 'No assets match those filters.' : 'No assets yet. The Librarian adds them.');
  return h('div', { class: 'pg-assets' }, a.map((x) => {
    const file = x.file || '';
    const img = /\.(png|jpe?g|gif|webp|svg)$/i.test(file);
    return h('article', { class: 'pg-asset' },
      h('div', { class: 'pv' }, img ? h('img', { src: assetUrl(file), alt: x.name, loading: 'lazy', style: 'cursor:zoom-in', title: 'Click to enlarge',
        onclick: () => { const imgs = a.filter((y) => /\.(png|jpe?g|gif|webp|svg)$/i.test(y.file || '')); openLightbox(imgs.map((y) => ({ src: assetUrl(y.file), title: y.name })), Math.max(0, imgs.indexOf(x))); } }) : (x.kind || file.split('.').pop() || 'file')),
      h('div', { class: 'info' },
        h('span', { class: 'nm', title: x.name }, x.name),
        h('div', { class: 'row gap wrap' }, chip(x.kind || 'file'), chip(String(x.scope || 'studio').replace('game:', 'game: ')), x.robloxId ? chip('On Roblox', 'ok') : chip('Not on Roblox')),
        x.robloxId ? h('div', { class: 'row gap' }, h('span', { class: 'muted mono' }, 'id ' + x.robloxId), btn('Copy the Roblox asset id', () => copyText(String(x.robloxId)), { kind: 'sm' })) : null,
        (x.tags || []).length ? h('div', { class: 'pg-tags' }, x.tags.map((t) => h('span', { class: 'pg-chip' }, t))) : null,
        file ? h('span', { class: 'muted mono clip', title: file }, file) : null));
  }));
}

function assetsTab() {
  if (!assetData) { loadAssets(); return empty('Loading'); }
  const counts = assetData.counts || {};
  const scopes = ['all', 'studio', ...(store.games || []).map((g) => 'game:' + g.slug)];
  const results = h('div', {});
  results.append(assetGrid());
  const search = h('input', { class: 'pg-input', type: 'search', placeholder: 'Search by name or tag', value: q.search, 'aria-label': 'Search assets', maxlength: 80,
    oninput: (e) => { q.search = e.target.value.trim(); clearTimeout(searchTimer); searchTimer = setTimeout(() => loadAssets(results), 200); } });
  const scope = h('select', { class: 'select', 'aria-label': 'Scope', onchange: (e) => { q.scope = e.target.value; loadAssets(results); } },
    scopes.map((s) => h('option', { value: s }, s === 'all' ? 'All scopes' : s === 'studio' ? 'Whole studio' : 'Game: ' + s.slice(5))));
  scope.value = q.scope;
  return h('div', { class: 'stack' },
    h('div', { class: 'pg-filters' }, search,
      segmented(KINDS, q.kind, (id) => { q.kind = id; loadAssets(); }, Object.fromEntries(KINDS.map(([id]) => [id, counts[id]]))), scope),
    results);
}

// ---- catalog: free art from Poly Haven, the LihFolk pack and downloaded packs ----
const cat = { q: '', type: '', data: null, err: '', seq: 0, busy: '' };
let catTimer = null;

async function loadCatalog(into) {
  const seq = ++cat.seq;
  const qs = new URLSearchParams();
  if (cat.q) qs.set('q', cat.q);
  if (cat.type) qs.set('type', cat.type);
  try { cat.data = await api('GET', '/api/catalog?' + qs); cat.err = ''; } catch (e) { cat.err = e.message; }
  if (seq !== cat.seq) return;
  if (into && into.isConnected) into.replaceChildren(catalogGrid()); else notify();
}

async function fetchItem(x) {
  cat.busy = x.id; notify();
  const r = await act(() => api('POST', '/api/catalog/fetch', { id: x.id, res: '1k' }), `${x.name} is in your Assets`);
  cat.busy = '';
  if (r) assetData = null;
  notify();
}

function catalogCard(x) {
  const facts = [x.triangles ? `${Number(x.triangles).toLocaleString()} triangles` : '', x.licence].filter(Boolean).join(' | ');
  return h('article', { class: 'pg-asset' },
    h('div', { class: 'pv' }, x.preview ? h('img', { src: x.preview, alt: x.name, loading: 'lazy' }) : h('span', { class: 'muted' }, x.type)),
    h('div', { class: 'info' },
      h('span', { class: 'nm', title: x.name }, x.name),
      h('div', { class: 'row gap wrap' }, chip(x.type), chip(x.source)),
      h('span', { class: 'muted' }, x.description),
      h('span', { class: 'muted' }, facts),
      x.source === 'polyhaven' ? btn(cat.busy === x.id ? 'Getting it' : 'Get 1K', () => fetchItem(x), { disabled: !!cat.busy }) : null,
      x.file ? h('span', { class: 'muted mono clip', title: x.file }, x.file) : null));
}

function catalogGrid() {
  if (cat.err) return empty(cat.err);
  const a = cat.data?.results || [];
  if (!a.length) return empty(cat.data?.total ? 'Nothing matches that search.' : 'The catalog is empty. Press Refresh to load Poly Haven.');
  return h('div', { class: 'stack' }, h('p', { class: 'muted' }, `${cat.data.found.toLocaleString()} found, showing ${a.length}`), h('div', { class: 'pg-assets' }, a.map(catalogCard)));
}

function catalogTab() {
  if (!cat.data && !cat.err) { loadCatalog(); return empty('Loading'); }
  const results = h('div', {});
  results.append(catalogGrid());
  const search = h('input', { class: 'pg-input', type: 'search', placeholder: 'Search free models, textures, skies and packs', value: cat.q, 'aria-label': 'Search the catalog', style: 'flex:1 1 260px;min-width:0',
    oninput: (e) => { cat.q = e.target.value.trim(); clearTimeout(catTimer); catTimer = setTimeout(() => loadCatalog(results), 200); } });
  const types = ['', 'model', 'texture', 'hdri', 'material', 'sky', 'animation', 'vfx', 'pack'];
  const type = h('select', { class: 'select', 'aria-label': 'Type', onchange: (e) => { cat.type = e.target.value; loadCatalog(results); } },
    types.map((t) => h('option', { value: t }, t || 'All types')));
  type.value = cat.type;
  return h('div', { class: 'stack' },
    h('div', { class: 'pg-filters' }, search, type, btn('Refresh', async () => { if (await act(() => api('POST', '/api/catalog/refresh'), 'Catalog refreshed')) loadCatalog(); })),
    results,
    h('p', { class: 'muted' }, 'Powered by ', h('a', { href: 'https://polyhaven.com', target: '_blank', rel: 'noopener' }, 'Poly Haven'),
      '. Add Kenney packs by unzipping them into assets/packs.'));
}

async function loadSystems() {
  if (systemsMd !== null) return;
  systemsMd = '';
  try { systemsMd = (await api('GET', '/api/systems')).markdown || ''; } catch (e) { toast(e.message, 'error'); systemsMd = ''; }
  notify();
}
let sysQuery = '';
function systemsView() {
  const q = sysQuery.trim().toLowerCase();
  const parts = systemsMd.split(/^(?=## )/m);
  const intro = parts[0].startsWith('## ') ? '' : parts.shift();
  const hit = parts.filter((p) => !q || p.toLowerCase().includes(q));
  if (!hit.length) return empty('No system matches "' + sysQuery.trim() + '".');
  return h('article', { class: 'card reader' }, markdown((q ? '' : intro) + hit.join('')));
}
function systemsTab() {
  if (systemsMd === null) { loadSystems(); return empty('Loading'); }
  if (!systemsMd) return empty('No systems catalogue found.');
  const results = h('div', {}, systemsView());
  const input = h('input', { class: 'pg-input', type: 'search', placeholder: 'Search systems', value: sysQuery, 'aria-label': 'Search systems', maxlength: 80,
    oninput: (e) => { sysQuery = e.target.value; results.replaceChildren(systemsView()); } });
  return h('div', { class: 'stack' }, h('div', { class: 'pg-filters' }, input), results);
}

let lastParam = null;
export function render(param) {
  const tabs = [['assets', 'Assets'], ['catalog', 'Catalog'], ['systems', 'Systems'], ['playbook', 'Playbook'], ['skills', 'Skills']];
  // a deep link such as #/library/catalog picks the tab once; clicking another tab afterwards sticks
  if (param !== lastParam) { lastParam = param; if (param === 'vault') tab = 'playbook'; else if (tabs.some(([id]) => id === param)) tab = param; }
  const total = assetData?.counts?.all;
  const sub = total != null ? `${total} assets · ${assetData.onRoblox ?? 0} on Roblox. Plus the knowledge the agents read, the skills they use, and reusable game systems.` : 'Assets, reusable game systems, the knowledge the agents read, and the skills they use.';
  return h('div', { class: 'page' },
    pageHead('Library', sub),
    h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([id, l]) => h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(id === tab),
      onclick: () => { tab = id; notify(); } }, l))),
    tab === 'assets' ? assetsTab() : tab === 'catalog' ? catalogTab() : tab === 'systems' ? systemsTab() : tab === 'playbook' ? playbookTab() : skillsTab());
}
