// Settings: model provider keys (Groq, NVIDIA NIM) and the engine and model each agent runs on.
import { h, store, api, act, btn, field, selectEl, notify, toast, roleLabel, avatar, fmtTime } from './core.js';

let catalog = null; // GET /api/models: {claude, groq, nim} -> {models, recommended, fetchedAt, error, configured}
let loading = false;
let lastTry = 0;
async function loadCatalog(force) {
  // render calls this every time: never retry a failed load more than every 30 s, or a failure would loop
  if (loading || (!force && (catalog || Date.now() - lastTry < 30000))) return;
  lastTry = Date.now();
  loading = true;
  try { catalog = await api(force ? 'POST' : 'GET', force ? '/api/models/refresh' : '/api/models'); } catch (e) { toast(e.message, 'error'); }
  loading = false;
  notify();
}

const PROVIDERS = [
  { id: 'groq', label: 'Groq', hint: 'Starts with gsk_. Free tier: about 30 requests and 8K tokens a minute per model, so keep it for short, read-heavy roles.', where: 'console.groq.com, API Keys' },
  { id: 'nim', label: 'NVIDIA NIM', hint: 'Starts with nvapi-. About 40 requests a minute. Some listed models are no longer served: press Test before you rely on one.', where: 'build.nvidia.com, Get API Key' },
];
const keyDrafts = {};

function providerRow(p) {
  const on = !!store.settings.providers?.[p.id]?.configured;
  const cat = catalog?.[p.id];
  const input = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: on ? 'Saved. Paste a new key to replace it.' : 'Paste your API key', value: keyDrafts[p.id] || '',
    'aria-label': p.label + ' API key', oninput: (e) => { keyDrafts[p.id] = e.target.value; } });
  const save = async (apiKey) => {
    const r = await act(() => api('POST', '/api/settings', { key: 'providers', value: { id: p.id, apiKey } }), apiKey ? p.label + ' key saved' : p.label + ' key removed');
    if (r) { keyDrafts[p.id] = ''; store.settings = { ...store.settings, providers: r.value }; if (catalog && r.models) catalog = { ...catalog, [p.id]: { ...r.models, configured: !!apiKey } }; notify(); }
  };
  return h('div', { class: 'lane-card stack sm' },
    h('div', { class: 'row gap between' },
      h('div', {}, h('strong', {}, p.label), h('p', { class: 'hint' }, 'Get a key at ' + p.where)),
      h('span', { class: 'spill', 'data-tone': on ? 'green' : 'grey' }, on ? 'Connected' : 'Not set')),
    h('div', { class: 'row gap' }, input,
      btn('Save', () => { const k = (keyDrafts[p.id] || '').trim(); if (k.length < 20) { toast('That key looks too short', 'error'); return; } save(k); }, { kind: 'primary' }),
      on ? btn('Remove', () => save(null), { kind: 'ghost', icon: 'trash' }) : null),
    h('p', { class: 'hint' }, p.hint),
    h('p', { class: 'hint' }, cat ? (cat.error ? cat.error : `${cat.models.length} models listed${cat.fetchedAt ? ', updated ' + fmtTime(cat.fetchedAt) : ''}. Recommended: ${cat.recommended || 'none'}.`) : 'Reading the model list...'));
}

export function providersCard() {
  loadCatalog(false);
  return h('section', { class: 'card stack' },
    h('div', { class: 'row gap between' },
      h('h2', { class: 'section-title' }, 'Model providers'),
      btn(loading ? 'Refreshing...' : 'Refresh model lists', () => loadCatalog(true), { icon: 'refresh', disabled: loading })),
    h('p', { class: 'muted' }, 'Run cheap roles on Groq or NVIDIA NIM instead of your Claude plan. Keys stay on this computer (.agent-hq/providers.json) and are never shown again. The NIM list is read at every start and daily.'),
    PROVIDERS.map(providerRow));
}

// ---- per-agent engine and model ----
const ENGINE_OPTS = [
  { value: 'app', label: 'Claude app' }, { value: 'claude-cli', label: 'Claude CLI' },
  { value: 'groq', label: 'Groq' }, { value: 'nim', label: 'NVIDIA NIM' }, { value: 'antigravity', label: 'Antigravity (design)' },
];
const CLAUDE_HINT = { opus: 'Opus (best, most usage)', sonnet: 'Sonnet (balanced)', haiku: 'Haiku (cheapest)' };
let draft = null; // {roleId: {engine, model}}
const tests = {}; // `${engine}|${model}` -> 'testing' | result

const roleDefault = (r) => ({ engine: r.engine || 'app', model: r.engine === 'antigravity' ? '' : r.model || '' });
const current = () => Object.fromEntries(store.roles.map((r) => {
  const o = store.settings.roleEngines?.[r.id];
  return [r.id, o ? { engine: o.engine, model: o.model || '' } : roleDefault(r)];
}));

function modelOptions(engine) {
  if (engine === 'app' || engine === 'claude-cli') return ['opus', 'sonnet', 'haiku'].map((m) => ({ value: m, label: CLAUDE_HINT[m] }));
  if (engine === 'groq' || engine === 'nim') {
    const c = catalog?.[engine];
    const rec = c?.recommended;
    const top = c?.top ?? [];
    const rest = (c?.models ?? []).filter((m) => !top.includes(m));
    return [{ value: '', label: rec ? `Auto (${rec})` : 'Auto' },
      ...top.map((m) => ({ value: m, label: (m === rec ? 'Recommended: ' : 'Good for agents: ') + m })),
      ...rest.map((m) => ({ value: m, label: m }))];
  }
  return [{ value: '', label: 'Set in Antigravity' }];
}

// Saver: planning and review stay on Claude Sonnet; short read-only roles move to a free API when a key exists.
function saverPreset() {
  const out = current();
  const cheap = store.settings.providers?.groq?.configured ? 'groq' : store.settings.providers?.nim?.configured ? 'nim' : null;
  for (const id of ['lead', 'architect', 'reviewer']) if (out[id]) out[id] = { engine: 'app', model: 'sonnet' };
  for (const id of ['kid-tester', 'producer', 'liveops', 'scout']) if (out[id]) out[id] = cheap ? { engine: cheap, model: '' } : { engine: 'app', model: 'haiku' };
  return out;
}

async function test(engine, model) {
  const k = engine + '|' + model;
  tests[k] = 'testing'; notify();
  try { tests[k] = await api('POST', '/api/models/test', { provider: engine, model: model || catalog?.[engine]?.recommended || '' }); } catch (e) { tests[k] = { ok: false, error: e.message }; }
  notify();
}
const testLabel = (r) => (r === 'testing' ? 'Testing...' : !r ? '' : r.ok ? `Works${r.tools ? ', tools OK' : ', but did not call the tool'} (${(r.ms / 1000).toFixed(1)} s)` : 'Failed: ' + r.error);

function roleRow(r, d) {
  const e = d[r.id];
  const keyless = (e.engine === 'groq' || e.engine === 'nim') && !store.settings.providers?.[e.engine]?.configured;
  const t = tests[e.engine + '|' + e.model];
  return h('div', { class: 'model-row' },
    h('div', { class: 'row gap' }, avatar(r.id, 28), h('div', { class: 'grow' }, h('strong', {}, roleLabel(r.id)), h('p', { class: 'hint clip' }, r.job))),
    selectEl(ENGINE_OPTS, e.engine, (v) => { d[r.id] = { engine: v, model: modelOptions(v)[v === 'app' || v === 'claude-cli' ? 1 : 0]?.value ?? '' }; notify(); }),
    selectEl(modelOptions(e.engine), e.model, (v) => { d[r.id] = { ...e, model: v }; notify(); }),
    e.engine === 'groq' || e.engine === 'nim'
      ? h('div', { class: 'row gap' }, btn('Test', () => test(e.engine, e.model), { kind: 'sm', disabled: keyless || t === 'testing' }),
        h('span', { class: 'hint' }, keyless ? 'Add a key above' : testLabel(t)))
      : h('span', {}));
}

export function agentModelsCard() {
  loadCatalog(false);
  if (!draft) draft = current();
  const dirty = JSON.stringify(draft) !== JSON.stringify(current());
  return h('section', { class: 'card stack' },
    h('h2', { class: 'section-title' }, 'Agent models'),
    h('p', { class: 'muted' }, 'Pick where each agent runs and which model it uses. Claude roles are worked by the Claude app (the hq-worker), Groq and NIM roles by HQ itself, with read, search, edit and the role\'s own check commands. Keep Luau code roles (builder, ui, economy) on Claude: these models have no Luau track record.'),
    h('div', { class: 'row gap wrap' },
      btn('Saver preset', () => { draft = saverPreset(); notify(); }, { icon: 'pulse', title: 'Sonnet for planning and review, free APIs for short read-only roles' }),
      btn('Reset to defaults', () => { draft = Object.fromEntries(store.roles.map((r) => [r.id, roleDefault(r)])); notify(); }, { kind: 'ghost' })),
    h('div', { class: 'model-grid' }, store.roles.map((r) => roleRow(r, draft))),
    h('div', { class: 'row gap' },
      btn('Save agent models', async () => {
        const value = Object.fromEntries(Object.entries(draft).map(([id, v]) => [id, { engine: v.engine, model: v.model || null }]));
        if (await act(() => api('POST', '/api/settings', { key: 'roleEngines', value }), 'Agent models saved. New tasks use them.')) {
          store.settings = { ...store.settings, roleEngines: value }; draft = null; notify();
        }
      }, { kind: 'primary', disabled: !dirty }),
      dirty ? btn('Discard', () => { draft = null; notify(); }, { kind: 'ghost' }) : null));
}
