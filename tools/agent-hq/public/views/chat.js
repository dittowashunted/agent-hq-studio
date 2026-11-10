// One conversation with one role: header, message list, typing row, composer.
// chatView() returns {node, update}; the owner view calls update() on every store change,
// so the composer is never rebuilt while you type.
import { h, store, api, act, ic, btn, empty, loadMessages, reloadMessages, markRead, avatar, roleById, roleLabel, roleStatus,
  engineOf, engineLabel, ago, fmtTime, statePill, openDrawer, upsert, notify, plain, imageFiles, mediaUrl, toast, gameName, gameChip, scope } from './core.js';
import { markdown } from './library.js';
import { openTaskDrawer, newTaskModal } from './tasks.js';
import { askCard, askUi } from './review.js';
import { attachments } from './taskform.js';
import { popMenu } from './menu.js';

const drafts = {};
// A glyph the shared icon set does not have: a microphone.
const raw = (path) => h('span', { class: 'ic', html: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>` });
const micIcon = () => raw('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.500V21"/>');
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
const draftAttach = {};
const STATUS_LABEL = { working: 'Working', queued: 'Queued', review: 'In review', idle: 'Idle' };

const logCache = new Map(); // task id + state -> promise of formatted steps, fetched once per state
const workedOpen = new Set(); // task ids whose step list is open, kept across repaints

/** One step per tool call in a stream-json log line; plain text lines count as a step too. */
function steps(lines) {
  const out = [];
  for (const raw of lines || []) {
    let o = raw;
    if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { out.push(raw); continue; } }
    if (!o || typeof o !== 'object') continue;
    if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
      for (const c of o.message.content) if (c.type === 'tool_use') out.push(c.name + ' ' + JSON.stringify(c.input || {}).slice(0, 120));
    } else if (typeof o.text === 'string' && o.type !== 'user' && o.type !== 'system') out.push(o.text);
  }
  return out;
}

function taskChip(t) {
  const gate = t.createdBy === 'gate' || t.gateFor;
  const label = h('span', { class: 'grow clip' }, 'Worked through the task');
  const body = h('div', { class: 'worked-body', hidden: true });
  const toggle = h('button', { type: 'button', class: 'worked-head', 'aria-expanded': 'false', title: plain(t.title) },
    ic('check', 14), label, scope() ? null : gameChip(t.game), ic('chevron', 14));
  const paint = (list) => {
    if (list.length) label.textContent = `${t.state === 'working' ? 'Working' : 'Worked'} through ${list.length} step${list.length === 1 ? '' : 's'}`;
    body.replaceChildren(...(list.length ? list.slice(0, 40).map((x) => h('div', { class: 'worked-step' }, x)) : [h('div', { class: 'muted small' }, 'No steps recorded yet')]),
      list.length > 40 ? h('div', { class: 'muted small' }, `${list.length - 40} more steps in the task log`) : null,
      h('button', { type: 'button', class: 'worked-open', onclick: () => openTaskDrawer(t.id) }, 'Open task'));
  };
  const load = () => {
    const key = t.id + ':' + t.state;
    if (!logCache.has(key)) {
      if (!body.hidden) body.replaceChildren(h('div', { class: 'muted small' }, 'Loading'));
      const p = api('GET', `/api/tasks/${encodeURIComponent(t.id)}/log`).then((r) => steps(r.lines));
      p.catch(() => logCache.delete(key));
      logCache.set(key, p);
    }
    logCache.get(key).then(paint, (e) => body.replaceChildren(h('div', { class: 'muted small' }, e.message)));
  };
  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
    if (open) { workedOpen.add(t.id); load(); } else workedOpen.delete(t.id);
  };
  load(); // the step count is the label, so it is fetched up front; the list stays closed until opened
  if (workedOpen.has(t.id)) setOpen(true);
  toggle.onclick = () => setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  return h('div', { class: 'worked', 'data-state': t.state },
    toggle, body,
    t.state === 'done' && !gate && !(t.attempt > 1) ? null : h('div', { class: 'worked-foot' }, statePill(t.state),
      gate ? h('span', { class: 'chip-btn static' }, 'gate') : null,
      t.attempt > 1 ? h('span', { class: 'chip-btn static' }, 'attempt ' + t.attempt) : null,
      h('span', { class: 'muted nowrap small' }, ago(t.endedAt || t.startedAt || t.createdAt)),
      h('button', { type: 'button', class: 'worked-open', onclick: () => openTaskDrawer(t.id) }, 'Open task')));
}

// Lessons the agent wrote for itself, plus what the owner told this role (corrections and preferences HQ saved from verdicts).
function openLessons(role) {
  const body = h('div', { class: 'stack' }, empty('Loading'));
  openDrawer(roleLabel(role) + ' lessons', body);
  let lessons = [];
  let corrections = [];
  const prefs = { [role]: [], studio: [] };
  const prefPath = (scope) => '/api/memory/' + encodeURIComponent(scope) + '/preferences';
  const prefRow = (scope, p) => h('li', { class: 'lesson' },
    h('span', { class: 'chip' }, p.date), scope === 'studio' ? h('span', { class: 'chip static' }, 'Every agent') : null, h('span', { class: 'grow' }, p.text),
    btn('Remove', async () => {
      const r = await act(() => api('DELETE', prefPath(scope) + '/' + encodeURIComponent(p.id)), 'Removed');
      if (r && r !== true && Array.isArray(r.preferences)) { prefs[scope] = r.preferences; paint(); }
    }, { kind: 'ghost sm', icon: 'trash', title: 'Remove this preference' }));
  const addPref = (scope, input) => async () => {
    const text = input.value.trim();
    if (!text) return;
    const r = await act(() => api('POST', prefPath(scope), { text }), 'Saved');
    if (r && r !== true && Array.isArray(r.preferences)) { prefs[scope] = r.preferences; input.value = ''; paint(); }
  };
  const paint = () => {
    const mine = [...corrections].reverse(); // the API lists oldest first
    const input = h('input', { class: 'pg-input grow', maxlength: 200, placeholder: 'A rule to keep, for example: always say studs, never pixels', 'aria-label': 'New standing preference' });
    const all = [...prefs.studio.map((p) => ['studio', p]), ...prefs[role].map((p) => [role, p])];
    body.replaceChildren(
      h('section', { class: 'stack sm', 'aria-label': 'Standing preferences' },
        h('h4', {}, 'Standing preferences'),
        h('p', { class: 'muted' }, 'Rules you set for good. Every new brief includes them, with your authority. Agents can propose rules, but only you save them.'),
        all.length ? h('ul', { class: 'plain lessons' }, all.map(([scope, p]) => prefRow(scope, p))) : h('p', { class: 'muted' }, 'None yet.'),
        h('div', { class: 'row' }, input, btn('Add for this agent', addPref(role, input), { kind: 'ghost sm' }), btn('Add for every agent', addPref('studio', input), { kind: 'ghost sm' }))),
      h('section', { class: 'stack sm', 'aria-label': 'Your corrections' },
        h('h4', {}, 'Your corrections'),
        h('p', { class: 'muted' }, 'What you told this agent when you sent work back or approved it with a note. Every new brief for this role includes them. Remove one that no longer applies.'),
        mine.length ? h('ul', { class: 'plain lessons' }, mine.map((c) => h('li', { class: 'lesson' },
          h('span', { class: 'chip' }, c.date), h('span', { class: 'chip static' }, c.kind === 'preference' ? 'Preference' : 'Correction'),
          c.game && c.game !== 'any' ? h('span', { class: 'chip static' }, gameName(c.game)) : null,
          h('span', { class: 'grow' }, c.text),
          btn('Remove', async () => {
            const r = await act(() => api('DELETE', `/api/memory/${encodeURIComponent(role)}/corrections/${encodeURIComponent(c.id)}`), 'Removed');
            if (r && r !== true && Array.isArray(r.corrections)) { corrections = r.corrections; paint(); }
          }, { kind: 'ghost sm', icon: 'trash', title: 'Remove this correction' }))))
          : h('p', { class: 'muted' }, 'None yet. When you send work back with a note, it is kept here.')),
      h('section', { class: 'stack sm', 'aria-label': 'Lessons' },
        h('h4', {}, 'Lessons'),
        h('p', { class: 'muted' }, 'Short notes this agent recorded after earlier tasks. Every new brief for this role includes the newest ones.'),
        lessons.length ? h('ul', { class: 'plain lessons' }, [...lessons].reverse().map((l) => h('li', { class: 'lesson' }, h('span', { class: 'chip' }, l.date), h('span', {}, l.text))))
          : empty('No lessons yet. Agents add them with hq_learn.')));
  };
  Promise.all([api('GET', '/api/memory/' + encodeURIComponent(role)), api('GET', prefPath(role)), api('GET', prefPath('studio'))])
    .then(([r, mine, studio]) => { lessons = r.lessons || []; corrections = r.corrections || []; prefs[role] = mine.preferences || []; prefs.studio = studio.preferences || []; paint(); })
    .catch((e) => body.replaceChildren(empty(e.message)));
}

// "More" popover in the chat header: the engine in use, the running task, and the less common actions.
function moreMenu(role, st, e, actions) {
  return popMenu({
    label: 'More for ' + roleLabel(role),
    note: h('div', { class: 'menu-note', role: 'presentation' }, ic('cpu', 13), engineLabel(e.engine) + (e.model ? ' / ' + e.model : '')),
    items: [
      st.task ? { text: 'Running: ' + plain(st.task.title), icon: 'clock', run: () => openTaskDrawer(st.task.id) } : null,
      { text: 'New task', icon: 'plus', run: actions.newTask }, { text: 'Lessons', icon: 'library', run: actions.lessons }, { text: 'Past chats', icon: 'clock', run: actions.past },
    ],
  });
}

export function chatView(role, { back = false } = {}) {
  const r = roleById(role);
  const label = roleLabel(role);
  const hint = role === 'lead' ? 'Ask anything, or tell the Lead what you want done...' : `Message ${label}...`;
  const head = h('header', { class: 'chat-head' });
  const list = h('div', { class: 'chat-list', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation with ' + label });
  const typing = h('div', { class: 'typing-slot' });
  let arch = null; // a past chat being read: {id, label, messages}
  let headSig = ''; let listSig = ''; let typingSig = ''; let first = true; let stick = true;

  const attach = (draftAttach[role] ||= []);
  const chips = attachments(attach, () => syncSend());
  const input = h('textarea', { class: 'textarea composer-input', rows: 1, maxlength: 20000, placeholder: hint, 'aria-label': 'Message ' + label,
    oninput: (e) => { drafts[role] = e.target.value; grow(); syncSend(); },
    onpaste: (e) => { const f = imageFiles(e.clipboardData); if (f.length) { e.preventDefault(); chips.add(f); } },
    onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } } });
  input.value = drafts[role] || '';
  const picker = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, hidden: true, 'aria-hidden': 'true',
    onchange: (e) => { const f = [...e.target.files]; if (f.length) chips.add(f); e.target.value = ''; } });
  // Dictation: the browser's own speech service hears the audio and hands back text; HQ stores and sends only the text.
  // ponytail: one phrase at a time (not continuous), appended to the draft; add live interim text or a language picker if people ask.
  let rec = null;
  function dictate() {
    if (rec) { rec.stop(); return; }
    rec = new Speech();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = false;
    const base = input.value;
    rec.onresult = (ev) => {
      const said = [...ev.results].map((r) => r[0].transcript).join(' ').trim();
      if (said) { input.value = (base && !/\s$/.test(base) ? base + ' ' : base) + said; drafts[role] = input.value; grow(); syncSend(); }
    };
    rec.onerror = (ev) => { if (ev.error !== 'aborted' && ev.error !== 'no-speech') toast('Dictation stopped: ' + ev.error, 'error'); };
    rec.onend = () => { rec = null; micBtn.setAttribute('aria-pressed', 'false'); input.focus(); };
    try { rec.start(); micBtn.setAttribute('aria-pressed', 'true'); } catch { rec = null; }
  }
  const micBtn = Speech ? h('button', { type: 'button', class: 'composer-mic', title: 'Dictate a message', 'aria-label': 'Dictate a message', 'aria-pressed': 'false', onclick: dictate }, micIcon()) : null;
  const dropOn = (el) => {
    el.addEventListener('dragover', (e) => e.preventDefault());
    el.addEventListener('drop', (e) => { const f = imageFiles(e.dataTransfer); if (f.length) { e.preventDefault(); chips.add(f); } });
  };
  dropOn(input);
  // Send looks muted until there is text or a screenshot. It stays focusable and keeps its label.
  function syncSend() { sendBtn.setAttribute('aria-disabled', String(!(input.value.trim() || attach.length))); }
  function grow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; }

  async function send() {
    const text = input.value.trim();
    if (!text && !attach.length) { input.focus(); return; }
    const body = { role, text: text || 'See the attached screenshot.' };
    if (role === 'lead' && scope()) body.game = scope();
    if (attach.length) body.attachPaths = [...attach];
    const m = await act(() => api('POST', '/api/messages', body));
    if (!m) return;
    input.value = ''; drafts[role] = ''; attach.length = 0; chips.paint(); grow(); syncSend();
    if (m !== true && store.messages[role] && !store.messages[role].some((x) => x.id === m.id)) store.messages[role].push(m);
    stick = true;
    notify();
  }

  async function openPast() {
    const body = h('div', { class: 'stack' }, empty('Loading'));
    const close = openDrawer(label + ': past chats', body);
    try {
      const r = await api('GET', `/api/threads/${encodeURIComponent(role)}/archives`);
      const list2 = Array.isArray(r) ? r : r.archives || [];
      body.replaceChildren(list2.length ? h('div', { class: 'tlist' }, list2.map((a) => {
        const span = fmtTime(a.startedAt) + (a.endedAt ? ' to ' + fmtTime(a.endedAt) : '');
        return h('button', { type: 'button', class: 'trow', onclick: async () => {
          try {
            const m = await api('GET', `/api/messages?role=${encodeURIComponent(role)}&archive=${encodeURIComponent(a.id)}`);
            arch = { id: a.id, label: span, messages: Array.isArray(m) ? m : m.messages || [] };
            close(); listSig = ''; headSig = ''; update();
          } catch (e) { toast(e.message, 'error'); }
        } },
        h('span', { class: 'trow-main' }, h('span', { class: 'trow-title' }, plain(a.preview || 'Conversation')), h('span', { class: 'trow-meta muted' }, span + ' · ' + a.count + ' message' + (a.count === 1 ? '' : 's'))));
      })) : empty('No past chats yet. Start fresh archives the current conversation here.'));
    } catch (e) { body.replaceChildren(empty(e.message)); }
  }

  function paintHead() {
    const st = roleStatus(role);
    const e = engineOf(role);
    const msgs = store.messages[role] || [];
    const lastAt = [...msgs].reverse().find((x) => x.from !== 'system')?.createdAt || store.threads[role]?.last?.createdAt || '';
    const sig = JSON.stringify([st.state, st.task?.id, st.task?.title, st.queued, e.engine, e.model, arch?.id || '', lastAt ? ago(lastAt) : '']);
    if (sig === headSig) return;
    headSig = sig;
    head.replaceChildren(...[
      back ? h('a', { class: 'icon-btn back-btn', href: '#/team', 'aria-label': 'Back to the team list' }, ic('back', 18)) : null,
      avatar(role, 42),
      h('div', { class: 'chat-id' },
        h('h1', {}, label),
        h('div', { class: 'row gap muted chat-state' }, h('span', { class: 'dot', 'data-on': st.state }), STATUS_LABEL[st.state], lastAt ? h('span', { class: 'faint' }, ago(lastAt) + (ago(lastAt) === 'just now' ? '' : ' ago')) : null)),
      h('div', { class: 'chat-actions' },
        btn('Start fresh', async () => {
          if (await act(() => api('POST', `/api/messages/${encodeURIComponent(role)}/reset`, {}), 'Fresh conversation')) { await reloadMessages(role).catch(() => {}); stick = true; }
        }, { kind: 'ghost', icon: 'archive', title: 'Archives this conversation. It stays under Past chats.' }),
        moreMenu(role, st, e, { newTask: () => newTaskModal(role), lessons: () => openLessons(role), past: () => openPast() }))].filter(Boolean));
  }

  function paintList() {
    if (arch) { paintArchive(); return; }
    const msgs = store.messages[role];
    if (!msgs) { if (listSig !== 'loading') { listSig = 'loading'; list.replaceChildren(empty('Loading')); } return; }
    const byMsg = new Map();
    for (const t of store.tasks) if (t.role === role && t.threadMessageId) (byMsg.get(t.threadMessageId) || byMsg.set(t.threadMessageId, []).get(t.threadMessageId)).push(t);
    const taskIds = new Map(store.tasks.map((t) => [t.id, t]));
    const asks = store.asks.filter((a) => a.state === 'open' && a.role === role && !a.superseded);
    const used = new Set();
    const rows = [];
    for (const m of msgs) {
      const cards = [...(byMsg.get(m.id) || [])];
      if (m.taskId && taskIds.has(m.taskId) && !cards.some((t) => t.id === m.taskId)) cards.push(taskIds.get(m.taskId));
      const fresh = cards.filter((t) => !used.has(t.id));
      fresh.forEach((t) => used.add(t.id));
      rows.push({ m, cards: fresh });
    }
    const sig = JSON.stringify([msgs.length, msgs[msgs.length - 1]?.id, rows.map((x) => x.cards.map((t) => [t.id, t.state, t.attempt, t.title])), asks.map((a) => a.id), askUi.v]);
    if (sig === listSig) return;
    listSig = sig;
    const near = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    const out = rows.map(({ m, cards }) => msgNode(m, cards));
    if (!out.length) out.push(empty(`No messages yet. Say what you need and ${label} picks it up in turn.`));
    for (const a of asks) out.push(h('div', { class: 'msg agent' }, avatar(role, 28), h('div', { class: 'msg-col wide' }, askCard(a))));
    list.replaceChildren(...out);
    if (first || stick || near) { list.scrollTop = list.scrollHeight; first = false; stick = false; }
  }

  function msgNode(m, cards) {
      if (m.from === 'system') return h('div', { class: 'divider' }, h('span', {}, m.text));
      const mine = m.from === 'owner';
      return h('div', { class: 'msg ' + (mine ? 'owner' : 'agent') },
        h('div', { class: 'msg-col' },
          mine ? null : cards.map(taskChip),
          h('div', { class: 'bubble', title: fmtTime(m.createdAt) }, mine && cards.length ? h('div', { class: 'task-from' }, ic('check', 12), `Task from ${String(store.settings.ownerName || '').trim() || 'You'}: ${plain(cards[0].title)}`) : null, mine ? h('div', { class: 'pre' }, m.text) : markdown(m.text),
            Array.isArray(m.attachPaths) && m.attachPaths.length ? h('div', { class: 'attach-grid' }, m.attachPaths.map((p) => h('a', { href: mediaUrl(p), target: '_blank', rel: 'noopener' }, h('img', { class: 'md-img', src: mediaUrl(p), alt: 'Attached screenshot', loading: 'lazy' })))) : null),
          mine ? cards.map(taskChip) : null,
          h('div', { class: 'msg-meta muted' }, (mine ? 'You' : label) + ' · ' + ago(m.createdAt) + (ago(m.createdAt) === 'just now' ? '' : ' ago'))));
  }

  function paintArchive() {
    const sig = 'arch:' + arch.id + ':' + arch.messages.length;
    if (sig === listSig) return;
    listSig = sig;
    list.replaceChildren(h('div', { class: 'arch-banner' }, h('span', {}, 'Past chat: ' + arch.label), btn('Back to the current chat', () => { arch = null; listSig = ''; headSig = ''; stick = true; update(); }, { kind: 'sm primary', icon: 'back' })),
      ...(arch.messages.length ? arch.messages.map((m) => msgNode(m, [])) : [empty('This past chat is empty')]));
    list.scrollTop = 0;
  }

  // The Lead shows its step count while it works (read from the task log every few seconds), not only when it ends.
  let stepTimer = null;
  const stepText = (n) => (n ? `Working: ${n} step${n === 1 ? '' : 's'} so far` : 'Working · a new message waits its turn');
  function followSteps(task) {
    clearInterval(stepTimer); stepTimer = null;
    if (!task || role !== 'lead') return;
    const poll = () => {
      if (!node.isConnected || roleStatus(role).task?.id !== task.id) { clearInterval(stepTimer); stepTimer = null; return; }
      api('GET', `/api/tasks/${encodeURIComponent(task.id)}/log`).then((r) => { const el = typing.querySelector('.typing-text'); if (el) el.textContent = stepText(steps(r.lines).length); }, () => {});
    };
    stepTimer = setInterval(poll, 4000); poll();
  }

  function paintTyping() {
    const st = roleStatus(role);
    stopBtn.hidden = !st.task;
    const sig = st.task ? st.task.id : '';
    if (sig === typingSig) return;
    typingSig = sig;
    typing.replaceChildren(st.task ? h('div', { class: 'typing', role: 'status' },
      h('span', { class: 'dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
      h('span', { class: 'typing-text' }, stepText(0))) : '');
    followSteps(st.task);
    if (st.task) list.scrollTop = list.scrollHeight;
  }

  function update() {
    paintHead(); paintList(); paintTyping();
    input.disabled = !!arch; input.placeholder = arch ? 'Go back to the current chat to write' : hint;
    if (node.isConnected && store.threads[role]?.unread > 0 && document.visibilityState === 'visible') markRead(role);
  }

  const stopBtn = h('button', { type: 'button', class: 'composer-stop', hidden: true, 'aria-label': 'Stop the running task', title: 'Stop the running task',
    onclick: () => { const t = roleStatus(role).task; if (t && confirm('Stop the running task?')) act(() => api('POST', `/api/tasks/${t.id}/cancel`), 'Stopped'); } }, h('span', { class: 'stop-sq', 'aria-hidden': 'true' }));
  const sendBtn = h('button', { type: 'button', class: 'composer-send', onclick: send, 'aria-label': 'Send', 'aria-disabled': 'true' }, ic('arrowUp', 18));
  const node = h('section', { class: 'chat', 'aria-label': 'Conversation with ' + label }, head, list, typing,
    h('div', { class: 'composer-wrap' }, chips.node,
      h('div', { class: 'composer' }, picker, input,
        h('div', { class: 'composer-bar' },
          h('button', { type: 'button', class: 'composer-clip', title: 'Add screenshots (or paste / drop them)', 'aria-label': 'Add screenshots (or paste / drop them)', onclick: () => picker.click() }, ic('clip', 18)),
          micBtn,
          h('span', { class: 'composer-hint' }, 'Enter to send · Shift+Enter for a new line · Ctrl+V pastes screenshots'),
          stopBtn,
          sendBtn))));
  if (!store.messages[role]) loadMessages(role);
  syncSend();
  update();
  setTimeout(() => { markRead(role); grow(); }, 0);
  return { node, update };
}
