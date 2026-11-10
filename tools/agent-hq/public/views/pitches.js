// Pitches: decision cards, compare side by side, owner ideas.
import { h, store, api, act, btn, field, empty, ago, upsert, openModal, notify, toast, ic, inScope } from './core.js';
import { chip, num } from './charts.js';

let tab = 'needs';
const picked = new Set();
let earnN = null; let earnAt = 0; // length of the top-earning chart, loaded once per visit
function loadEarnN() {
  if (Date.now() - earnAt < 60000) return;
  earnAt = Date.now();
  api('GET', '/api/market').then((m) => {
    const s = m?.latest?.sorts?.find((x) => x.id === 'top-earning');
    const n = s && Array.isArray(s.games) ? s.games.length : null;
    if (n && n !== earnN) { earnN = n; notify(); }
  }).catch(() => {});
}
const HUES = [262, 200, 160, 30, 330]; // banner tint by format, five fixed hues
const hueOf = (f) => HUES[[...String(f || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length];
const LOOKS = [
  ['stud', 'Stud', 'Blocky parts and plain colours, the classic Roblox feel.'],
  ['stylized', 'Stylized', 'Bright, chunky shapes with a hand-made look.'],
  ['realistic', 'Realistic', 'Detailed materials and lighting, closer to a real place.'],
];
function statTile(label, value, caption, tone) {
  const none = value == null || value === '';
  return h('div', { class: 'pg-stat', 'data-tone': tone || null },
    h('span', { class: 'k' }, label), h('span', { class: 'v' + (none ? ' dim' : '') }, none ? 'not measured' : value),
    caption ? h('span', { class: 't' }, caption) : null);
}
// 52000 -> "52K", 1200 -> "1.2K": tiles are small, so big numbers are shortened.
const compact = (n) => (n == null || n === '' || Number.isNaN(Number(n)) ? null : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n)));
const firstSentence = (t) => { const m = String(t || '').trim().match(/^.*?[.!?](\s|$)/s); return (m ? m[0] : String(t || '')).trim().slice(0, 220); };

const state = (p) => (p.state === 'rejected' ? 'declined' : p.state);
const TABS = [
  ['needs', 'Needs your decision', (p) => state(p) === 'proposed'],
  ['waiting', 'Waiting on Scout', (p) => ['evaluating', 'changes'].includes(state(p))],
  ['yours', 'Your ideas', (p) => p.origin === 'owner'],
  ['history', 'History', (p) => ['approved', 'declined', 'withdrawn'].includes(state(p))],
];

export const FORMATS = ['Collect & upgrade', 'Steal & escape', 'Survive & extract', 'Build & defend', 'Find the hidden', 'Race & rank', 'Tycoon & expand', 'Guess & reveal', 'Clean & restore', 'Raise & evolve'];
const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const text = (x) => (x == null ? '' : typeof x === 'string' ? x : JSON.stringify(x));
const pct = (v) => (v == null ? null : (v <= 1 ? Math.round(v * 100) : Math.round(v)) + '%');
const g = (p) => (p.game && typeof p.game === 'object' ? p.game : {});
const ev = (p) => (p.evidence && typeof p.evidence === 'object' ? p.evidence : { summary: text(p.evidence), links: [] });
const bld = (p) => (p.building && typeof p.building === 'object' ? p.building : {});
// Fields a pitch needs before it can be decided. The Scout has to fix the rest.
function problems(p) {
  if (Array.isArray(p.schemaErrors) && p.schemaErrors.length) return p.schemaErrors.map(String);
  const miss = [];
  if (!p.oneLiner) miss.push('one-liner');
  if (!p.format) miss.push('game type');
  if (!p.window) miss.push('window');
  if (!p.edge) miss.push('how we are different');
  if (!arr(p.competitors).length) miss.push('competitors');
  if (!(g(p).howItPlays || p.coreLoop)) miss.push('how it plays');
  if (!ev(p).summary && !arr(ev(p).links).length) miss.push('evidence');
  if (!arr(p.risks).length) miss.push('risks');
  return miss;
}
const best = (list, key) => list.map((c) => c[key]).filter((v) => v != null && !Number.isNaN(Number(v))).reduce((a, v) => (a == null || v > a ? v : a), null);

function decide(p, body, okMsg) {
  return act(async () => {
    const r = await api('POST', `/api/pitches/${encodeURIComponent(p.id)}/decide`, body);
    if (r && r.id) upsert(store.pitches, r);
    else if (r && r.pitch && r.pitch.id) upsert(store.pitches, r.pitch);
    else p.state = body.state;
    notify();
  }, okMsg);
}

function askNote(title, label, cta, onSubmit) {
  const note = h('textarea', { class: 'pg-input', rows: 4, maxlength: 2000, placeholder: label });
  let close;
  const form = h('form', { class: 'pg-form', onsubmit: async (e) => {
    e.preventDefault();
    if (!note.value.trim()) { toast('Write a short note first', 'error'); return; }
    if (await onSubmit(note.value.trim())) close();
  } }, note, h('div', { class: 'row gap end' }, btn(cta, null, { kind: 'primary' })));
  form.querySelector('button').type = 'submit';
  close = openModal(title, form);
  note.focus();
}

function editApprove(p) {
  const gm = g(p);
  const F = [
    ['title', 'Title', p.title, 200, false], ['oneLiner', 'One-liner', p.oneLiner, 300, false], ['edge', 'How we are different', p.edge, 600, true],
    ['howItPlays', 'How it plays', gm.howItPlays, 2000, true], ['first60s', 'First 60 seconds', gm.first60s, 2000, true],
    ['goal10to15', 'Goal at 10 to 15 minutes', gm.goal10to15, 2000, true], ['monetization', 'How it makes money', gm.monetization, 2000, true],
    ['clipMoment', 'The clip moment', gm.clipMoment, 2000, true], ['iconIdea', 'Icon idea', gm.iconIdea, 2000, true],
  ];
  const fmt = h('select', { class: 'select' }, [h('option', { value: '' }, 'Choose a game type'), ...[...new Set([...(p.format ? [p.format] : []), ...FORMATS])].map((f) => h('option', { value: f }, f))]);
  fmt.value = p.format || '';
  const inputs = F.map(([k, label, v, max, multi]) => [k, multi ? h('textarea', { class: 'pg-input', rows: 3, maxlength: max, value: v || '' }) : h('input', { class: 'pg-input', maxlength: max, value: v || '' })]);
  let close;
  const form = h('form', { class: 'pg-form', onsubmit: async (e) => {
    e.preventDefault();
    const edits = {}; const game = { ...gm };
    inputs.forEach(([k, el]) => {
      const v = el.value.trim();
      if (['title', 'oneLiner', 'edge'].includes(k)) { if (v !== (p[k] || '')) edits[k] = v; } else if (v !== (gm[k] || '')) game[k] = v;
    });
    if (fmt.value !== (p.format || '')) edits.format = fmt.value;
    if (JSON.stringify(game) !== JSON.stringify(gm)) edits.game = game;
    if (!(edits.title ?? p.title)) { toast('A pitch needs a title', 'error'); return; }
    if (await decide(p, { state: 'approved', edits }, 'Approved with your edits, the Lead will plan it')) close();
  } },
  field('Game type', fmt),
  F.map(([k, label], i) => field(label, inputs[i][1])),
  h('div', { class: 'row gap end' }, btn('Approve with these edits', null, { kind: 'primary', icon: 'check' })));
  form.querySelector('button').type = 'submit';
  close = openModal('Edit and approve', form);
}

const openSecs = new Set(); // keeps sections open across re-renders
function section(pid, label, count, ...kids) {
  const key = pid + ':' + label;
  return h('details', { open: openSecs.has(key), ontoggle: (e) => { if (e.target.open) openSecs.add(key); else openSecs.delete(key); } },
    h('summary', {}, label, count != null ? h('span', { class: 'pg-count' }, count) : null), h('div', { class: 'body' }, kids));
}
const kv = (label, v) => (v ? h('div', { class: 'pg-kv' }, h('h4', {}, label), h('p', { class: 'pre' }, text(v))) : null);
const linkOrText = (u) => (/^https?:\/\//i.test(u) ? h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)) : h('span', {}, u));

function card(p) {
  const gm = g(p); const e = ev(p); const b = bld(p); const comps = arr(p.competitors); const cmp = arr(p.comparables); const risks = arr(p.risks);
  const links = arr(e.links);
  const evCount = (e.summary ? 1 : 0) + links.length;
  const bCount = arr(b.gaps).length + (b.assetNotes ? 1 : 0) + (b.experience ? 1 : 0);
  const st = state(p);
  const open = st === 'proposed';
  const lk = best(cmp, 'likeRatio');
  const toneW = { early: 'ok', mid: 'warn', late: 'err' }[p.window];
  const checked = picked.has(p.id);
  const miss = open ? problems(p) : [];
  const custom = arr(b.gaps);
  const crowded = (p.saturationCount != null && p.saturationCount >= 5) || cmp.length >= 4;
  const topRank = p.money?.topEarningRank;
  const lookCards = ['stud', 'stylized', 'realistic'].includes(p.look) ? h('div', { class: 'pg-kv' }, h('h4', {}, 'The look'),
    h('div', { class: 'pg-looks' }, LOOKS.map(([id, name, line]) => h('div', { class: 'pg-look', 'data-on': String(id === p.look) },
      h('strong', {}, name, id === p.look ? h('span', { class: 'pg-trend' }, 'Trending') : null), h('span', { class: 'muted' }, line))))) : null;
  return h('article', { class: 'pg-card pg-pitch', 'data-id': p.id },
    h('div', { class: 'pg-banner-img', style: `--hue:${hueOf(p.format)}` },
      h('span', { class: 'tile', 'aria-hidden': 'true' }, ic('pitches', 26)),
      h('div', { class: 'pg-bhead' },
        h('div', { class: 'head' },
          p.window ? chip(p.window === 'early' ? 'early to the trend' : p.window + ' window', toneW) : null,
          crowded ? chip('others are on it', 'warn') : null,
          p.format ? chip(p.format) : null,
          p.origin === 'owner' ? chip('your idea', 'accent') : null,
          st === 'proposed' ? null : chip(st, st === 'approved' ? 'ok' : st === 'declined' || st === 'withdrawn' ? 'err' : null)),
        h('h3', { class: 'title' }, p.title),
        p.oneLiner ? h('p', { class: 'one' }, p.oneLiner) : null,
        e.summary ? h('p', { class: 'pg-evline' }, firstSentence(e.summary)) : null)),
    miss.length ? h('div', { class: 'pg-banner' }, h('strong', {}, 'This pitch cannot be decided yet. '), `It is missing: ${miss.join(', ')}. The Scout has to fix it; use Send to Scout.`) : null,
    p.edge || comps.length ? h('div', { class: 'pg-differ' },
      h('div', { class: 'dh' }, ic('radar', 16), h('h4', {}, 'How we differ')),
      h('div', {}, p.edge ? h('p', {}, p.edge) : null,
        comps.length ? h('div', { class: 'row gap wrap', style: 'margin-top:6px' }, comps.slice(0, 4).map((c) => chip('vs ' + c.name))) : null)) : null,
    cmp.length || p.money || p.saturationCount != null ? h('div', { class: 'pg-stats' },
      statTile('TOP EARNING RANK', topRank != null ? '#' + num(topRank) : null, [p.money?.comparable, earnN && topRank != null && topRank <= earnN ? `of ${compact(earnN)}` : null].filter(Boolean).join(' · ') || null),
      statTile('TOP COMPARABLE PLAYING', compact(best(cmp, 'playing')), cmp.find((c) => c.playing === best(cmp, 'playing'))?.name),
      statTile('ITS LIKES', lk != null ? pct(lk) : null, '80%+ gets recommended', lk != null ? (lk >= (lk <= 1 ? 0.8 : 80) ? 'ok' : 'warn') : null),
      statTile('UPVOTES PER DAY', compact(best(cmp, 'upvotesPerDay')), "how fast it's growing"),
      statTile('SIMILAR GAMES', compact(p.saturationCount), p.saturationCount != null ? 'on the charts now' : null)) : null,
    p.money?.verdict ? h('div', { class: 'pg-money-line' }, ic('dollar', 18), h('p', {}, h('strong', {}, 'Money verdict. '), p.money.verdict, p.money.comparable ? h('span', { class: 'muted' }, ' Comparable: ' + p.money.comparable) : null)) : null,
    custom.length ? h('div', { class: 'pg-kv' }, h('h4', {}, 'Custom systems to build'), h('ul', { class: 'pg-bullets' }, custom.map((x) => h('li', {}, text(x))))) : null,
    risks.length ? h('div', { class: 'pg-kv' }, h('h4', {}, 'Biggest risk'), h('p', {}, text(risks[0]))) : null,
    section(p.id, 'The game', null,
      h('table', { class: 'pg-game-tbl' }, h('tbody', {}, [
        ['How it plays', gm.howItPlays || p.coreLoop], ['First 60 seconds', gm.first60s], ['Goal at 10 to 15 minutes', gm.goal10to15], ['Minutes 10 to 20', gm.minutes10to20],
        ['How it makes money', gm.monetization], ['The clip moment', gm.clipMoment], ['Icon idea', gm.iconIdea],
      ].filter((r) => r[1]).map(([k, v]) => h('tr', {}, h('th', { scope: 'row' }, k), h('td', { class: 'pre' }, text(v)))),
      arr(gm.modules).length ? h('tr', {}, h('th', { scope: 'row' }, 'Systems it uses'), h('td', {}, h('div', { class: 'row gap wrap' }, arr(gm.modules).map((m) => chip(m))))) : null)),
      !(gm.howItPlays || p.coreLoop) ? h('p', { class: 'muted' }, 'The Scout has not filled this in yet.') : null),
    section(p.id, 'Closest competitors', comps.length + cmp.length,
      comps.map((c) => h('div', { class: 'pg-kv' }, h('h4', {}, c.name), c.whatItIs ? h('p', {}, c.whatItIs) : null, c.gap ? h('p', { class: 'muted' }, 'Their gap: ' + c.gap) : null)),
      cmp.length ? h('div', { class: 'pg-scroll' }, h('table', { class: 'pg-tbl' },
        h('thead', {}, h('tr', {}, ['Comparable', 'Playing', 'Likes', 'Upvotes/day', 'Rank climb'].map((c, i) => h('th', { class: i ? 'num' : '' }, c)))),
        h('tbody', {}, cmp.map((c) => h('tr', {}, h('td', { class: 'wrapc' }, c.name, c.note ? h('div', { class: 'muted' }, c.note) : null),
          h('td', { class: 'num' }, num(c.playing)), h('td', { class: 'num' }, pct(c.likeRatio) || 'n/a'), h('td', { class: 'num' }, num(c.upvotesPerDay)), h('td', { class: 'num' }, c.rankClimb ?? 'n/a')))))) : null,
      !comps.length && !cmp.length ? h('p', { class: 'muted' }, 'No competitors listed yet.') : null),
    section(p.id, 'Evidence', evCount, e.summary ? h('p', { class: 'pre' }, e.summary) : null,
      links.length ? h('ul', { class: 'pg-list' }, links.map((u) => h('li', {}, linkOrText(String(u))))) : null,
      !evCount ? h('p', { class: 'muted' }, 'No evidence attached.') : null),
    section(p.id, 'Building it', bCount, kv('Gaps to fill', arr(b.gaps).join('\n')), kv('Asset notes', b.assetNotes), kv('Experience', b.experience), !bCount ? h('p', { class: 'muted' }, 'Nothing listed yet.') : null),
    section(p.id, 'Risks', risks.length, risks.length ? h('ul', { class: 'pg-bullets' }, risks.map((r) => h('li', {}, text(r)))) : h('p', { class: 'muted' }, 'No risks listed.')),
    lookCards,
    p.note && ['changes', 'declined'].includes(st) ? h('p', { class: 'pg-note' }, 'Your note: ' + p.note) : null,
    h('div', { class: 'pg-actions' },
      h('label', { class: 'sel' }, h('input', { type: 'checkbox', checked, onchange: (ev2) => {
        if (ev2.target.checked) { if (picked.size >= 3) { ev2.target.checked = false; toast('Compare up to 3 pitches', 'error'); return; } picked.add(p.id); } else picked.delete(p.id);
        notify();
      } }), 'Compare'),
      open ? [
        btn('Decline', () => askNote('Decline this pitch', 'Why? (optional context for the Scout)', 'Decline', async (n) => decide(p, { state: 'declined', note: n }, 'Declined')), { kind: 'sm' }),
        btn('Send to Scout', () => askNote('Send to Scout', 'What should the Scout change or look into?', 'Send to Scout', async (n) => decide(p, { state: 'changes', note: n }, 'The Scout will revise it')), { kind: 'caution' }),
        btn('Edit and approve', () => editApprove(p), { icon: 'pencil', disabled: miss.length > 0 }),
        btn('Approve', () => decide(p, { state: 'approved' }, 'Approved, the Lead will plan it'), { kind: 'primary', icon: 'check', disabled: miss.length > 0, title: miss.length ? 'Incomplete pitch: send it back to the Scout' : '' }),
      ] : null),
    h('p', { class: 'pg-foot muted' }, 'Pitched ' + (ago(p.createdAt) === 'just now' ? 'just now' : ago(p.createdAt) + ' ago')));
}

function openCompare(list) {
  const rows = [
    ['Format', (p) => p.format], ['Window', (p) => p.window], ['How we are different', (p) => p.edge], ['Top earning rank', (p) => (p.money?.topEarningRank != null ? '#' + p.money.topEarningRank : null)],
    ['Top comparable playing', (p) => (best(arr(p.comparables), 'playing') != null ? num(best(arr(p.comparables), 'playing')) : null)],
    ['Its likes', (p) => pct(best(arr(p.comparables), 'likeRatio'))], ['Upvotes per day', (p) => (best(arr(p.comparables), 'upvotesPerDay') != null ? num(best(arr(p.comparables), 'upvotesPerDay')) : null)],
    ['Similar games on the charts', (p) => (p.saturationCount != null ? num(p.saturationCount) : null)], ['Money verdict', (p) => p.money?.verdict],
    ['How it plays', (p) => g(p).howItPlays || p.coreLoop], ['Goal at 10 to 15 minutes', (p) => g(p).goal10to15], ['How it makes money', (p) => g(p).monetization],
    ['Risks', (p) => arr(p.risks).map(text).join('; ')],
  ];
  const grid = h('div', { class: 'pg-compare', style: `--cols:${list.length}` },
    list.map((p) => h('div', { class: 'colh' }, p.title)),
    rows.flatMap(([label, f]) => list.map((p) => h('div', { class: 'cell' }, h('div', { class: 'lab' }, label), h('div', { class: 'pre' }, f(p) || 'n/a')))));
  openModal('Compare side by side', grid);
}

function newIdea() {
  const title = h('input', { class: 'pg-input', maxlength: 120, placeholder: 'Working title' });
  const extra = h('textarea', { class: 'pg-input', rows: 3, maxlength: 2000, placeholder: 'Games you like, what to avoid, a rough budget, anything else' });
  const idea = h('textarea', { class: 'pg-input', rows: 5, maxlength: 4000, placeholder: 'What is the game? What would a player do in the first minute?' });
  let close;
  const form = h('form', { class: 'pg-form', onsubmit: async (e) => {
    e.preventDefault();
    if (!title.value.trim() || !idea.value.trim()) { toast('Add a title and a few lines about the idea', 'error'); return; }
    const r = await act(() => api('POST', '/api/pitches/ideas', { title: title.value.trim(), idea: idea.value.trim() + (extra.value.trim() ? '\n\nAnything else: ' + extra.value.trim() : '') }), 'Sent to the Scout to evaluate');
    if (r) { if (r.id) upsert(store.pitches, r); tab = 'yours'; close(); notify(); }
  } },
  field('Title', title), field('Your idea', idea, 'The Scout checks it against the charts and comes back with evidence, competitors and risks.'),
  h('div', { class: 'row gap end' }, btn('Send to Scout', null, { kind: 'primary' })));
  form.querySelector('button').type = 'submit';
  close = openModal('New game idea', form);
  title.focus();
}

function findNext() {
  return act(() => api('POST', '/api/tasks', {
    role: 'scout', title: 'Find my next game',
    body: 'Look at the latest Roblox charts and the rising games. Pitch one or two Mild, original game ideas that follow a pattern that is working, with evidence, competitors and risks.',
    createdBy: 'owner',
  }), 'Scout is on it');
}

export function render() {
  // A pitch only has a game slug once it belongs to one; until then it is in scope everywhere.
  const all = store.pitches.filter(inScope).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const counts = Object.fromEntries(TABS.map(([id, , f]) => [id, all.filter(f).length]));
  const cur = TABS.find((t) => t[0] === tab) || TABS[0];
  const list = all.filter(cur[2]);
  for (const id of [...picked]) if (!all.some((p) => p.id === id)) picked.delete(id);
  const chosen = all.filter((p) => picked.has(p.id));
  loadEarnN();
  const every = Number(store.settings?.marketEveryHours) || 0;
  // Hunting means a Scout task that looks for new games is queued or running; scoring one idea does not count.
  const hunting = store.tasks.some((t) => t.role === 'scout' && ['queued', 'working'].includes(t.state) && /next game|pitch/i.test(t.title));
  const cadence = every ? `The charts refresh every ${every} hour${every === 1 ? '' : 's'}.` : 'Chart refresh is off. Turn it on in Settings.';
  return h('div', { class: 'page' },
    h('header', { class: 'page-head pg-head' },
      h('div', {}, h('h1', {}, 'Pitches'), h('p', { class: 'muted' }, 'Game ideas with the evidence behind them. Approving one withdraws the other open pitches and asks the Lead to plan it.')),
      h('div', { class: 'row gap' },
        btn('Find my next game', findNext, { kind: 'primary', icon: 'radar' }),
        btn('New game idea', newIdea, { icon: 'plus' }),
        btn(`Compare${chosen.length ? ' (' + chosen.length + ')' : ''}`, () => (chosen.length >= 2 ? openCompare(chosen) : toast('Tick Compare on 2 or 3 pitches first', 'error'))))),
    h('div', { class: 'pg-hunt', role: 'note' },
      hunting ? h('p', {}, h('strong', {}, 'Hunting.'), ' The Scout is reading the live charts. Pitches land under Needs your decision once there is evidence behind them. Nothing is built until you approve one. ', cadence)
        : h('p', {}, h('strong', {}, 'The hunt is off.'), ' Press ', h('strong', {}, 'Find my next game'), ' and the Scout reads the live charts, then brings back pitches with the evidence behind them. Nothing is built until you approve one. Your own idea? ', h('strong', {}, 'New game idea'), ' hands it to the Scout. ', cadence)),
    h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([id, l]) => h('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(id === tab), onclick: () => { tab = id; notify(); } },
      l, h('span', { class: 'count', 'data-tone': 'grey' }, counts[id])))),
    h('p', { class: 'pg-alt muted' }, 'These are alternatives. Until game #1 is live, approving one withdraws the others.'),
    list.length ? h('div', { class: 'pg-pitches' }, list.map(card))
      : empty(tab === 'needs' ? 'Nothing to decide. Ask the Scout for ideas from the Market page, or add your own.' : tab === 'waiting' ? 'The Scout is not working on anything for you right now.' : tab === 'yours' ? 'No ideas from you yet. Use New game idea.' : 'No decided pitches yet.'));
}
