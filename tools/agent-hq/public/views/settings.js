import { h, store, api, act, btn, pageHead, selectEl, field, notify, toast, LANES, lastSeen, laneFresh, laneCfg, fmtTime } from './core.js';
import { providersCard, agentModelsCard } from './models.js';
import { loadSchema, schemaState, retrySchema, schemaSections } from './settings-fields.js';
import { rolesEditor } from './roles-editor.js';
import { readinessPanel } from './readiness.js';

let draft = null; // schedules being edited
const rid = () => 's_' + Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');

function schedules() {
  if (!draft) draft = structuredClone(store.settings.schedules || []);
  const dirty = JSON.stringify(draft) !== JSON.stringify(store.settings.schedules || []);
  const rows = draft.map((s, i) => h('div', { class: 'sched card' },
    h('div', { class: 'row gap wrap' },
      field('Role', selectEl(store.roles.map((r) => ({ value: r.id, label: r.label })), s.role, (v) => { s.role = v; })),
      field('Every (minutes)', h('input', { class: 'input num-in', type: 'number', min: 5, max: 10080, value: s.everyMinutes, oninput: (e) => { s.everyMinutes = Number(e.target.value); } })),
      h('label', { class: 'check push' }, h('input', { type: 'checkbox', checked: !!s.enabled, onchange: (e) => { s.enabled = e.target.checked; } }), h('span', {}, 'Enabled')),
      btn('Remove', () => { draft.splice(i, 1); notify(); }, { kind: 'ghost', icon: 'trash' })),
    field('Title', h('input', { class: 'input', type: 'text', maxlength: 200, value: s.title, oninput: (e) => { s.title = e.target.value; } })),
    field('Brief', (() => { const t = h('textarea', { class: 'textarea', rows: 3, maxlength: 20000, oninput: (e) => { s.body = e.target.value; } }); t.value = s.body || ''; return t; })()),
    s.lastRunAt ? h('p', { class: 'hint' }, 'Last run ' + new Date(s.lastRunAt).toLocaleString()) : null));
  return h('section', { class: 'card stack' },
    h('h2', { class: 'section-title' }, 'Schedules'),
    h('p', { class: 'muted' }, 'Run roles on a schedule or on events, not all day. Always-on agents burn your plan usage.'),
    rows.length ? rows : h('p', { class: 'muted' }, 'No schedules'),
    h('div', { class: 'row gap' },
      btn('Add schedule', () => { draft.push({ id: rid(), role: store.roles[0]?.id || 'lead', title: '', body: '', everyMinutes: 1440, enabled: false, lastRunAt: null }); notify(); }, { icon: 'plus' }),
      btn('Save schedules', async () => {
        if (draft.some((s) => !s.title.trim() || !(s.everyMinutes >= 5))) { toast('Each schedule needs a title and at least 5 minutes', 'error'); return; }
        if (await act(() => api('POST', '/api/settings', { key: 'schedules', value: draft }), 'Schedules saved')) {
          store.settings = { ...store.settings, schedules: structuredClone(draft) };
          notify();
        }
      }, { kind: 'primary', disabled: !dirty }),
      dirty ? btn('Discard', () => { draft = null; notify(); }, { kind: 'ghost' }) : null));
}

// ---- lanes: cadence controls bound to settings.laneSchedules[engine] ----
const EVERY = {
  app: [60, 120, 180, 240, 360, 480, 720, 1440],
  antigravity: [5, 10, 20, 40, 60, 120, 240, 1440],
};
const everyLabel = (m) => (m % 60 === 0 && m >= 60 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`);
const laneDrafts = {};
const pick = (c) => ({ enabled: !!c.enabled, everyMinutes: Number(c.everyMinutes), activeFrom: c.activeFrom, activeTo: c.activeTo, maxTasks: Number(c.maxTasks) });

function nextEligible(id) {
  const cfg = laneCfg(id);
  if (!cfg.enabled) return 'paused in HQ';
  const last = store.lanes?.[id]?.lastRunAt;
  if (!last) return 'on next fire';
  const t = new Date(last).getTime() + cfg.everyMinutes * 60000;
  return t <= Date.now() ? 'on next fire' : fmtTime(new Date(t).toISOString());
}

function laneControls(l) {
  const saved = pick(laneCfg(l.id));
  const d = (laneDrafts[l.id] ||= { ...saved });
  const dirty = JSON.stringify(pick(d)) !== JSON.stringify(saved);
  const opts = [...new Set([...EVERY[l.id], d.everyMinutes])].sort((x, y) => x - y).map((m) => ({ value: String(m), label: everyLabel(m) }));
  const allDay = d.activeFrom === '00:00' && d.activeTo === '24:00';
  const time = (key) => h('input', { class: 'input', type: 'time', value: d[key] === '24:00' ? '00:00' : d[key], 'aria-label': key === 'activeFrom' ? 'Active from' : 'Active until',
    onchange: (e) => { d[key] = e.target.value || d[key]; notify(); } });
  const lastRun = store.lanes?.[l.id]?.lastRunAt;
  return h('div', { class: 'lane-card stack sm' },
    h('div', { class: 'row gap between' },
      h('div', {}, h('strong', {}, l.name), h('p', { class: 'hint' }, 'Last seen ' + lastSeen(l.id))),
      h('div', { class: 'row gap' }, h('span', { class: 'muted small' }, d.enabled ? 'Enabled' : 'Paused'),
        h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(!!d.enabled), 'aria-label': l.name + ' enabled',
          onclick: () => { d.enabled = !d.enabled; notify(); } }, h('span', { class: 'knob' })))),
    h('p', { class: 'hint' }, l.how),
    h('div', { class: 'lane-grid' },
      field('Work every', selectEl(opts, String(d.everyMinutes), (v) => { d.everyMinutes = Number(v); notify(); })),
      field('Max tasks per run', h('input', { class: 'input', type: 'number', min: 1, max: 20, step: 1, value: d.maxTasks, oninput: (e) => { d.maxTasks = Number(e.target.value); } }))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: allDay, onchange: (e) => {
      if (e.target.checked) { d.activeFrom = '00:00'; d.activeTo = '24:00'; } else { d.activeFrom = '08:00'; d.activeTo = '22:00'; }
      notify();
    } }), h('span', {}, 'Active all day')),
    allDay ? null : h('div', { class: 'lane-grid' }, field('Active from', time('activeFrom')), field('Until', time('activeTo'), 'Overnight windows allowed, for example 22:00 to 06:00. Server local time.')),
    h('dl', { class: 'meta' },
      h('dt', {}, 'Last run'), h('dd', {}, lastRun ? fmtTime(lastRun) : 'never'),
      h('dt', {}, 'Next eligible'), h('dd', {}, nextEligible(l.id))),
    h('div', { class: 'row gap' },
      btn('Save', async () => {
        const n = pick(d);
        if (!Number.isInteger(n.maxTasks) || n.maxTasks < 1 || n.maxTasks > 20) { toast('Max tasks must be 1 to 20', 'error'); return; }
        const value = {};
        for (const x of LANES) value[x.id] = x.id === l.id ? n : pick(laneCfg(x.id));
        if (await act(() => api('POST', '/api/settings', { key: 'laneSchedules', value }), l.name + ' saved')) {
          store.settings = { ...store.settings, laneSchedules: value };
          laneDrafts[l.id] = null;
          notify();
        }
      }, { kind: 'primary', disabled: !dirty }),
      dirty ? btn('Discard', () => { laneDrafts[l.id] = null; notify(); }, { kind: 'ghost' }) : null));
}

function lanesCard() {
  return h('section', { class: 'card stack' },
    h('h2', { class: 'section-title' }, 'Lanes'),
    h('p', { class: 'muted' }, 'Work waits in the queue until a worker in one of these apps picks it up.'),
    LANES.map(laneControls),
    h('p', { class: 'hint' }, 'The Claude app checks in every hour and Antigravity every 5 minutes (re-run register-antigravity.mjs with --every N to match a different cadence); HQ decides from these settings whether they work.'));
}

// Where the worker lanes were seen last; moved here from Home.
function lanesStrip() {
  return h('div', { class: 'lanes-strip', 'aria-label': 'Worker lanes' }, LANES.map((l) => h('span', { class: 'lane-pill', title: l.how },
    h('span', { class: 'dot', 'data-on': laneCfg(l.id).enabled !== false && laneFresh(l.id) ? 'working' : 'idle' }), l.name,
    h('span', { class: 'muted' }, laneCfg(l.id).enabled === false ? 'paused' : 'last seen ' + lastSeen(l.id)))));
}

// Keys this page draws itself in Run control, so the schema loop skips them.
const SKIP = new Set(['budget', 'paused', 'runMode']);

function runControl() {
  const budget = store.settings.budget ?? 2;
  const paused = !!store.settings.paused;
  const runMode = store.settings.runMode === 'hourly' ? 'hourly' : 'instant';
  return h('section', { class: 'card stack sm' },
    h('h2', { class: 'section-title' }, 'Run control'),
    h('div', { class: 'row gap between' },
      h('div', {}, h('strong', {}, 'Run mode'), h('p', { class: 'muted' }, runMode === 'hourly' ? 'Hourly: agents wait for the Claude app worker.' : 'Instant: agents start on this PC within seconds.')),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Run mode' }, [['instant', 'Instant'], ['hourly', 'Hourly']].map(([v, l]) => h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(v === runMode),
        onclick: async () => { store.settings = { ...store.settings, runMode: v }; notify(); await act(() => api('POST', '/api/settings', { key: 'runMode', value: v })); } }, l)))),
    h('div', { class: 'row gap between' },
      h('div', {}, h('strong', {}, 'Parallel agents'), h('p', { class: 'muted' }, 'How many tasks may run at the same time.')),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Parallel agents' }, [1, 2, 3, 4].map((n) => h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(n === budget),
        onclick: async () => { store.settings = { ...store.settings, budget: n }; notify(); await act(() => api('POST', '/api/settings', { key: 'budget', value: n })); } }, String(n))))),
    h('div', { class: 'row gap between' },
      h('div', {}, h('strong', {}, paused ? 'Paused' : 'Running'), h('p', { class: 'muted' }, paused ? 'Nothing new will start.' : 'Queued tasks start automatically.')),
      btn(paused ? 'Resume' : 'Pause', () => act(() => api('POST', paused ? '/api/resume' : '/api/pause')), { icon: paused ? 'play' : 'pause', kind: paused ? 'primary' : '' })));
}

// Only shown when the schema could not be read.
function youCard() {
  return h('section', { class: 'card stack sm' },
    h('h2', { class: 'section-title' }, 'You'),
    field('Your name', h('input', { class: 'input', type: 'text', maxlength: 40, value: store.settings.ownerName || '', placeholder: 'Shown in the greeting on Home', 'aria-label': 'Your name',
      onchange: async (e) => {
        const v = e.target.value.trim().slice(0, 40);
        if (await act(() => api('POST', '/api/settings', { key: 'ownerName', value: v }), 'Saved')) { store.settings = { ...store.settings, ownerName: v }; notify(); }
      } })));
}

// Roles that cannot change game files; only these can run on a partner's request without your OK (the server enforces it too).
const PARTNER_OK = ['scout', 'designer', 'reviewer', 'kid-tester', 'playtester', 'liveops'];
function partnerCard() {
  const cur = { enabled: true, autoRoles: ['scout', 'designer'], dailyLimit: 5, ...(store.settings.partnerAccess || {}) };
  const save = async (patch) => {
    const value = { ...cur, ...patch };
    if (await act(() => api('POST', '/api/settings', { key: 'partnerAccess', value }), 'Saved')) { store.settings = { ...store.settings, partnerAccess: value }; notify(); }
  };
  return h('section', { class: 'card stack sm' },
    h('h2', { class: 'section-title' }, 'Partner agents'),
    h('p', { class: 'muted' }, "Let Ditto use these agents without asking you each time. Other roles, and anything over the daily limit, still wait for your OK."),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: cur.enabled, onchange: (e) => save({ enabled: e.target.checked }) }), h('span', {}, 'Allow partner requests to run right away')),
    h('div', { class: 'row gap wrap', role: 'group', 'aria-label': 'Roles that run right away' }, store.roles.filter((r) => PARTNER_OK.includes(r.id)).map((r) =>
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: cur.autoRoles.includes(r.id),
        onchange: (e) => save({ autoRoles: e.target.checked ? [...cur.autoRoles, r.id] : cur.autoRoles.filter((x) => x !== r.id) }) }), h('span', {}, r.label)))),
    field('Tasks per day', h('input', { class: 'input num-in', type: 'number', min: 0, max: 50, value: cur.dailyLimit, 'aria-label': 'Partner tasks per day', onchange: (e) => save({ dailyLimit: Math.max(0, Math.min(50, Math.round(Number(e.target.value) || 0))) }) })));
}

export function render() {
  loadSchema();
  const { schema, error } = schemaState();
  const widgets = { providers: providersCard, roleEngines: agentModelsCard, laneSchedules: lanesCard, schedules, partnerAccess: partnerCard };
  let body;
  if (schema) {
    const { nodes, shown } = schemaSections(widgets, SKIP);
    body = [...nodes, Object.entries(widgets).filter(([k]) => !shown.has(k)).map(([, f]) => f())]; // a custom widget the schema forgot still shows
  } else {
    body = [error ? h('section', { class: 'card stack sm', role: 'alert' }, h('p', { class: 'pg-warn' }, 'Could not read the settings list: ' + error), btn('Try again', retrySchema, { icon: 'refresh' })) : null,
      youCard(), Object.values(widgets).map((f) => f())];
  }
  return h('div', { class: 'page' },
    pageHead('Settings', 'Control which models your agents use, how many run at once, and when.'),
    lanesStrip(),
    h('div', { class: 'stack' }, runControl(), body, rolesEditor(), readinessPanel()));
}
