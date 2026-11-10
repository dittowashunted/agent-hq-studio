// Review screen (images, visual bar, stages) and the shared ask card used by Home and the chats.
import { h, ic, store, api, act, btn, empty, roleLabel, ago, mediaUrl, plain, gameName, statePill, upsert, notify, loadState, toast, openModal, inScope, multiGame, byGame, gameHead } from './core.js';
import { openViewer, isVideo, VERDICT } from './viewer.js';
import { popMenu } from './menu.js';

export const askUi = { v: 0 }; // bumped when card UI state changes, so the chat repaints
const modeOf = new Map(); // ask id -> open inline note mode
const drafts = {};
let tab = 'images'; let filter = 'open'; let agent = ''; let older = false;
let stageAt = 0; let refsAt = 0; let refs = [];
let stages = { open: [], held: [], rejected: [] };
let shownMedia = []; let viewerFor = ''; // Images tab order (the viewer pages through it); the #/review/<id> ask already opened this visit
const agoTxt = (iso) => { const a = ago(iso); return a === 'just now' ? a : a + ' ago'; };

const KIND_LABEL = { decision: 'Decision', try: 'Try it', approve: 'Approve', review: 'Review', reference: 'Reference' };
const STAGE_NAME = { pitched: 'Pitched', designed: 'Designed', assets: 'Assets ready', built: 'Built', balanced: 'Balanced', art: 'Art done', ready: 'Ready to publish', live: 'Live', graded: 'Graded' };
const FILTERS = [['open', 'To review'], ['changes', 'Changes asked'], ['held', 'On hold'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'Everything']];
const CATEGORIES = [['packaging', 'Packaging'], ['ui-icons', 'UI icons'], ['3d-models', '3D models'], ['screens', 'Screens']];
const MODES = {
  note: { label: 'Looks good, with this note', ph: 'Optional note for the agent', submit: 'Approve with note', prefix: 'approve:', required: false },
  changes: { label: 'Not right: say what', ph: 'What should change?', submit: 'Send changes', prefix: 'changes:', required: true },
  hold: { label: 'Hold: why is it parked?', ph: 'Reason. It is parked, not rejected.', submit: 'Hold it', prefix: 'hold:', required: true },
  reject: { label: 'Reject: why?', ph: 'Why is it rejected?', submit: 'Reject', prefix: 'reject:', required: true },
};

// Images are grouped by what they are for, in this order. The first four match the Visual bar categories.
const PURPOSES = [['packaging', 'Packaging', 'image'], ['ui', 'UI', 'layout'], ['3d-models', '3D models', 'box'], ['screens', 'Screens', 'games'], ['other', 'Other', 'flag']];
// Packaging is what sells the game (thumbnails, icons, trailers). Who made it decides first; the words in the title and file name decide the rest.
const isSheet = (a) => /reference sheet/i.test(a.title || '');
export function purposeOf(a) {
  const t = `${a.title} ${a.mediaPath}`.toLowerCase();
  if (isSheet(a)) return '3d-models';
  if (a.role === 'thumbnails') return 'packaging';
  if (a.role === 'designer' && /thumbnail|icon|trailer|logo|banner|key ?art|promo|cover/.test(t)) return 'packaging'; // designer art that names itself packaging
  if (a.role === 'ui' || a.role === 'designer') return 'ui';
  if (a.role === 'librarian') return '3d-models';
  if (/thumbnail|icon|trailer|logo|banner|key ?art|promo|cover/.test(t)) return 'packaging';
  if (/\b(ui|hud|menu|button|panel|layout|concept)\b/.test(t)) return 'ui';
  if (/model|mesh|asset|contact|sheet|\b3d\b/.test(t)) return '3d-models';
  if (['world', 'builder', 'playtester', 'kid-tester'].includes(a.role) || /screenshot|screen|build|playtest/.test(t)) return 'screens';
  return 'other';
}

export const isMediaAsk = (a) => !!a.mediaPath; export const isReference = (a) => a.kind === 'reference';
// Something the owner must decide (reference-only items need no decision).
export const needsDecision = (a) => a.state === 'open' && !a.superseded && !isReference(a);

export function verdictOf(a) {
  if (a.state === 'open') return 'open';
  if (a.state === 'dismissed') return 'dismissed';
  const v = a.verdict === 'hold' ? 'held' : a.verdict;
  if (v) return v;
  const x = String(a.answer || '');
  if (x === 'approve' || x.startsWith('approve:')) return 'approved';
  if (x.startsWith('changes:')) return 'changes';
  if (x === 'reject' || x.startsWith('reject:')) return 'rejected';
  if (x.startsWith('hold:')) return 'held';
  return 'answered';
}
export const noteOf = (a) => a.verdictNote || String(a.answer || '').replace(/^(approve|changes|reject|hold):?/, '');

export async function answer(ask, value, msg = 'Sent') {
  const r = await act(() => api('POST', `/api/asks/${ask.id}/answer`, { answer: value }), msg);
  if (r && r !== true) upsert(store.asks, r);
  else if (r) { ask.state = 'answered'; ask.answer = value; }
  modeOf.delete(ask.id); delete drafts[ask.id]; askUi.v++;
  loadState().catch(() => {});
  notify(); return r;
}

export function mediaEl(path, alt) {
  const url = mediaUrl(path);
  if (isVideo(path)) return h('video', { class: 'ask-media', src: url, controls: true, preload: 'metadata' });
  return h('a', { href: url, target: '_blank', rel: 'noopener', title: 'Click to enlarge' }, h('img', { class: 'ask-media', src: url, alt, loading: 'lazy' }));
}

function setMode(ask, m) { if (modeOf.get(ask.id) === m) modeOf.delete(ask.id); else modeOf.set(ask.id, m); askUi.v++; notify(); }

function modeBox(ask) {
  const m = modeOf.get(ask.id);
  if (!m) return null;
  const c = MODES[m];
  const ta = h('textarea', { class: 'textarea', rows: 3, placeholder: c.ph, 'aria-label': c.label, oninput: (e) => { drafts[ask.id] = e.target.value; } });
  ta.value = drafts[ask.id] || '';
  return h('div', { class: 'stack sm modebox' }, h('div', { class: 'field-label' }, c.label), ta,
    h('div', { class: 'row gap' }, btn(c.submit, () => {
      const t = ta.value.trim();
      if (c.required && !t) { ta.focus(); toast('Please say why', 'error'); return; }
      answer(ask, c.prefix + t);
    }, { kind: m === 'reject' ? 'danger' : 'primary' }), btn('Cancel', () => setMode(ask, m), { kind: 'ghost' })));
}

// Free text for a decision card: "Or say it in your own words".
function ownWords(ask) {
  const key = 'w' + ask.id;
  const go = () => { const t = input.value.trim(); if (!t) return; delete drafts[key]; answer(ask, t, 'Answer sent'); };
  const input = h('input', { class: 'input', type: 'text', maxlength: 2000, placeholder: 'Or say it in your own words…', 'aria-label': 'Answer in your own words',
    oninput: (e) => { drafts[key] = e.target.value; },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } } });
  input.value = drafts[key] || '';
  return h('div', { class: 'row gap' }, input, btn('Send', go, { icon: 'send' }));
}

// Buttons (plus the inline note box) for one open ask.
// Options with a description or preview image: a grid of cards the owner clicks to pick (buttons, so keyboard and touch work).
function optionGrid(ask) {
  return h('div', { class: 'opt-grid' }, ask.options.map((o) => h('button', { type: 'button', class: 'opt' + (o.recommended ? ' rec' : ''), onclick: () => answer(ask, o.id) },
    o.mediaPath ? h('img', { src: mediaUrl(o.mediaPath), alt: o.label, loading: 'lazy' }) : null,
    h('b', {}, o.label, o.recommended ? ' (Recommended)' : ''), o.description ? h('span', { class: 'muted small' }, o.description) : null)));
}

function actions(ask) {
  const row = h('div', { class: 'row gap wrap' });
  const extra = [];
  if (isReference(ask)) {
    row.append(h('span', { class: 'muted small grow' }, 'Reference only: nothing to decide here.'),
      btn('Pin to Visual bar', () => pinModal(ask.mediaPath, ask.title), { icon: 'image' }),
      btn('Got it', async () => { if (await act(() => api('POST', `/api/asks/${ask.id}/dismiss`))) { loadState().catch(() => {}); notify(); } }, { kind: 'primary', icon: 'check' }));
  } else if (ask.kind === 'review') {
    row.append(btn('Approve', () => answer(ask, 'approve'), { kind: 'good', icon: 'check' }),
      btn('Looks good, with a note', () => setMode(ask, 'note')),
      btn('Not right: say what', () => setMode(ask, 'changes'), { icon: 'pencil' }),
      btn('Hold', () => setMode(ask, 'hold')),
      btn('Reject', () => setMode(ask, 'reject'), { kind: 'rv-reject' }));
    extra.push(modeBox(ask));
  } else if (ask.options?.length) {
    if (ask.options.some((o) => o.description || o.mediaPath)) extra.push(optionGrid(ask));
    else ask.options.forEach((o) => row.append(btn(o.label, () => answer(ask, o.id), { kind: o.recommended ? 'primary' : '' })));
    if (ask.kind === 'decision') extra.push(ownWords(ask));
  } else if (ask.kind === 'try') {
    row.append(btn('Done', () => answer(ask, 'done'), { kind: 'primary', icon: 'check' }));
  } else {
    row.append(btn('Approve', () => answer(ask, 'approve'), { kind: 'primary', icon: 'check' }), btn('Decline', () => answer(ask, 'decline')));
    if (ask.kind === 'decision') extra.push(ownWords(ask));
  }
  return [row, ...extra];
}

// Compact card: Home "Needs you" and the inline cards in a chat.
export function askCard(ask) {
  const parts = ask.state === 'open' ? actions(ask) : [];
  const ans = ask.state !== 'open' && ask.answer ? ask.options?.find((o) => o.id === ask.answer)?.label || ask.answer : null;
  return h('article', { class: 'card ask', 'data-kind': ask.kind },
    h('div', { class: 'row gap' }, h('span', { class: 'chip static' }, roleLabel(ask.role)), h('span', { class: 'chip static' }, KIND_LABEL[ask.kind] || ask.kind), h('span', { class: 'muted grow end-text' }, ago(ask.createdAt))),
    h('h3', {}, plain(ask.title)),
    ask.why ? h('p', { class: 'muted pre' }, ask.why) : null,
    ask.mediaPath ? mediaEl(ask.mediaPath, ask.title) : null,
    parts,
    ans ? h('p', { class: 'muted' }, 'Answered: ', ans) : null);
}

// ---- Visual bar ----
async function loadRefs() {
  refsAt = Date.now();
  try { const r = await api('GET', '/api/references'); refs = Array.isArray(r) ? r : r.references || []; } catch { refs = []; }
  notify();
}

export function pinModal(mediaPath, title) {
  const note = h('input', { class: 'input', type: 'text', maxlength: 300, placeholder: 'Why is this the bar? (optional)' });
  const sel = h('select', { class: 'select', 'aria-label': 'Category' }, CATEGORIES.map(([v, l]) => h('option', { value: v }, l)));
  sel.value = 'screens';
  const close = openModal('Pin to the Visual bar', h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'Every designer, thumbnails and UI brief lists the pinned images as the house reference.'),
    mediaEl(mediaPath, title),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Category'), sel),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Note'), note),
    h('div', { class: 'row end' }, btn('Pin it', async () => {
      if (await act(() => api('POST', '/api/references', { mediaPath, category: sel.value, note: note.value.trim() || undefined }), 'Pinned to the Visual bar')) { close(); loadRefs(); }
    }, { kind: 'primary', icon: 'image' }))));
}

function barTab() {
  if (Date.now() - refsAt > 8000) loadRefs();
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'Approved images you pin here become the house reference. Every designer, thumbnails and UI brief lists them.'),
    CATEGORIES.map(([id, label]) => {
      const list = refs.filter((r) => r.category === id);
      return h('section', { class: 'rgroup' },
        h('div', { class: 'rgroup-head' }, h('h2', {}, label), h('span', { class: 'rv-n' }, list.length)),
        list.length ? h('div', { class: 'rgrid small-grid' }, list.map((r) => h('article', { class: 'card ritem' },
          mediaEl(r.mediaPath, r.note || label),
          r.note ? h('p', { class: 'muted small' }, r.note) : null,
          h('div', { class: 'row between' }, h('span', { class: 'muted small' }, agoTxt(r.createdAt)),
            btn('Remove', async () => { if (await act(() => api('DELETE', `/api/references/${r.id}`), 'Removed')) loadRefs(); }, { kind: 'ghost sm' })))))
          : h('p', { class: 'muted small' }, 'Nothing pinned yet. Approve a packaging image in Images & video, then press Add to Visual bar on its card.'));
    }));
}

// ---- Images tab ----
function reviewItem(ask, open) {
  const task = store.tasks.find((t) => t.id === ask.taskId);
  const video = isVideo(ask.mediaPath);
  const kind = /contact|sheet/i.test(ask.title + ' ' + ask.mediaPath) ? 'Contact sheet' : video ? 'Video' : 'Screenshot';
  const v = verdictOf(ask);
  const [vLabel, vTone] = VERDICT[v] || [];
  const url = mediaUrl(ask.mediaPath);
  // The whole card opens the viewer, where the decision lives. Questions and references keep their buttons here.
  const go = (e) => { if (!e.target.closest('.ritem-acts, a, input, textarea, select')) open(); };
  return h('article', { class: 'card ritem' + (ask.mediaPath ? ' clickable' : ''), 'data-verdict': v, onclick: ask.mediaPath ? go : null },
    ask.mediaPath ? h('button', { type: 'button', class: 'rv-thumb', 'aria-label': `Open ${plain(ask.title)} in the viewer` },
      video ? [h('video', { class: 'rv-media', src: url + '#t=0.1', preload: 'metadata' }), h('span', { class: 'rv-play', 'aria-hidden': 'true' }, ic('play', 22))] : h('img', { class: 'rv-media', src: url, alt: '', loading: 'lazy' }),
      vLabel ? h('span', { class: 'spill rv-verdict', 'data-tone': vTone }, vLabel) : null) : null,
    h('div', { class: 'ritem-body' },
      h('h3', { title: plain(ask.title) }, plain(ask.title)),
      h('div', { class: 'rv-meta' }, ic(video ? 'play' : 'image', 13), h('span', { class: 'rv-line' }, [kind, task?.game ? gameName(task.game) : null, agoTxt(ask.createdAt), ask.superseded ? 'older version' : null].filter(Boolean).join(' · ')))),
    v === 'open' && isSheet(ask) && (store.settings.modelRefApproval || 'ask') === 'ask' ? h('p', { class: 'muted small' }, 'Approve to start the build') : null,
    v === 'open' && (ask.kind !== 'review' || !ask.mediaPath) ? h('div', { class: 'ritem-acts' }, ask.why ? h('p', { class: 'muted pre rv-why' }, ask.why) : null, actions(ask))
      : v === 'approved' && ask.mediaPath && purposeOf(ask) === 'packaging' ? h('div', { class: 'ritem-acts' }, btn('Add to Visual bar', () => pinModal(ask.mediaPath, ask.title), { kind: 'sm', icon: 'image' })) : null);
}

function rejectAllModal(ids) {
  const ta = h('textarea', { class: 'textarea', rows: 3, placeholder: 'Why are these rejected?', 'aria-label': 'Reason' });
  const close = openModal(`Reject ${ids.length} image${ids.length === 1 ? '' : 's'}`, h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'Every waiting image gets the same reason and goes back to its agent.'), ta,
    h('div', { class: 'row end' }, btn('Reject all', async () => {
      const reason = ta.value.trim();
      if (!reason) { ta.focus(); toast('Please say why', 'error'); return; }
      if (await act(() => api('POST', '/api/asks/reject-all', { ids, reason }), 'Rejected')) { close(); loadState().catch(() => {}); }
    }, { kind: 'danger' }))));
}

// Tile, purpose, "media", count; Approve all and Reject all cover only that group's waiting items.
async function bulkDo(path, ids, msg, ok) {
  if (!confirm(msg)) return;
  if (await act(() => api('POST', path, { ids }), ok)) loadState().catch(() => {});
}

function groupHead(g) {
  const ids = g.items.filter((a) => needsDecision(a) && a.kind === 'review').map((a) => a.id);
  return h('div', { class: 'rgroup-head' }, h('span', { class: 'rtile', 'data-p': g.id, 'aria-hidden': 'true' }, ic(g.icon, 16)), h('h2', {}, g.label), h('span', { class: 'muted' }, 'media'), h('span', { class: 'rv-n' }, g.items.length), h('span', { class: 'grow' }),
    ids.length ? [btn(`Approve all ${ids.length}`, () => bulkDo('/api/asks/approve-all', ids, `Approve all ${ids.length} waiting in ${g.label}?`, 'Approved'), { kind: 'good sm', icon: 'check' }),
      btn('Reject all', () => rejectAllModal(ids), { kind: 'ghost sm' })] : null);
}

function imagesTab() {
  const media = (a) => (isMediaAsk(a) || a.kind === 'review' || isReference(a)) && inScope(a);
  const base = store.asks.filter((a) => media(a) && (!agent || a.role === agent) && (older || !a.superseded));
  const counts = { open: 0, changes: 0, held: 0, approved: 0, rejected: 0, all: base.length };
  for (const a of base) { const v = verdictOf(a); if (counts[v] != null && !(v === 'open' && isReference(a))) counts[v]++; }
  const shown = base.filter((a) => filter === 'all' || verdictOf(a) === filter);
  const roleIds = [...new Set(store.asks.filter(media).map((a) => a.role))];
  // Under All games with several games: one block per game, then the purposes inside it.
  const purposes = (list) => PURPOSES.map(([id, label, icon]) => ({ id, label, icon, items: list.filter((a) => purposeOf(a) === id) })).filter((g) => g.items.length);
  const parts = (multiGame() ? byGame(shown) : [['', shown]]).map(([game, list]) => ({ game, groups: purposes(list) })).filter((p) => p.groups.length);
  const sortedGroups = parts.flatMap((p) => p.groups);
  shownMedia = sortedGroups.flatMap((g) => g.items).filter((a) => a.mediaPath);
  const waitingIds = base.filter((a) => a.state === 'open' && !isReference(a)).map((a) => a.id);
  const otherOpen = filter === 'open' && !agent ? store.asks.filter((a) => a.state === 'open' && !a.superseded && !isMediaAsk(a) && a.kind !== 'review' && !isReference(a) && inScope(a)) : [];
  // The queue-wide actions sit behind a "..." at the end of the filter row, so the first group starts right under the filters.
  const bulk = filter === 'open' && waitingIds.length ? popMenu({ label: 'Queue actions', items: [
    { text: `Clear the queue: approve all ${waitingIds.length}`, icon: 'check', run: () => bulkDo('/api/asks/approve-all', waitingIds, `Approve all ${waitingIds.length} waiting images?`, 'Queue cleared') },
    { text: `Reject all ${waitingIds.length}…`, icon: 'x', kind: 'danger', run: () => rejectAllModal(waitingIds) },
    { text: 'Empty the queue without approving', icon: 'trash', run: () => bulkDo('/api/asks/empty', waitingIds, `Remove ${waitingIds.length} waiting items from the queue without approving or rejecting them?`, 'Queue emptied') },
  ] }) : null;
  const opener = (a) => () => openViewer(shownMedia, shownMedia.indexOf(a));
  return h('div', { class: 'stack' },
    h('div', { class: 'row gap wrap between' },
      h('div', { class: 'seg wide', role: 'group', 'aria-label': 'Filter' }, FILTERS.map(([id, l]) => h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(id === filter), onclick: () => { filter = id; notify(); } }, l, h('span', { class: 'seg-count' }, counts[id])))),
      h('div', { class: 'row gap wrap' },
        h('select', { class: 'select sm', 'aria-label': 'Agent', onchange: (e) => { agent = e.target.value; notify(); } },
          h('option', { value: '' }, 'Every agent'), roleIds.map((id) => h('option', { value: id, selected: id === agent }, roleLabel(id)))),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: older, onchange: (e) => { older = e.target.checked; notify(); } }), h('span', {}, 'Older versions')),
        bulk)),
    sortedGroups.length ? parts.map((p) => [multiGame() ? gameHead(p.game, p.groups.reduce((n, g) => n + g.items.length, 0)) : null,
      p.groups.map((g) => h('section', { class: 'rgroup' }, groupHead(g), h('div', { class: 'rgrid' + (g.items.length <= 2 ? ' few' : '') }, g.items.map((a) => reviewItem(a, opener(a))))))])
      : (otherOpen.length ? null : empty(filter === 'open' ? 'Nothing waiting. When an agent makes an image or screenshot for you, it shows up here.' : 'Nothing in this filter')),
    otherOpen.length ? h('section', { class: 'rgroup' }, h('div', { class: 'rgroup-head' }, h('h2', {}, 'Other questions'), h('span', { class: 'rv-n' }, otherOpen.length)),
      h('div', { class: 'stack' }, otherOpen.map(askCard))) : null);
}

// ---- Stages tab ----
async function loadStages() {
  stageAt = Date.now();
  const get = async (s) => { try { const r = await api('GET', '/api/stage-requests?state=' + s); return Array.isArray(r) ? r : r.requests || []; } catch { return []; } };
  const [open, held, rejected] = await Promise.all([get('open'), get('held'), get('rejected')]);
  stages = { open, held, rejected }; store.stageRequests = open; notify();
}

const stageMode = new Map(); const stageDraft = {}; const CRIT = /^[A-Z][0-9]{1,2}$/;

async function decideStage(r, state, reason, criteria) {
  const body = { state, ...(reason ? { reason } : {}), ...(criteria?.length ? { criteriaFailed: criteria } : {}) };
  if (await act(() => api('POST', `/api/stage-requests/${r.id}/decide`, body), { approved: 'Stage approved', rejected: 'Sent back', held: 'On hold' }[state])) { stageMode.delete(r.id); await loadStages(); loadState().catch(() => {}); }
}

function stageCard(r) {
  const mode = stageMode.get(r.id);
  const box = mode ? (() => {
    const ta = h('textarea', { class: 'textarea', rows: 3, placeholder: mode === 'rejected' ? 'Why is it sent back?' : 'Why is it on hold?', 'aria-label': 'Reason', oninput: (e) => { stageDraft[r.id] = e.target.value; } });
    ta.value = stageDraft[r.id] || '';
    const crit = h('input', { class: 'input', type: 'text', placeholder: 'Failed criteria, for example G5 S4 (optional)', 'aria-label': 'Failed criteria', value: stageDraft['c' + r.id] || '', oninput: (e) => { stageDraft['c' + r.id] = e.target.value; } });
    return h('div', { class: 'stack sm modebox' }, ta, mode === 'rejected' ? crit : null,
      h('div', { class: 'row gap' }, btn(mode === 'rejected' ? 'Send it back' : 'Hold it', () => {
        const reason = ta.value.trim();
        if (!reason) { ta.focus(); toast('Please say why', 'error'); return; }
        const ids = mode === 'rejected' ? String(crit.value).split(/[\s,]+/).filter(Boolean) : [];
        const bad = ids.find((x) => !CRIT.test(x));
        if (bad) { toast(`"${bad}" is not a criteria id. Use a letter and 1 or 2 digits, like G5.`, 'error'); crit.focus(); return; }
        delete stageDraft[r.id]; delete stageDraft['c' + r.id];
        decideStage(r, mode, reason, ids);
      }, { kind: mode === 'rejected' ? 'danger' : 'primary' }), btn('Cancel', () => { stageMode.delete(r.id); notify(); }, { kind: 'ghost' })));
  })() : null;
  return h('article', { class: 'card' },
    h('div', { class: 'row gap between' }, h('h3', {}, `${gameName(r.game)}: ${STAGE_NAME[r.fromStage] || r.fromStage} to ${STAGE_NAME[r.toStage] || r.toStage}`),
      h('span', { class: 'row gap' }, r.state === 'held' ? statePill('review') : null, h('span', { class: 'chip static' }, roleLabel(r.role)))),
    r.evidence ? h('p', { class: 'muted pre' }, r.evidence) : h('p', { class: 'muted' }, 'No evidence attached.'),
    r.state === 'held' && r.reason ? h('p', { class: 'small' }, 'On hold: ', r.reason) : null,
    h('div', { class: 'row gap wrap' },
      btn('Approve', () => decideStage(r, 'approved'), { kind: 'primary', icon: 'check' }),
      r.state === 'held' ? null : btn('Hold', () => { stageMode.set(r.id, 'held'); notify(); }),
      btn('Reject', () => { stageMode.set(r.id, 'rejected'); notify(); }, { kind: 'rv-reject' })),
    box);
}

function stagesTab() {
  if (Date.now() - stageAt > 8000) loadStages();
  const here = (r) => inScope({ game: r.game });
  const pending = [...stages.open, ...stages.held].filter(here);
  const ready = store.gameList.filter((g) => g.stage === 'ready' && inScope({ game: g.slug }));
  const kicked = stages.rejected.filter(here);
  return h('div', { class: 'stack' },
    h('h2', { class: 'section-title' }, `Stage requests (${pending.length})`),
    pending.length ? pending.map(stageCard) : empty('No stage requests waiting'),
    ready.length ? h('h2', { class: 'section-title' }, 'Ready to publish') : null,
    ready.map((g) => h('article', { class: 'card' },
      h('h3', {}, `${g.name} v${g.version ?? 1} is ready`),
      h('p', { class: 'muted' }, 'Going live is a human-only step with its own two-step check.'),
      h('div', { class: 'row' }, h('a', { class: 'btn primary', href: `#/games/${encodeURIComponent(g.slug)}/gate` }, 'Open the publish gate')))),
    kicked.length ? h('h2', { class: 'section-title' }, `Kicked back (${kicked.length})`) : null,
    kicked.length ? h('div', { class: 'tlist' }, kicked.slice(0, 30).map((r) => h('div', { class: 'trow static' },
      h('span', { class: 'trow-main' },
        h('span', { class: 'trow-title' }, `${gameName(r.game)}: ${STAGE_NAME[r.fromStage] || r.fromStage} to ${STAGE_NAME[r.toStage] || r.toStage}`,
          (r.criteriaFailed || []).map((c) => h('span', { class: 'chip static' }, c))),
        h('span', { class: 'trow-meta muted' }, [roleLabel(r.role), r.reason, r.decidedAt ? ago(r.decidedAt) + ' ago' : null].filter(Boolean).join(' · ')))))) : null,
    kicked.length ? h('p', { class: 'hint' }, 'Context only. The agent reworks it and asks again.') : null);
}

// param is an ask id for #/review/<id>: that ask opens in the viewer once per visit.
export function render(param) {
  const mediaOpen = store.asks.filter((a) => needsDecision(a) && (isMediaAsk(a) || a.kind === 'review') && inScope(a)).length;
  const target = param && param !== viewerFor ? store.asks.find((a) => a.id === param && a.mediaPath) : null;
  if (param === 'stages' && param !== viewerFor) tab = 'stages'; // #/review/stages: the link from a stuck card on Home
  viewerFor = param || '';
  if (target) tab = 'images';
  const tabs = [['images', 'Images & video', mediaOpen], ['bar', 'Visual bar', refs.length], ['stages', 'Stages & publish', [...stages.open, ...stages.held].filter((r) => inScope({ game: r.game })).length]];
  if (refsAt === 0) loadRefs();
  const page = h('div', { class: 'page rv-page' },
    h('header', { class: 'page-head' }, h('div', {},
      mediaOpen ? null : h('div', { class: 'overline', 'data-tone': 'green' }, 'All caught up'),
      mediaOpen ? h('div', { class: 'rv-wait muted' }, `${mediaOpen} thing${mediaOpen === 1 ? '' : 's'} waiting for you`) : null, // phone only: the chip beside the title moves above it
      h('div', { class: 'rv-title' }, h('h1', {}, 'Review'), mediaOpen ? h('span', { class: 'chip', 'data-tone': 'need' }, `${mediaOpen} waiting for you`) : null),
      h('p', { class: 'muted' }, 'What the agents made for you. Approve it, ask for changes, or reject it; the agent picks up your verdict next.'))),
    h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([id, l, n]) => h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(id === tab), onclick: () => { tab = id; notify(); } }, l, n ? h('span', { class: 'rv-n' }, n) : null))),
    tab === 'images' ? imagesTab() : tab === 'bar' ? barTab() : stagesTab());
  if (target) setTimeout(() => { const list = shownMedia.includes(target) ? shownMedia : [target, ...shownMedia]; openViewer(list, list.indexOf(target), () => { viewerFor = ''; if (location.hash.startsWith('#/review/')) history.replaceState(null, '', '#/review'); }); }, 0);
  return page;
}
