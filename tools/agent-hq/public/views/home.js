import { h, store, api, act, ic, btn, empty, roleLabel, avatar, roleStatus, ago, fmtTime, go, plain, gameName, studioLocks, loadFreshness, loadState, toast, notify, inScope, rosterOrder, scope, itemGame, multiGame, gameChip, selectEl } from './core.js';
import { askCard, answer, isMediaAsk, needsDecision, verdictOf, noteOf } from './review.js';
import { newTaskModal, openTaskDrawer, isBackToYou } from './tasks.js';

let leadDraft = '';
let askGame = ''; // "for:" chip of Ask the Lead under All games
const replyOpen = new Set();
const replyDraft = {};
const building = new Set(); // game slugs whose newest build is being made
let laterOpen = false;
const noteOpen = new Set();
const noteDraft = {};

const STAGE_NAME = { pitched: 'Pitched', designed: 'Designed', assets: 'Assets ready', built: 'Built', balanced: 'Balanced', art: 'Art done', ready: 'Ready to publish', live: 'Live', graded: 'Graded' };

function agoText(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}

function greeting() {
  const d = new Date();
  const hr = d.getHours();
  const g = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const name = String(store.settings.ownerName || '').trim();
  return {
    hello: g,
    name,
    when: d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) + ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  };
}

const tile = (name, tone) => h('span', { class: 'tile', 'data-tone': tone || null, 'aria-hidden': 'true' }, ic(name, 18));

// One line that sends the owner to Review; the pictures themselves live there.
function reviewCard(media) {
  return h('article', { class: 'card ask group-card tile-card' }, tile('image'),
    h('div', { class: 'done-main' },
      h('span', { class: 'overline' }, 'Review'),
      h('h3', {}, `${media.length} new thing${media.length === 1 ? '' : 's'} to look at from the agents`),
      h('div', { class: 'row' }, btn('Review them', () => go('#/review'), { kind: 'sm' }))));
}

function tryCard(ask) {
  const open = replyOpen.has(ask.id);
  const ta = open ? h('textarea', { class: 'textarea', rows: 3, placeholder: 'What happened when you tried it?', 'aria-label': 'What happened', oninput: (e) => { replyDraft[ask.id] = e.target.value; } }) : null;
  if (ta) ta.value = replyDraft[ask.id] || '';
  return h('article', { class: 'card ask tile-card', 'data-kind': 'try' }, tile('gamepad', 'green'),
    h('div', { class: 'done-main' },
      h('div', { class: 'row gap' }, h('span', { class: 'overline', 'data-tone': 'green' }, 'Try it · ' + roleLabel(ask.role)), h('span', { class: 'muted small grow end-text' }, agoText(ask.createdAt))),
      h('h3', {}, plain(ask.title)),
      ask.why ? h('p', { class: 'muted pre' }, ask.why) : null,
      ta,
      h('div', { class: 'row gap wrap' },
        open ? btn('Send reply', async () => {
          const text = ta.value.trim();
          if (!text) { ta.focus(); return; }
          if (await act(() => api('POST', `/api/asks/${ask.id}/answer`, { answer: text }), 'Reply sent')) {
            replyOpen.delete(ask.id); delete replyDraft[ask.id];
            notify();
          }
        }, { kind: 'primary sm', icon: 'send' }) : btn('Reply', () => { replyOpen.add(ask.id); notify(); }, { kind: 'sm', icon: 'send' }),
        // the agent asked the owner to do a laptop chore: send it back to the agent to do itself, and run its task again
        ask.taskId ? btn('Do it for me', async () => {
          const said = await act(() => api('POST', `/api/asks/${ask.id}/answer`, { answer: 'Do it yourself: Studio is open with its MCP server on. Run checks with hq_game_check, use the Roblox Studio tools, and call hq_open_studio if Studio is not connected.' }), 'Sent back to the agent');
          const t = store.tasks.find((x) => x.id === ask.taskId);
          if (said && t && ['failed', 'review', 'done'].includes(t.state)) await act(() => api('POST', `/api/tasks/${t.id}/retry`, {}), 'Task restarted');
        }, { kind: 'primary sm', icon: 'sparkles' }) : null,
        btn('Done', () => act(() => api('POST', `/api/asks/${ask.id}/answer`, { answer: 'done' }), 'Marked done'), { kind: 'good sm', icon: 'check' }),
        ask.taskId ? btn('Details', () => openTaskDrawer(ask.taskId), { kind: 'ghost sm' }) : null)));
}

function publishCards() {
  return store.gameList.filter((g) => g.stage === 'ready').map((g) => h('article', { class: 'card ask', 'data-kind': 'publish' },
    h('div', { class: 'row gap' }, h('span', { class: 'overline', 'data-tone': 'amber' }, 'Ready to publish'), h('span', { class: 'chip static' }, 'only you can')),
    h('h3', {}, `${g.name} v${g.version ?? 1} is ready`),
    h('p', { class: 'muted' }, 'Going live is a human-only step with its own two-step check.'),
    h('div', { class: 'row' }, h('a', { class: 'btn primary', href: `#/games/${encodeURIComponent(g.slug)}/gate` }, 'Open the publish gate'))));
}

function pickCard() {
  const awaiting = store.pitches.filter((p) => p.state === 'proposed' && inScope(p)).length;
  const inProgress = store.gameList.some((g) => !['live', 'graded'].includes(g.stage));
  if (!awaiting && (inProgress || !store.gameList.length)) return null;
  return h('article', { class: 'card ask tile-card', 'data-kind': 'pick' }, tile('pitches'),
    h('div', { class: 'done-main' },
      h('span', { class: 'overline' }, 'Pick the next game'),
      h('h3', {}, awaiting ? `${awaiting} pitch${awaiting === 1 ? '' : 'es'} await${awaiting === 1 ? 's' : ''} your decision` : 'No game is in progress'),
      awaiting ? null : h('p', { class: 'muted' }, 'Look at the pitches and pick one.'),
      h('div', { class: 'row' }, btn('See the pitches', () => go('#/pitches'), { kind: 'sm' }))));
}

// A finished piece of work waiting for the owner: a task in review, or an open review ask.
function doneCard({ task, ask }) {
  const src = task || ask;
  const key = (task ? 't:' : 'a:') + src.id;
  const open = noteOpen.has(key);
  const body = task ? task.summary || 'The agent did not write a summary.' : ask.why || 'Nothing written yet. Open it to see the work.';
  const ta = open ? h('textarea', { class: 'textarea', rows: 3, placeholder: 'What is not right?', 'aria-label': 'What is not right', oninput: (e) => { noteDraft[key] = e.target.value; } }) : null;
  if (ta) ta.value = noteDraft[key] || '';
  const done = () => { noteOpen.delete(key); delete noteDraft[key]; };
  // A task with an open review ask is decided through that ask, so the ask and the task close together.
  const target = store.asks.find((a) => needsDecision(a) && a.kind === 'review' && (a === ask || (task && a.taskId === task.id)));
  const send = async (verdict, note) => {
    const via = ask || target;
    if (via) { const r = await answer(via, verdict === 'approve' ? 'approve' : 'changes:' + note, verdict === 'approve' ? 'Approved' : 'Sent back for rework'); if (r) done(); return; }
    const r = await act(() => api('POST', `/api/tasks/${task.id}/verdict`, note ? { verdict, note } : { verdict }), verdict === 'approve' ? 'Done. Marked as finished.' : 'Sent back for rework');
    if (r) { done(); loadState().catch(() => {}); notify(); }
  };
  const see = () => (target ? go('#/review/' + target.id) : task ? openTaskDrawer(task.id) : ask.taskId ? openTaskDrawer(ask.taskId) : go('#/review'));
  const when = agoText(task ? task.endedAt || task.startedAt || task.createdAt : ask.createdAt);
  return h('article', { class: 'card tile-card done-card', 'data-kind': task ? 'back' : 'review' },
    avatar(src.role, 36),
    h('div', { class: 'done-main' },
      h('span', { class: 'overline', 'data-tone': 'green' }, roleLabel(src.role) + ' finished · check it'),
      h('h3', {}, plain(src.title)),
      h('p', { class: 'muted pre done-body' }, body),
      ta,
      h('div', { class: 'row gap wrap done-actions' },
        btn('Looks good', () => send('approve'), { kind: 'good sm', icon: 'check' }),
        btn('See what changed', see, { kind: 'sm' }),
        open
          ? btn('Send it back', () => { const n = ta.value.trim(); if (!n) { ta.focus(); toast('Say what is not right', 'error'); return; } send('changes', n); }, { kind: 'caution sm' })
          : btn('Not right: say what', () => { noteOpen.add(key); notify(); }, { kind: 'ghost sm', icon: 'pencil' }),
        open ? btn('Cancel', () => { done(); notify(); }, { kind: 'ghost sm' }) : null,
        h('span', { class: 'muted small done-when' }, when))));
}

// A card for work the owner must unstick: a gate that failed for good, or a stage the producer keeps sending back.
function stuckCard({ role, title, why, ask, href }) {
  return h('article', { class: 'card ask tile-card stuck-card', 'data-kind': 'stuck' }, tile('alert', 'amber'),
    h('div', { class: 'done-main' },
      h('span', { class: 'overline', 'data-tone': 'amber' }, 'Stuck · your call'),
      h('h3', {}, plain(title)),
      why ? h('p', { class: 'muted pre done-body' }, why) : null,
      h('div', { class: 'row gap wrap' },
        (ask?.options || []).map((o) => btn(o.label, () => answer(ask, o.id), { kind: o.recommended ? 'primary sm' : 'sm' })),
        btn('Open in Review', () => go(href), { kind: 'sm' }),
        role ? h('span', { class: 'muted small done-when' }, roleLabel(role)) : null)));
}
const isGateAsk = (a) => a.kind === 'decision' && /^Gate failed/.test(a.title);
// Stage requests that a game has had sent back twice or more and that are still waiting.
const stuckStages = () => store.gameList.filter((g) => (g.reworkCount ?? 0) >= 2 && inScope({ game: g.slug })).map((g) => ({ g, r: store.stageRequests.find((x) => x.game === g.slug && x.state === 'open') })).filter((x) => x.r);

// Parked items: asks held for later and stage requests on hold. One collapsed row; each line opens Review.
function laterRow() {
  const asks = store.asks.filter((a) => a.state === 'answered' && verdictOf(a) === 'held' && !a.superseded && inScope(a));
  const stages = store.stageRequests.filter((r) => r.state === 'held' && inScope({ game: r.game }));
  const n = asks.length + stages.length;
  if (!n) return null;
  const line = (title, why, href) => h('li', {}, h('a', { class: 'later-row', href }, h('span', { class: 'later-title' }, plain(title)), why ? h('span', { class: 'muted small later-why' }, plain(why)) : null, ic('chevron', 14)));
  return h('details', { class: 'later', open: laterOpen, ontoggle: (e) => { laterOpen = e.target.open; } },
    h('summary', {}, `Later (${n})`),
    h('ul', { class: 'plain later-list' },
      asks.map((a) => line(a.title, noteOf(a), a.mediaPath ? '#/review/' + a.id : '#/review')),
      stages.map((r) => line(`${gameName(r.game)}: ${STAGE_NAME[r.fromStage] || r.fromStage} to ${STAGE_NAME[r.toStage] || r.toStage}`, r.reason, '#/review/stages'))));
}

// Order: finished work, the Review card, the next-game card, then everything else.
function needsYou() {
  const open = store.asks.filter((a) => needsDecision(a) && inScope(a));
  const media = open.filter(isMediaAsk);
  const rest = open.filter((a) => !isMediaAsk(a));
  const cards = [];
  const gm = new Map(); // card -> game slug, so All games can group by game
  const tag = (card, item) => { gm.set(card, itemGame(item)); return card; };
  // A task whose review ask is already on Home is decided there, so it is not shown twice.
  for (const t of store.tasks.filter((x) => isBackToYou(x) && inScope(x))) if (!open.some((a) => a.kind === 'review' && a.taskId === t.id)) cards.push(tag(doneCard({ task: t }), t));
  for (const a of rest) if (a.kind === 'review') cards.push(tag(doneCard({ ask: a }), a));
  // one review card per game, so All games can file each under its own game
  for (const s of [...new Set(media.map(itemGame))]) { const mine = media.filter((a) => itemGame(a) === s); cards.push(tag(reviewCard(mine), mine[0])); }
  const pick = pickCard();
  if (pick) cards.push(pick);
  cards.push(...publishCards());
  for (const a of rest) {
    if (isGateAsk(a)) cards.push(tag(stuckCard({ role: a.role, title: a.title, why: a.why, ask: a, href: '#/review' }), a));
    else if (a.kind === 'try') cards.push(tag(tryCard(a), a));
    else if (a.kind !== 'review') cards.push(tag(askCard(a), a));
  }
  for (const { g, r } of stuckStages()) cards.push(stuckCard({ role: r.role, title: `${g.name} keeps coming back from ${STAGE_NAME[r.toStage] || r.toStage}`, why: `The producer has sent it back ${g.reworkCount} times. Look at the evidence and say what happens next.`, href: '#/review/stages' }));
  const later = laterRow();
  if (later) cards.push(later);
  if (!cards.length) return [empty('Nothing needs you right now')];
  return scope() ? cards : groupByGame(cards, gm);
}

// All games: with items from more than one game, a small header per game (name, count); "No game" last.
function groupByGame(cards, gm) {
  const games = new Set([...gm.values()]);
  if (games.size < 2 && store.gameList.length < 2) return cards; // one game in the studio: no headers needed
  const order = [...store.gameList.map((g) => g.slug).filter((s) => games.has(s)), ...[...games].filter((s) => s && !store.gameList.some((g) => g.slug === s)), ''].filter((s, i, a) => games.has(s) && a.indexOf(s) === i);
  const out = cards.filter((c) => !gm.has(c));
  for (const s of order) {
    const mine = cards.filter((c) => gm.get(c) === s);
    out.push(h('h3', { class: 'game-group' }, s ? gameName(s) : 'No game', h('span', { class: 'count' }, mine.length)), ...mine);
  }
  return out;
}

// Live now: roles that are busy, in the sidebar team order. With a game picked, only roles with work on that game.
function liveNow() {
  const mine = (id) => store.tasks.some((t) => t.role === id && ['working', 'queued', 'review'].includes(t.state) && inScope(t));
  const rows = rosterOrder(store.roles).map((r) => ({ r, st: roleStatus(r.id) })).filter((x) => x.st.state !== 'idle' && mine(x.r.id));
  const open = (id) => go('#/team/' + id);
  return h('section', { class: 'card' },
    h('h2', { class: 'sec-h' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), 'Live now'),
    rows.length ? h('ul', { class: 'live' }, rows.map(({ r, st }) => h('li', { class: 'live-row' + (st.task ? ' on' : ''), 'data-state': st.task ? 'working' : 'queued', role: 'button', 'aria-label': 'Open the ' + r.label + ' chat', onclick: () => open(r.id), tabindex: '0', onkeydown: (e) => { if (e.key === 'Enter') open(r.id); } },
      avatar(r.id, 28),
      h('span', { class: 'live-main' },
        h('span', { class: 'live-role' }, r.label, scope() ? null : gameChip(st.task?.game)),
        h('span', { class: 'live-what muted' }, st.task ? 'On: ' + plain(st.task.title) : st.queued ? `${st.queued} task${st.queued === 1 ? '' : 's'} waiting` : 'Work is in review')),
      h('span', { class: 'live-end' }, st.task ? h('span', { class: 'spin-ring', role: 'img', 'aria-label': 'Working' }) : st.queued ? h('span', { class: 'live-q' }, st.queued + ' queued') : null))))
      : h('p', { class: 'muted' }, 'Everyone is idle.'));
}

const STAGES = Object.keys(STAGE_NAME);
function stageDots(stage) {
  const at = STAGES.indexOf(stage);
  const label = at < 0 ? 'Stage not set' : `Stage ${at + 1} of ${STAGES.length}: ${STAGE_NAME[stage]}`;
  return h('span', { class: 'row gap stage' },
    h('span', { class: 'dots9', role: 'img', 'aria-label': label }, STAGES.map((k, i) => h('i', { 'data-s': i < at ? 'done' : i === at ? 'now' : 'next' }))),
    h('span', { class: 'stage-word' }, STAGE_NAME[stage] || stage || 'No stage yet'));
}

// Build the newest version of a game and open it. The server never publishes; it only makes a local file.
async function play(slug) {
  if (building.has(slug)) return;
  building.add(slug); notify();
  await act(() => api('POST', `/api/games/${encodeURIComponent(slug)}/play`), 'The newest build is opening');
  building.delete(slug); notify();
}
const playButton = (g) => {
  const busy = building.has(g.slug);
  return h('button', { type: 'button', class: 'btn primary play-btn', 'aria-busy': String(busy), onclick: () => play(g.slug) },
    busy ? [h('span', { class: 'spin-ring', 'aria-hidden': 'true' }), 'Getting the newest build ready'] : [ic('play', 14), 'Play the newest build']);
};

function gamesCard() {
  const games = (store.gameList.length ? store.gameList : store.games.map((g) => ({ slug: g.slug, name: g.name }))).filter((g) => inScope({ game: g.slug }));
  return h('section', { class: 'card stack sm' },
    h('h2', { class: 'section-title' }, 'Where each game is'),
    games.length ? games.map((g) => {
      const working = Array.isArray(g.working) ? g.working : store.tasks.filter((t) => t.game === g.slug && t.state === 'working').map((t) => t.role);
      const playable = STAGES.indexOf(g.stage) >= STAGES.indexOf('built');
      return h('div', { class: 'game-row game-card' },
        h('a', { class: 'game-link', href: '#/games/' + g.slug },
          h('div', { class: 'row gap between' }, h('strong', {}, g.name), h('span', { class: 'row gap' },
            g.version != null ? h('span', { class: 'muted small' }, 'v' + g.version) : null)),
          g.stage ? stageDots(g.stage) : null,
          g.nextStep ? h('p', { class: 'muted small' }, 'Now: ' + g.nextStep) : null,
          working.length ? h('div', { class: 'row gap' }, [...new Set(working)].map((id) => avatar(id, 22)), h('span', { class: 'muted small' }, 'working on it: ' + [...new Set(working)].map(roleLabel).join(', ')))
            : h('p', { class: 'muted small' }, "Nobody's working on it right now: ", h('span', { class: 'link', onclick: (e) => { e.preventDefault(); e.stopPropagation(); go('#/lead'); } }, 'ask the Lead'))),
        playable ? playButton(g) : null);
    }) : h('p', { class: 'muted' }, 'No games yet.'));
}

function studioCard() {
  const cur = store.settings.studioLanes ?? 1;
  const opts = [[0, 'Off'], [1, '1'], [2, '2'], ['all', 'All']];
  const locks = studioLocks();
  return h('section', { class: 'card stack sm' },
    h('h2', { class: 'section-title' }, 'Studios for agents'),
    h('div', { class: 'row gap between' },
      h('p', { class: 'muted small' }, 'How many agents may drive Studio at once.'),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Studio lanes' }, opts.map(([v, l]) => h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(String(cur) === String(v)),
        onclick: async () => { store.settings = { ...store.settings, studioLanes: v }; notify(); await act(() => api('POST', '/api/settings', { key: 'studioLanes', value: v })); } }, l)))),
    locks.length ? h('ul', { class: 'plain' }, locks.map((l) => h('li', { class: 'lock-row' }, ic('lock', 13),
      h('span', {}, `${roleLabel(l.role)} · Lane ${l.lane ?? 1}${l.game ? ' · ' + gameName(l.game) : ''} · ${l.since ? ago(l.since) + (ago(l.since) === 'just now' ? '' : ' ago') : ''}`))))
      : h('p', { class: 'muted small' }, 'No agent is using Studio right now.'));
}

function freshnessCard() {
  if (Date.now() - store.freshAt > 60000) loadFreshness();
  const f = store.freshness || {};
  const rows = [['Market charts', f.marketCharts], ['Breakouts', f.breakouts], ['Live numbers', f.liveNumbers], ['Asset library', f.assetLibrary]];
  const games = store.gameList.length ? store.gameList : [];
  for (const g of games) rows.push([`${g.name} version`, f.games?.[g.slug] ?? g.updatedAt]);
  return h('section', { class: 'card stack sm' },
    h('h2', { class: 'section-title' }, 'Data freshness'),
    h('ul', { class: 'plain fresh' }, rows.map(([l, iso]) => h('li', { class: 'row between' }, h('span', {}, l), h('span', { class: 'muted small', title: iso ? fmtTime(iso) : '' }, agoText(iso))))));
}

export function render() {
  const open = [...store.asks.filter((a) => needsDecision(a) && inScope(a)), ...store.tasks.filter((t) => isBackToYou(t) && inScope(t))];
  const working = store.tasks.filter((t) => t.state === 'working' && inScope(t));
  const queued = store.tasks.filter((t) => t.state === 'queued' && inScope(t));
  const g = greeting();
  const paused = !!store.settings.paused;

  const input = h('input', { class: 'input', type: 'text', maxlength: 20000, placeholder: 'Ask the Lead anything, or say what you want done...', 'aria-label': 'Ask the Lead', oninput: (e) => { leadDraft = e.target.value; } });
  input.value = leadDraft;
  const go_ask = h('button', { type: 'submit', class: 'btn primary ask-go', 'data-empty': leadDraft.trim() ? '0' : '1', 'aria-label': 'Ask the Lead' }, h('span', { class: 'ask-label' }, 'Ask'), ic('arrowRight', 14));
  input.addEventListener('input', () => go_ask.setAttribute('data-empty', input.value.trim() ? '0' : '1'));
  const ask = h('form', { class: 'ask-lead', onsubmit: async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (await act(() => api('POST', '/api/messages', { role: 'lead', text, game: scope() || askGame || undefined }), 'Sent to the Lead')) { leadDraft = ''; input.value = ''; }
  } }, avatar('lead', 28), input,
  go_ask,
  h('div', { class: 'ask-tools' },
    multiGame() ? h('label', { class: 'row gap ask-for' }, h('span', { class: 'muted small' }, 'for:'),
      selectEl([{ value: '', label: 'All games' }, ...store.gameList.map((g) => ({ value: g.slug, label: g.name }))], askGame, (v) => { askGame = v; }, 'sm')) : null,
    btn('New task', () => newTaskModal(), { icon: 'plus' }),
    btn(paused ? 'Resume all' : 'Pause all', () => act(() => api('POST', paused ? '/api/resume' : '/api/pause'), paused ? 'Resumed' : 'Paused'), { icon: paused ? 'play' : 'pause' })));

  return h('div', { class: 'page' },
    h('header', { class: 'greet' }, h('h1', {}, g.name ? [g.hello + ', ', h('span', { class: 'grad-text' }, g.name)] : g.hello), h('p', { class: 'greet-date muted' }, g.when)),
    h('div', { class: 'chips' },
      h('a', { class: 'chip', 'data-tone': open.length ? 'need' : null, href: '#/review' }, open.length + ' need you'),
      h('a', { class: 'chip', 'data-tone': working.length ? 'work' : null, href: '#/team' }, working.length + ' working'),
      h('a', { class: 'chip', href: '#/tasks' }, queued.length + ' queued'),
      h('span', { class: 'chip static' }, 'last change ' + agoText(new Date(store.lastChange).toISOString()))),
    ask,
    h('p', { class: 'hint ask-hint' }, store.settings.runMode === 'hourly' ? 'The Lead replies within the hour' : 'The Lead replies in about a minute'),
    h('div', { class: 'home-grid' },
      h('section', { class: 'stack' }, h('h2', { class: 'sec-h' }, 'Needs you', open.length ? h('span', { class: 'count', 'data-tone': 'amber' }, open.length) : null), needsYou()),
      h('aside', { class: 'stack' }, liveNow(), gamesCard(), studioCard(), freshnessCard())));
}
