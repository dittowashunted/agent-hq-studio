// Agent HQ server: HTTP API, SSE, static files. Zero dependencies.
import { createLink, mountLink, LINK_OWNER_ONLY } from './link.mjs'; import { createBridge, mountBridge, BRIDGE_OWNER_ONLY } from './discord-bridge.mjs'; import { mountGamesAdmin, mountOpenStudio } from './games-admin.mjs'; import { inferGame, mountGameContext, GAME_CONTEXT_OWNER_ONLY } from './game-context.mjs'; import { loadDoc } from './notebook-doc.mjs';
import { createAssetCatalog, mountCatalog, CATALOG_OWNER_ONLY } from './catalog.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as D from './db.mjs';
import { loadRoles, parseVault, buildBrief, readSettings } from './briefs.mjs';
import { mountMarket } from './market-routes.mjs';
import { mountIdeas, IDEAS_OWNER_ONLY } from './ideas.mjs';
import { createKnowledge, mountKnowledge } from './knowledge.mjs';
import { addCorrection, readCorrections } from './corrections.mjs';
import { mountLearning, LEARNING_OWNER_ONLY } from './preferences.mjs'; import { createLearningHooks } from './learning-hooks.mjs';
import { fetchCharts as realFetchCharts, fetchGameDetails, fetchIcons, fetchThumbnails, loadBenchmarks, titleAnalysis } from './market.mjs';
import { liveStatsView } from './livestats.mjs';
import { PROVIDERS, PROVIDER_IDS, CLAUDE_MODELS, keyLooksOk, createCatalog, testModel } from './providers.mjs';
import { ENGINES, LANES, DEFAULT_SETTINGS, SETTINGS_SCHEMA, mergeLaneSchedules, toMin, validateSetting } from './settings-schema.mjs';
import { routeEngine } from './art-routing.mjs';
import { createModelRefs } from './model-refs.mjs';
import { createRoleOverrides } from './role-overrides.mjs';
import { createSpendGuard } from './spend.mjs';
import { loadPlaybook } from './briefs.mjs';
import { createReadiness } from './readiness.mjs';
import { createPlay } from './play.mjs';
import { mountNotebook, NOTEBOOK_OWNER_ONLY } from './notebook.mjs';
import { normalizePitch } from './pitches.mjs';
import { listAssets as listAssetIndex, addAsset, readSystems, KINDS as ASSET_KINDS } from './assets.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 1024 * 1024;
const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
const UPLOAD_PATH = /^uploads\/[0-9a-f]{12}\.(?:png|jpg|webp)$/;
const UPLOAD_MAX = 5 * 1024 * 1024;
const METRICS = { d1: 100, d7: 100, payingPct: 100, firstMinute: 100, avgSessionMin: 1440 };
const TARGETS = {
  likeRatio: { label: '>80 %', min: 0.8 }, d1: { label: '12 to 15 %', min: 12, max: 15 }, d7: { label: '2 to 3 %', min: 2, max: 3 },
  avgSessionMin: { label: '>10 min', min: 10 }, payingPct: { label: '~2 %', min: 2 }, firstMinute: { label: 'players act in the first minute' },
};
const TASK_STATES = ['queued', 'working', 'review', 'done', 'failed', 'canceled'];
const TASK_ID = /^t_[0-9a-f]{12}$/;
const ASK_ID = /^a_[0-9a-f]{12}$/;
const PITCH_ID = /^p_[0-9a-f]{12}$/;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};
const MEDIA_INLINE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp3', '.ogg', '.wav', '.mp4']);
const CSP = "default-src 'self'; img-src 'self' data: https://cdn.polyhaven.com https://*.rbxcdn.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'";

// ---- event bus (SSE) ----
const clients = new Set(); export const listeners = new Set();
export function emit(type, payload) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload ?? null)}\n\n`;
  for (const res of clients) res.write(msg); for (const l of listeners) { try { l(type, payload); } catch {} }
}

// ---- validation ----
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function str(v, name, { max, min = 0, required = false } = {}) {
  if (v === undefined || v === null) {
    if (required) throw bad(`${name} is required`);
    return undefined;
  }
  if (typeof v !== 'string') throw bad(`${name} must be a string`);
  const s = v.trim();
  if (s.length < Math.max(min, required ? 1 : 0)) throw bad(`${name} is too short`);
  if (s.length > max) throw bad(`${name} is too long (max ${max})`);
  return s;
}
function oneOf(v, name, list, { required = false } = {}) {
  if (v === undefined || v === null) {
    if (required) throw bad(`${name} is required`);
    return undefined;
  }
  if (!list.includes(v)) throw bad(`${name} must be one of ${list.join(', ')}`);
  return v;
}
function intIn(v, name, lo, hi) {
  if (!Number.isInteger(v) || v < lo || v > hi) throw bad(`${name} must be an integer ${lo}..${hi}`);
  return v;
}
const firstLine = (s, max = 200) => (s.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, max) || 'Untitled';
const safeRel = (s) => !s.includes('\0') && !s.split(/[\\/]/).includes('..') && !path.isAbsolute(s);

function parseOptions(v, okMedia = () => true) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 12) throw bad('options must be an array of up to 12');
  return v.map((o) => {
    if (!isObj(o)) throw bad('option must be an object'); const out = { id: str(o.id, 'option.id', { max: 64, required: true }), label: str(o.label, 'option.label', { max: 200, required: true }) };
    const d = str(o.description, 'option.description', { max: 300 }), m = str(o.mediaPath, 'option.mediaPath', { max: 500 });
    if (m && (!safeRel(m) || !okMedia(m))) throw bad('option.mediaPath must be an existing image under media or assets');
    return { ...out, ...(d && { description: d }), ...(m && { mediaPath: m }), ...(o.recommended && { recommended: true }) };
  }).map((o, i, all) => { if (o.mediaPath && all.slice(0, i).filter((x) => x.mediaPath).length >= 4) throw bad('at most 4 options can have mediaPath'); return o; });
}

// ---- file helpers ----
function within(base, target) {
  const b = path.resolve(base);
  const t = path.resolve(target);
  return t === b || t.startsWith(b + path.sep) ? t : null;
}
function readFileIn(base, rel) {
  if (!safeRel(rel)) return null;
  const full = within(base, path.join(base, rel));
  if (!full) return null;
  try { return fs.statSync(full).isFile() ? full : null; } catch { return null; }
}
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = {};
  if (m) for (const l of m[1].split(/\r?\n/)) { const k = /^([\w-]+):\s*(.*)$/.exec(l); if (k) out[k[1]] = k[2].trim(); }
  return out;
}
function listAssets(dir, depth = 0, prefix = '', acc = []) {
  if (depth > 3 || acc.length >= 2000) return acc;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    if (e.isDirectory()) listAssets(path.join(dir, e.name), depth + 1, `${prefix}${e.name}/`, acc);
    else if (e.isFile() && depth <= 3) acc.push(`${prefix}${e.name}`);
  }
  return acc;
}
function tailLines(file, n) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).slice(-n);
}

// public Roblox numbers for one universe (no key needed; only works once the game is public)
async function realFetchLive(universeId) {
  const id = encodeURIComponent(universeId);
  const get = async (u) => {
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  const [g, v] = await Promise.all([get(`https://games.roblox.com/v1/games?universeIds=${id}`), get(`https://games.roblox.com/v1/games/votes?universeIds=${id}`)]);
  const gd = g.data?.[0];
  if (!gd) throw new Error('game not found on Roblox (is it public?)');
  return { playing: gd.playing ?? null, visits: gd.visits ?? null, favorites: gd.favoritedCount ?? null, up: v.data?.[0]?.upVotes ?? null, down: v.data?.[0]?.downVotes ?? null };
}

// Reads the game's aggregate DataStore entries (live + the last days) with an Open Cloud key. 404 = no entry yet.
export async function realFetchLiveStats({ apiKey, universeId, dates }) {
  const entry = async (key) => {
    const u = `https://apis.roblox.com/datastores/v1/universes/${encodeURIComponent(universeId)}/standard-datastores/datastore/entries/entry?datastoreName=HQStats&entryKey=${encodeURIComponent(key)}`;
    const r = await fetch(u, { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(15000) });
    if (r.status === 404) return null;
    if (r.status === 401 || r.status === 403) throw new Error(`Open Cloud refused the key (HTTP ${r.status}); it needs DataStore read access for HQStats`);
    if (!r.ok) throw new Error(`Open Cloud HTTP ${r.status}`);
    try { return JSON.parse(await r.text()); } catch { return null; }
  };
  const days = {};
  for (const d of dates) days[d] = await entry(`day-${d}`);
  return { live: await entry('live'), days };
}

// ---- server ----
/**
 * startServer({root, port=4317, stateDir, dbFile, runner, fetchCharts}) -> Promise<{server, db, token (agent), ownerToken, port, close}>
 * runner: an object, or a factory ({db, root, emit, port, token}) => runner (started/stopped by the server).
 */
export async function startServer({ root, port = 4317, stateDir, dbFile, seed, runner, linkFetch, catalogFetch, catalogLihfolk, catalogMirror, fetchCharts = realFetchCharts, now = Date.now, roles: rolesOpt, memoryDir, fetchLive = realFetchLive, fetchLiveStats = realFetchLiveStats, autoTimers = false, tickMs = 60000, fetchers: fetchersOpt = {}, knowledge: knowledgeOpt, readinessOpts = {}, playOpts = {} } = {}) {
  const fetchers = { details: fetchGameDetails, icons: fetchIcons, thumbnails: fetchThumbnails, ...fetchersOpt };
  root = path.resolve(root ?? path.resolve(HERE, '../..'));
  stateDir = path.resolve(stateDir ?? path.join(root, '.agent-hq'));
  fs.mkdirSync(path.join(stateDir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(stateDir, 'media'), { recursive: true });

  const tokenFile = path.join(stateDir, 'token');
  let token;
  try { token = fs.readFileSync(tokenFile, 'utf8').trim(); } catch { /* create below */ }
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  }
  // Two credentials: `token` is the AGENT token (MCP and hqctl read it); `ownerToken` goes into index.html for the dashboard.
  const ownerFile = path.join(stateDir, 'owner-token');
  let ownerToken;
  try { ownerToken = fs.readFileSync(ownerFile, 'utf8').trim(); } catch { /* create below */ }
  if (!ownerToken) {
    ownerToken = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(ownerFile, ownerToken, { mode: 0o600 });
  }
  // Open Cloud credentials for reading the game's HQStats DataStore. Owner-only, write-only: never returned by any route.
  const ocFile = path.join(stateDir, 'opencloud.json');
  const readOpenCloud = () => {
    try { const j = JSON.parse(fs.readFileSync(ocFile, 'utf8')); return j?.apiKey && j?.universeId ? j : null; } catch { return null; }
  };
  // Groq / NVIDIA NIM API keys. Owner-only, write-only: never returned by any route; a task gets one only in its child env.
  const provFile = path.join(stateDir, 'providers.json');
  const readProviders = () => { try { return JSON.parse(fs.readFileSync(provFile, 'utf8')) ?? {}; } catch { return {}; } };
  const catalog = createCatalog({ stateDir, keys: readProviders, fetchFn: fetchers.models ?? fetch, now });
  const same = (a, b) => typeof a === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  // -> 'owner' | 'agent' | null
  const whoIs = (t) => (same(t, ownerToken) ? 'owner' : same(t, token) ? 'agent' : null);

  const db = D.openDb(dbFile ?? path.join(stateDir, 'hq.db'), seed);
  const roles = rolesOpt ?? loadRoles();
  memoryDir = path.resolve(memoryDir ?? path.join(HERE, 'memory'));
  const nowIso = () => new Date(now()).toISOString();
  const roleIds = roles.map((r) => r.id);
  const overrides = createRoleOverrides({ stateDir });
  const rolesMerged = () => overrides.merged(roles);
  const needRoleOn = (id) => { const r = rolesMerged().find((x) => x.id === id); if (r && !r.enabled) throw new HttpError(409, `${r.label} is turned off in Settings`); };
  const gameSlugs = () => D.listGames(db).map((g) => g.slug);
  const publicDir = path.join(HERE, 'public');

  let boundPort = port;
  let rebuildKnowledge = () => {}; let lh = null; // learning hooks, built after the memory helpers
  const runnerOwned = typeof runner === 'function';
  let rn = null;
  const stub = { cancel() {}, running: () => [], studioHolder: () => null, engines: () => ({ 'claude-cli': false, echo: true }) };
  const R = () => rn ?? stub;

  const settingsAll = () => {
    const out = Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([k, v]) => [k, D.getSetting(db, k, v)]));
    out.laneSchedules = mergeLaneSchedules(out.laneSchedules);
    out.openCloud = { configured: !!readOpenCloud() };
    const pk = readProviders();
    out.providers = Object.fromEntries(PROVIDER_IDS.map((id) => [id, { configured: !!pk[id]?.apiKey, label: PROVIDERS[id].label }]));
    out.roleEngines = Object.fromEntries(Object.entries(out.roleEngines).map(([r, v]) => [r, { ...v, engine: D.migrateEngine(v.engine) }]));
    return out;
  };
  const lanesAll = () => {
    const l = D.getSetting(db, 'lanes', {});
    return Object.fromEntries(LANES.map((k) => [k, { lastSeenAt: l?.[k]?.lastSeenAt ?? null, lastRunAt: l?.[k]?.lastRunAt ?? null }]));
  };
  const touchLane = (engine, patch) => {
    const all = D.getSetting(db, 'lanes', {});
    D.setSetting(db, 'lanes', { ...all, [engine]: { ...(all[engine] ?? {}), lastSeenAt: nowIso(), ...patch } });
    emit('settings', { key: 'lanes', value: lanesAll() });
  };
  const roleOf = (id) => rolesMerged().find((r) => r.id === id);
  const clean = (t) => { if (t && 'taskToken' in t) { const { taskToken, ...r } = t; return r; } return t; };
  // a missing vault or skill file must not break claiming a task (the token would be lost)
  const briefFor = (task, taskToken) => {
    try { return buildBrief({ task, role: roleOf(task.role) ?? task.role, root, db, taskToken, memoryDir, references: D.listReferences(db), settings: settingsAll(), docSections: loadDoc(stateDir)?.sections }); } catch (e) {
      // Degraded brief: keep the hard rules and the reporting credentials so the agent stays safe and can still report.
      return `Full brief unavailable (${e.message}). Read CLAUDE.md first and follow it.

Hard rules: never publish, spend Robux, install tools, or edit a live place. Never read .agent-hq/owner-token. The server is authoritative for value. Stay inside the ${task.role} role's files.
Your HQ task id: ${task.id}.${taskToken ? ` Your HQ task token: ${taskToken}. Pass it as taskToken (with taskId) to every hq_* tool.` : ''}
Report with hq_note, hq_ask_owner and hq_complete (or node tools/agent-hq/hqctl.mjs).

Task: ${task.title}

${task.body}`;
    }
  };
  const pubTask = (t) => { emit('task', clean(t)); processTask(clean(t)); link.taskChanged(clean(t)); lh?.taskChanged(clean(t)); return clean(t); };
  const hookedEmit = (type, payload) => { emit(type, type === 'task' ? clean(payload) : payload); if (type === 'task') { processTask(clean(payload)); link.taskChanged(clean(payload)); lh?.taskChanged(clean(payload)); } };

  // ---- review gates: reviewer/tester tasks after a role finishes; FAIL sends work back (max 3 attempts) ----
  const GATE_ENGINES = new Set(['app', 'claude-cli', 'echo', 'groq', 'nim']);
  const evaluated = new Set();
  const isFail = (t) => /^\s*fail/i.test(t.summary ?? '');
  const bare = (title) => title.replace(/^(?:Fix|Check|Rework): /, '');
  function processTask(t) {
    if (!t) return;
    refs.taskChanged(t);
    if (t.gateFor) return evalGate(t);
    if (t.state !== 'review' || !GATE_ENGINES.has(t.engine)) return;
    const gates = (roleOf(t.role)?.gates ?? []).filter((g) => roleOf(g));
    if (!gates.length || D.gateTasks(db, t.id, t.startedAt ?? '').length) return;
    for (const g of gates) {
      queueTask({
        title: `Check: ${t.title}`.slice(0, 200), role: g, game: t.game, needsStudio: !!roleOf(g).needsStudio,
        parentId: t.id, gateFor: t.id, createdBy: 'gate',
        body: `Check the work of task ${t.id} (${roleOf(t.role)?.label ?? t.role}). Its report: ${t.summary ?? '(none)'}. Read the changed files it lists. Put PASS or FAIL as the first word of your hq_complete summary, then reasons. On FAIL, say exactly what must change.`,
      });
    }
  }
  function evalGate(g) {
    if (!['review', 'done'].includes(g.state) || evaluated.has(g.id)) return;
    evaluated.add(g.id);
    const orig = D.getTask(db, g.gateFor);
    if (g.state === 'review') g = pubTask(D.updateTask(db, g.id, { state: 'done' }));
    if (!orig || orig.state !== 'review') return;
    if (isFail(g)) {
      let note; lh?.gateFail(orig, g); // a FAIL reason is a lesson for the role that did the work
      if (orig.attempt < 3) {
        const fix = queueTask({
          title: `Fix: ${bare(orig.title)}`.slice(0, 200), role: orig.role, game: orig.game, engine: orig.engine,
          needsStudio: orig.needsStudio, parentId: orig.id, attempt: orig.attempt + 1, createdBy: 'gate', reworkCount: orig.reworkCount + 1,
          body: `${orig.body}\n\nReviewer feedback:\n${g.summary}`.slice(0, 20000),
        });
        note = `queued ${fix.title} (attempt ${fix.attempt})`;
      } else {
        const ask = D.createAsk(db, {
          taskId: orig.id, role: orig.role, kind: 'decision', title: `Gate failed 3 times: ${bare(orig.title)}`.slice(0, 200),
          why: (g.summary ?? '').slice(0, 20000), options: [{ id: 'retry', label: 'Retry', recommended: true }, { id: 'drop', label: 'Drop' }],
        });
        emit('ask', ask);
        note = 'asked the owner';
      }
      pubTask(D.updateTask(db, orig.id, { state: 'failed', error: 'Failed a review gate' }));
      postMessage({ role: orig.role, from: 'system', text: `Gate FAIL on "${orig.title}": ${note}.`, taskId: orig.id });
      return;
    }
    const batch = D.gateTasks(db, orig.id, orig.startedAt ?? '');
    if (batch.length && batch.every((x) => x.state === 'done' && !isFail(x))) {
      pubTask(D.updateTask(db, orig.id, { state: 'done' }));
      postMessage({ role: orig.role, from: 'system', text: `Passed review gates: ${orig.title}`, taskId: orig.id });
    }
  }
  const needTask = (id) => {
    if (!TASK_ID.test(id)) throw new HttpError(404, 'not found');
    const t = D.getTask(db, id);
    if (!t) throw new HttpError(404, 'task not found');
    return t;
  };
  // art work goes to the Antigravity lane unless the creator named an engine
  const createQueued = (f) => pubTask(D.createTask(db, f.engine ? f : { ...f, engine: routeEngine(f, settingsAll()) }));
  const refs = createModelRefs({ db, D, settingsAll, create: createQueued, postMessage: (m) => postMessage(m), roleOn: (id) => rolesMerged().find((x) => x.id === id)?.enabled !== false });
  const queueTask = ({ selected, ...f }) => { if (!f.game) f.game = inferGame({ parentGame: f.parentId && D.getTask(db, f.parentId)?.game, selected, text: `${f.title}
${f.body ?? ''}`, games: D.listGames(db) }); return refs.hold(f) ?? createQueued(f); }; // 3D model work waits for a reference sheet (model-refs.mjs)
  const assetCatalog = createAssetCatalog({ root, stateDir, addAsset, fetchImpl: catalogFetch ?? globalThis.fetch, lihfolkPath: catalogLihfolk ?? process.env.HQ_LIHFOLK_ASSETS, polyhavenLocal: catalogMirror });
  const link = createLink({ db, D, stateDir, emit, queueTask: (f) => queueTask(f), roleIds: () => rolesMerged().map((x) => x.id), fetchImpl: linkFetch ?? globalThis.fetch }); const bridge = createBridge({ db, D, stateDir, root, roles: rolesMerged, port: () => boundPort, fetchImpl: linkFetch ?? globalThis.fetch, now }); listeners.add(bridge.onEvent);
  const postMessage = (f) => { const m = D.addMessage(db, f); emit('message', m); return m; };

  const spendGuard = createSpendGuard({ db, emit, now, postMessage });
  const gameRow = (g) => ({ ...g, ...D.gameWork(db, g.slug) });
  // Agent-token requests act as the role of a task that is currently working: they must name it (taskId),
  // and body.role / body.createdBy are never trusted.
  // The task is found by its secret (body.taskToken or the x-hq-task-token header), never by its id alone.
  const agentTask = (body, roleList, headers) => {
    const tok = isObj(body) && typeof body.taskToken === 'string' ? body.taskToken : headers?.['x-hq-task-token'];
    let found = null;
    if (typeof tok === 'string' && /^[0-9a-f]{64}$/.test(tok)) {
      for (const r of D.workingTaskTokens(db)) if (same(tok, r.taskToken)) found = r.id; // compare all, no early exit
    }
    const t = found ? D.getTask(db, found) : null;
    if (!t || t.state !== 'working') throw new HttpError(403, 'agents must send the task token of their working task (taskToken)');
    if (isObj(body) && body.taskId !== undefined && body.taskId !== t.id) throw new HttpError(403, 'taskId does not match the task token');
    if (roleList && !roleList.includes(t.role)) throw new HttpError(403, `the ${t.role} role cannot do this`);
    return t;
  };
  // Routes only the owner token may call (the dashboard). Agents get 403.
  const OWNER_ONLY = [
    ['POST', /^\/api\/asks\/(?:approve-all|reject-all|empty)$/], ['POST', /^\/api\/asks\/[^/]+\/(?:answer|dismiss)$/],
    ['POST', /^\/api\/tasks\/[^/]+\/verdict$/], ['POST', /^\/api\/references$/], ['DELETE', /^\/api\/references\/[^/]+$/],
    ['GET', /^\/api\/games\/[^/]+\/gate$/], ['POST', /^\/api\/games\/[^/]+\/(?:gate\/(?:start|confirm|checklist)|ad-note)$/],
    ['POST', /^\/api\/pitches\/ideas$/], ['POST', /^\/api\/pitches\/[^/]+\/decide$/], ['POST', /^\/api\/stage-requests\/[^/]+\/decide$/],
    ['POST', /^\/api\/games$/], ['PATCH', /^\/api\/games\/[^/]+$/], ['POST', /^\/api\/games\/[^/]+\/mark-live$/],
    ...LINK_OWNER_ONLY, ...BRIDGE_OWNER_ONLY, ...GAME_CONTEXT_OWNER_ONLY, ...LEARNING_OWNER_ONLY, ...CATALOG_OWNER_ONLY, ...NOTEBOOK_OWNER_ONLY, ['POST', /^\/api\/games\/[^/]+\/play$/], ...IDEAS_OWNER_ONLY, ['POST', /^\/api\/settings$/], ['POST', /^\/api\/roles\/[^/]+$/], ['POST', /^\/api\/models\/(?:refresh|test)$/], ['POST', /^\/api\/(?:pause|resume)$/], ['POST', /^\/api\/tasks\/[^/]+\/(?:cancel|retry)$/],
    ['POST', /^\/api\/messages\/[^/]+\/reset$/], ['POST', /^\/api\/memory\/[^/]+\/corrections$/], ['DELETE', /^\/api\/memory\/[^/]+\/corrections\/[^/]+$/], ['POST', /^\/api\/threads\/[^/]+\/read$/],
    ['POST', /^\/api\/market\/corpus$/], ['DELETE', /^\/api\/market\/corpus\/\d+$/], ['POST', /^\/api\/uploads$/],
  ];
  const pubGame = (g) => { const r = gameRow(g); emit('game', r); return r; };
  const needGame = (slug) => {
    const g = SLUG.test(slug) ? D.getGame(db, slug) : null;
    if (!g) throw new HttpError(404, 'game not found');
    return g;
  };
  // attachPaths: uploaded screenshots (see POST /api/uploads)
  const parseAttach = (v) => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.length > 8) throw bad('attachPaths must be an array of up to 8 uploads');
    return v.map((x) => {
      if (typeof x !== 'string' || !UPLOAD_PATH.test(x) || !fs.existsSync(path.join(stateDir, 'media', x))) throw bad('unknown upload path');
      return x;
    });
  };

  // ---- routes: [method, regex, handler({m, body, query})] ----
  const routes = [];
  const route = (method, re, fn, opts = {}) => routes.push([method, re, fn, opts]);

  route('GET', /^\/api\/health$/, () => ({ ok: true }));
  mountLink(route, link, { str, bad, isObj, agentTask, HttpError }); mountBridge(route, bridge, { str, bad, isObj, HttpError }); mountGameContext(route, { db }); mountGamesAdmin(route, { db, D, pubGame, pubTask, postMessage, SLUG, str, bad, isObj, agentTask, needTask, HttpError });

  route('GET', /^\/api\/state$/, () => {
    const asks = D.listAsks(db);
    const open = asks.filter((a) => a.state === 'open');
    const rest = asks.filter((a) => a.state !== 'open').slice(0, 100);
    const eng = R().engines();
    const locks = D.studioLocks(db);
    return {
      tasks: D.listTasks(db, { limit: 500 }), asks: [...open, ...rest], pitches: D.listPitches(db),
      settings: settingsAll(), roles: rolesMerged(), running: R().running(),
      studio: { lanes: D.getSetting(db, 'studioLanes', 1), locks, holder: locks[0]?.taskId ?? R().studioHolder() },
      engines: { 'claude-cli': !!eng?.['claude-cli'], echo: true, groq: !!eng?.groq, nim: !!eng?.nim }, lanes: lanesAll(),
      games: D.listGames(db).map(gameRow), stageRequests: [...D.listStageRequests(db, { state: 'open' }), ...D.listStageRequests(db, { state: 'held' })],
    };
  });

  route('GET', /^\/api\/tasks$/, ({ query }) => {
    const state = oneOf(query.get('state') ?? undefined, 'state', TASK_STATES); const role = oneOf(query.get('role') ?? undefined, 'role', roleIds);
    const limit = Math.min(Math.max(parseInt(query.get('limit') ?? '200', 10) || 200, 1), 500);
    return D.listTasks(db, { state, role, limit });
  });

  route('POST', /^\/api\/tasks$/, ({ body, who, headers }) => {
    if (!isObj(body)) throw bad('body must be an object');
    const maker = who === 'agent' ? agentTask(body, ['lead'], headers) : null; // only the Lead delegates
    const role = oneOf(body.role, 'role', roleIds, { required: true });
    needRoleOn(role);
    const needs = body.needsStudio === undefined || body.needsStudio === null
      ? !!roles.find((r) => r.id === role)?.needsStudio : !!body.needsStudio;
    const parentId = str(body.parentId, 'parentId', { max: 20 });
    if (parentId && !TASK_ID.test(parentId)) throw bad('parentId is not a task id');
    const slugs = gameSlugs();
    // With a single game there is nothing to choose: file the task under it so Games > Open work shows it.
    const game = body.game === undefined || body.game === null || body.game === '' ? (maker?.game && slugs.includes(maker.game) ? maker.game : slugs.length === 1 ? slugs[0] : null) : oneOf(body.game, 'game', slugs);
    return queueTask({
      title: str(body.title, 'title', { max: 200, required: true }),
      body: str(body.body, 'body', { max: 20000 }) ?? '',
      role, game, engine: oneOf(body.engine || undefined, 'engine', ENGINES),
      model: str(body.model, 'model', { max: 100 }) || null, needsStudio: needs, parentId: parentId ?? maker?.id ?? null,
      createdBy: maker ? 'lead' : oneOf(body.createdBy, 'createdBy', ['owner', 'lead', 'schedule', 'gate', ...roleIds]) ?? 'owner',
      attachPaths: parseAttach(body.attachPaths),
    });
  });

  route('GET', /^\/api\/tasks\/([^/]+)$/, ({ m }) => needTask(m[1]));

  route('POST', /^\/api\/tasks\/([^/]+)\/cancel$/, ({ m }) => {
    let t = needTask(m[1]);
    if (!['queued', 'working', 'review'].includes(t.state)) throw new HttpError(409, `cannot cancel a ${t.state} task`);
    if (t.state === 'working') R().cancel(t.id);
    t = D.getTask(db, t.id);
    if (t.state !== 'canceled') t = D.updateTask(db, t.id, { state: 'canceled' });
    return pubTask(t);
  });

  route('POST', /^\/api\/tasks\/([^/]+)\/retry$/, ({ m }) => {
    const t = needTask(m[1]);
    if (['queued', 'working'].includes(t.state)) throw new HttpError(409, `task is already ${t.state}`);
    return pubTask(D.updateTask(db, t.id, { state: 'queued' }));
  });

  route('POST', /^\/api\/tasks\/([^/]+)\/complete$/, ({ m, body, who, headers }) => {
    const t = needTask(m[1]);
    if (who === 'agent' && agentTask(body, undefined, headers).id !== t.id) throw new HttpError(403, 'the task token does not belong to this task');
    if (!isObj(body)) throw bad('body must be an object');
    const summary = str(body.summary, 'summary', { max: 20000, required: true });
    const state = oneOf(body.state, 'state', ['done', 'review', 'failed']) ?? 'review';
    if (['done', 'failed', 'canceled'].includes(t.state)) throw new HttpError(409, `task is already ${t.state}`);
    return pubTask(D.updateTask(db, t.id, { state, summary, ...(state === 'failed' ? { error: summary.slice(0, 500) } : {}) }));
  });

  // "Back to you": the owner's verdict on a finished task (not a gate): looks good, or needs changes
  route('POST', /^\/api\/tasks\/([^/]+)\/verdict$/, ({ m, body }) => {
    const t = needTask(m[1]);
    if (t.state !== 'review' || t.gateFor) throw new HttpError(409, 'only a finished task (state review, not a gate) takes a verdict');
    if (!isObj(body)) throw bad('body must be an object');
    const verdict = oneOf(body.verdict, 'verdict', ['approve', 'changes'], { required: true });
    const note = str(body.note, 'note', { max: 2000, required: verdict === 'changes' }) ?? null;
    const say = (text) => postMessage({ role: t.role, from: 'owner', text, taskId: t.id });
    remember(t.role, verdict === 'approve' ? 'preference' : 'correction', t.game, note); // the owner's note stays with the role for good
    if (verdict === 'approve') {
      say(`Looks good: ${t.title}${note ? `. Note: ${note}` : ''}`);
      return { task: pubTask(D.updateTask(db, t.id, { state: 'done' })), rework: null };
    }
    say(`Needs changes on "${t.title}": ${note}`);
    const rework = queueTask({
      title: `Rework: ${bare(t.title)}`.slice(0, 200), role: t.role, game: t.game, engine: t.engine, needsStudio: t.needsStudio, parentId: t.id,
      attempt: t.attempt + 1, reworkCount: t.reworkCount + 1, createdBy: 'owner', attachPaths: t.attachPaths,
      body: `${t.body}\n\nOwner feedback:\n${note}`.slice(0, 20000),
    });
    return { task: pubTask(D.updateTask(db, t.id, { state: 'done' })), rework };
  });

  route('POST', /^\/api\/tasks\/next$/, ({ body }) => {
    if (!isObj(body)) throw bad('body must be an object');
    const engine = oneOf(body.engine, 'engine', LANES, { required: true });
    let roles;
    if (body.roles !== undefined && body.roles !== null) {
      if (!Array.isArray(body.roles) || body.roles.length > roleIds.length) throw bad('roles must be an array of role ids');
      roles = body.roles.map((r) => oneOf(r, 'roles[]', roleIds, { required: true }));
    }
    touchLane(engine, {});
    if (spendGuard()) return { task: null };
    const preferRole = settingsAll().batchByRole && typeof body.preferRole === 'string' && roleIds.includes(body.preferRole) ? body.preferRole : undefined;
    const claimed = D.claimNext(db, { engine, roles, preferRole });
    if (!claimed) return { task: null };
    const { taskToken, ...task } = claimed; // the token goes only to the claimer, in this response and the brief
    pubTask(task);
    // runAs: the subagent settings the worker must use (the owner's per-role choice in Settings, else roles.json)
    const r = roleOf(task.role);
    const runAs = { agentType: r?.agentType ?? 'general-purpose', model: CLAUDE_MODELS.includes(task.model) ? task.model : r?.model ?? 'sonnet' };
    return { task, brief: briefFor(task, taskToken), taskToken, runAs };
  });

  // alias for older callers: claim one specific queued task for a lane
  route('POST', /^\/api\/tasks\/([^/]+)\/claim$/, ({ m, body }) => {
    const t = needTask(m[1]);
    const engine = isObj(body) ? D.migrateEngine(body.engine) : null;
    if (!LANES.includes(engine)) throw bad('engine must be "app" or "antigravity"');
    if (t.state !== 'queued') throw new HttpError(409, `task is ${t.state}, not queued`);
    const task = pubTask(D.updateTask(db, t.id, { state: 'working', engine }));
    const taskToken = D.issueTaskToken(db, t.id);
    return { task, brief: briefFor(task, taskToken), taskToken };
  });

  route('GET', /^\/api\/tasks\/([^/]+)\/brief$/, ({ m }) => {
    const t = needTask(m[1]);
    return { brief: briefFor(t) };
  });

  route('GET', /^\/api\/tasks\/([^/]+)\/log$/, ({ m }) => {
    const t = needTask(m[1]);
    return { lines: tailLines(path.join(stateDir, 'logs', `${t.id}.ndjson`), 500) };
  });

  // asks
  route('GET', /^\/api\/asks$/, ({ query }) => D.listAsks(db, {
    state: oneOf(query.get('state') ?? undefined, 'state', ['open', 'answered', 'dismissed']),
    verdict: oneOf(query.get('verdict') ?? undefined, 'verdict', ['approved', 'changes', 'rejected', 'held']),
    includeSuperseded: query.get('includeSuperseded') === '1',
  }));

  route('POST', /^\/api\/asks$/, ({ body, who, headers }) => {
    if (!isObj(body)) throw bad('body must be an object');
    const agent = who === 'agent' ? agentTask(body, undefined, headers) : null;
    const taskId = agent ? agent.id : str(body.taskId, 'taskId', { max: 20 }) ?? null;
    if (taskId && !TASK_ID.test(taskId)) throw bad('taskId is not a task id');
    const mediaPath = str(body.mediaPath, 'mediaPath', { max: 500 }) ?? null;
    if (mediaPath && !safeRel(mediaPath)) throw bad('mediaPath must be relative');
    const ask = D.createAsk(db, {
      taskId, role: agent ? agent.role : oneOf(body.role, 'role', roleIds, { required: true }),
      kind: oneOf(body.kind, 'kind', ['decision', 'try', 'approve', 'review', 'reference'], { required: true }),
      title: str(body.title, 'title', { max: 200, required: true }), why: str(body.why, 'why', { max: 20000 }) ?? '',
      options: parseOptions(body.options, mediaExists), mediaPath,
    });
    emit('ask', ask); if (agent) lh?.supersede(ask, emit); // an agent asking again replaces its older open question
    return ask;
  });

  const needAsk = (id, allowHeld = false) => {
    const a = ASK_ID.test(id) ? D.getAsk(db, id) : null;
    if (!a) throw new HttpError(404, 'ask not found');
    if (a.state !== 'open' && !(allowHeld && a.verdict === 'held')) throw new HttpError(409, `ask is already ${a.state}`); // held asks can be decided later
    return a;
  };
  // review answers: approve[:note], reject[:reason], hold:<reason>, changes:<text>
  const parseVerdict = (answer) => {
    const at = (re) => re.exec(answer)?.[1].trim();
    if (answer === 'approve') return ['approved', null];
    if (answer === 'reject') return ['rejected', null];
    if (answer.startsWith('approve:')) return ['approved', at(/^approve:([\s\S]*)$/) || null];
    if (answer.startsWith('reject:')) return ['rejected', at(/^reject:([\s\S]*)$/) || null];
    if (answer.startsWith('hold:') && at(/^hold:([\s\S]*)$/)) return ['held', at(/^hold:([\s\S]*)$/)];
    if (answer.startsWith('changes:') && at(/^changes:([\s\S]*)$/)) return ['changes', at(/^changes:([\s\S]*)$/)];
    return null;
  };

  // Apply an owner answer to an ask and run its side effects.
  function applyAnswer(a, answer) {
    let verdict = null; let note = null;
    if (a.kind === 'review') {
      const v = parseVerdict(answer);
      if (!v) throw bad('review answers are "approve[:note]", "reject[:reason]", "hold:<reason>" or "changes:<what to change>"');
      [verdict, note] = v;
    }
    const done = D.answerAsk(db, a.id, { answer, verdict, verdictNote: note });
    emit('ask', done);
    if (link.answered(a, answer) || learning.answered(a, answer)) return done;
    const task = a.taskId ? D.getTask(db, a.taskId) : null;
    if (verdict === 'changes' || verdict === 'rejected' || verdict === 'approved') remember(a.role, verdict === 'approved' ? 'preference' : 'correction', task?.game, note);
    const say = (text) => postMessage({ role: a.role, from: 'owner', text, taskId: a.taskId });
    if (a.kind === 'decision' || a.kind === 'try' || a.kind === 'approve') {
      const opt = a.options.find((o) => o.id === answer);
      if (opt) say(`Decision on "${a.title}": ${opt.label}`);
      else if (answer !== 'done' && answer !== 'ok') say(`Answer to "${a.title}": ${answer}`); // free text: "or say it in your own words"
      if (task && a.title.startsWith('Gate failed') && task.state === 'failed') {
        if (answer === 'retry') pubTask(D.updateTask(db, task.id, { state: 'queued', attempt: 1 }));
        else if (answer === 'drop') pubTask(D.updateTask(db, task.id, { state: 'canceled' }));
      }
    } else if (verdict === 'approved') {
      say(`Approved: ${a.title}${note ? `. Note: ${note}` : ''}`);
      if (task?.state === 'review') pubTask(D.updateTask(db, task.id, { state: 'done' }));
      if (task?.role === 'designer' && !refs.approved(a, task)) queueTask({
        title: `Build approved concept: ${task.title}`.slice(0, 200), role: 'ui', engine: 'app', parentId: task.id, createdBy: 'owner', game: task.game,
        body: `Rebuild the approved concept image at ${a.mediaPath ?? '(see the review ask)'} as real Luau UI. Use the roblox-concept-art-ui skill, sections 2 to 4. The image is a reference only and is never shipped.${note ? `\n\nOwner note: ${note}` : ''}`,
      });
    } else if (verdict === 'rejected') {
      say(`Rejected: ${a.title}${note ? `. Reason: ${note}` : ''}`); refs.rejected(a, task);
      if (task?.state === 'review') pubTask(D.updateTask(db, task.id, { state: 'canceled' }));
    } else if (verdict === 'held') {
      say(`Held for later: ${a.title}. Reason: ${note}`); // parked: the task stays in review, nothing is queued
    } else if (verdict === 'changes') {
      say(`Changes requested on "${a.title}": ${note}`);
      queueTask({
        title: `Changes: ${task?.title ?? a.title}`.slice(0, 200), body: note, role: a.role, game: task?.game ?? null,
        needsStudio: task?.needsStudio ?? 0, parentId: task?.id ?? null, createdBy: 'owner', reworkCount: (task?.reworkCount ?? 0) + 1,
      });
      if (task?.state === 'review') pubTask(D.updateTask(db, task.id, { state: 'done' }));
    }
    return done;
  }

  route('POST', /^\/api\/asks\/([^/]+)\/answer$/, ({ m, body }) => {
    const a = needAsk(m[1], true);
    if (!isObj(body)) throw bad('body must be an object');
    return applyAnswer(a, str(body.answer, 'answer', { max: 20000, required: true }));
  });

  // "Clear the queue": approve many open review asks at once
  route('POST', /^\/api\/asks\/approve-all$/, ({ body }) => {
    if (!isObj(body) || !Array.isArray(body.ids) || body.ids.length > 200) throw bad('ids must be an array of up to 200 ask ids');
    const approved = []; const skipped = [];
    for (const id of body.ids) {
      const a = typeof id === 'string' && ASK_ID.test(id) ? D.getAsk(db, id) : null;
      if (a && a.state === 'open' && a.kind === 'review') { applyAnswer(a, 'approve'); approved.push(id); } else skipped.push(id);
    }
    return { approved, skipped };
  });

  route('POST', /^\/api\/asks\/reject-all$/, ({ body }) => {
    if (!isObj(body) || !Array.isArray(body.ids) || body.ids.length > 200) throw bad('ids must be an array of up to 200 ask ids');
    const reason = str(body.reason, 'reason', { max: 2000 });
    const rejected = []; const skipped = [];
    for (const id of body.ids) {
      const a = typeof id === 'string' && ASK_ID.test(id) ? D.getAsk(db, id) : null;
      if (a && a.state === 'open' && a.kind === 'review') { applyAnswer(a, reason ? `reject:${reason}` : 'reject'); rejected.push(id); } else skipped.push(id);
    }
    return { rejected, skipped };
  });

  // "Empty the queue without approving anything": dismiss, no verdict, tasks untouched
  route('POST', /^\/api\/asks\/empty$/, ({ body }) => {
    if (!isObj(body) || !Array.isArray(body.ids) || body.ids.length > 200) throw bad('ids must be an array of up to 200 ask ids');
    const dismissed = []; const skipped = [];
    for (const id of body.ids) {
      const a = typeof id === 'string' && ASK_ID.test(id) ? D.getAsk(db, id) : null;
      if (a && a.state === 'open') { emit('ask', D.answerAsk(db, a.id, { answer: null, state: 'dismissed' })); dismissed.push(id); } else skipped.push(id);
    }
    return { dismissed, skipped };
  });

  route('POST', /^\/api\/asks\/([^/]+)\/dismiss$/, ({ m }) => {
    const done = D.answerAsk(db, needAsk(m[1]).id, { answer: null, state: 'dismissed' });
    emit('ask', done);
    return done;
  });

  // messages
  route('GET', /^\/api\/messages$/, ({ query }) => {
    const archive = query.get('archive') ?? undefined;
    if (archive && !/^ar_[0-9a-f]{12}$/.test(archive)) throw bad('archive is not an archive id');
    return D.listMessages(db, { role: oneOf(query.get('role') ?? undefined, 'role', roleIds), archive });
  });

  // palette search over what was said, current and archived chats
  route('GET', /^\/api\/messages\/search$/, ({ query }) => {
    const q = (query.get('q') ?? '').trim().slice(0, 100);
    return q.length < 2 ? [] : D.searchMessages(db, q).map((r) => ({ ...r, snippet: r.text.slice(Math.max(0, r.text.toLowerCase().indexOf(q.toLowerCase()) - 30), 150) }));
  });

  route('POST', /^\/api\/messages$/, ({ body, who, headers }) => {
    if (!isObj(body)) throw bad('body must be an object');
    const agent = who === 'agent' ? agentTask(body, undefined, headers) : null; // agent notes always go to the task's own thread
    const role = agent ? agent.role : oneOf(body.role, 'role', roleIds, { required: true });
    if (!agent) needRoleOn(role);
    const text = str(body.text, 'text', { max: 20000, required: true });
    const taskId = agent ? agent.id : str(body.taskId, 'taskId', { max: 20 }) ?? null;
    if (taskId && !TASK_ID.test(taskId)) throw bad('taskId is not a task id');
    const attachPaths = parseAttach(body.attachPaths);
    const msg = postMessage({ role, from: agent ? 'agent' : 'owner', text, taskId, attachPaths });
    if (msg.from === 'owner') lh?.criticism(role, text, queueTask({ title: firstLine(text, 100), body: text, role, createdBy: 'owner', threadMessageId: msg.id, attachPaths, selected: body.game })?.game);
    return msg;
  });

  route('POST', /^\/api\/messages\/([^/]+)\/reset$/, ({ m }) => {
    const role = oneOf(m[1], 'role', roleIds, { required: true });
    const archivedAs = D.archiveThread(db, role); // "Start fresh" keeps the old conversation under Past chats
    return { ...postMessage({ role, from: 'system', text: 'New conversation' }), archivedAs };
  });

  route('GET', /^\/api\/threads\/([^/]+)\/archives$/, ({ m }) => D.listArchives(db, oneOf(m[1], 'role', roleIds, { required: true })));

  route('GET', /^\/api\/threads$/, () => {
    const reads = D.getSetting(db, 'threadReads', {});
    return roleIds.map((role) => ({ role, last: D.lastMessage(db, role), unread: D.countUnread(db, role, reads[role] ?? null), lastReadAt: reads[role] ?? null }));
  });

  route('POST', /^\/api\/threads\/([^/]+)\/read$/, ({ m }) => {
    const role = oneOf(m[1], 'role', roleIds, { required: true });
    const reads = { ...D.getSetting(db, 'threadReads', {}), [role]: nowIso() };
    D.setSetting(db, 'threadReads', reads);
    emit('settings', { key: 'threadReads', value: reads });
    return { role, lastReadAt: reads[role] };
  });

  // role memory: committed markdown lessons
  const memFile = (role) => path.join(memoryDir, `${role}.md`);
  const readLessons = (role) => {
    let text = '';
    try { text = fs.readFileSync(memFile(role), 'utf8'); } catch { /* none yet */ }
    return text.split('\n').map((l) => /^- (\d{4}-\d{2}-\d{2}): (.+)$/.exec(l.trim())).filter(Boolean).map((x) => ({ date: x[1], text: x[2] }));
  };
  // owner corrections live in memory/<role>.corrections.md (corrections.mjs); only the owner's own actions write them
  const remember = (role, kind, game, text) => { try { if (addCorrection(memoryDir, role, { kind, game, text }, nowIso().slice(0, 10)).added && kind === 'correction') learning.noted(role); } catch { /* memory is best effort */ } };
  route('GET', /^\/api\/memory\/([^/]+)$/, ({ m }) => { const role = oneOf(m[1], 'role', roleIds, { required: true }); return { lessons: readLessons(role), corrections: readCorrections(memoryDir, role) }; });
  const learning = mountLearning(route, { db, D, emit, memoryDir, stateDir, roleIds, roleLabel: (id) => roleOf(id)?.label ?? id, queueTask, nowIso, str, bad, isObj, agentTask, HttpError, onNoteSaved: () => kn.reindex?.('notes') }); lh = createLearningHooks({ db, D, memoryDir, postMessage, queueTask: (f) => queueTask(f), remember, roleLabel: (id) => roleOf(id)?.label ?? id, nowIso });
  route('POST', /^\/api\/memory\/([^/]+)$/, ({ m, body, who, headers }) => {
    const pathRole = oneOf(m[1], 'role', roleIds, { required: true });
    if (!isObj(body)) throw bad('body must be an object');
    const role = who === 'agent' ? agentTask(body, undefined, headers).role : pathRole; // an agent only writes its own role's memory
    const lesson = str(body.lesson, 'lesson', { max: 300, required: true }).replace(/\s*\n\s*/g, ' ');
    let lessons = readLessons(role);
    const added = !lessons.some((l) => l.text === lesson);
    if (added) {
      lessons = [...lessons, { date: nowIso().slice(0, 10), text: lesson }].slice(-60);
      fs.mkdirSync(memoryDir, { recursive: true });
      fs.writeFileSync(memFile(role), lessons.map((l) => `- ${l.date}: ${l.text}`).join('\n') + '\n');
    }
    return { lessons, added, role };
  });

  // lane gate: should this worker run now? The outside schedulers fire at a fixed rate; HQ decides.
  route('POST', /^\/api\/lanes\/([^/]+)\/gate$/, ({ m, body, headers }) => {
    const engine = oneOf(m[1], 'engine', LANES, { required: true });
    const manual = isObj(body) && body.manual === true;
    const cfg = settingsAll().laneSchedules[engine];
    const queued = D.countQueued(db, engine);
    const out = (run, reason) => ({ run, reason, maxTasks: cfg.maxTasks, queued });
    const lastRunAt = lanesAll()[engine].lastRunAt;
    const decide = () => {
      if (!cfg.enabled) return out(false, 'lane paused in HQ');
      if (spendGuard()) return out(false, 'HQ is paused');
      if (!queued) return out(false, 'queue empty');
      if (!manual) {
        const d = new Date(now());
        const mins = d.getHours() * 60 + d.getMinutes();
        const from = toMin(cfg.activeFrom); const to = toMin(cfg.activeTo);
        const inside = from === to ? true : from < to ? mins >= from && mins < to : mins >= from || mins < to;
        if (!inside) return out(false, 'outside active hours');
        if (lastRunAt && now() - Date.parse(lastRunAt) < (cfg.everyMinutes - 2) * 60000) {
          const due = new Date(Date.parse(lastRunAt) + cfg.everyMinutes * 60000);
          return out(false, `not due until ${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`);
        }
      }
      return null;
    };
    const blocked = decide(); // lane token for hq_notebook_mirror, never to a task caller; an empty queue gets one too so Instant mode still syncs the notebook
    const lane = () => (headers?.['x-hq-task-token'] || (isObj(body) && body.taskToken) ? {} : { laneToken: nb.issueLaneToken(engine) });
    if (blocked) { touchLane(engine, {}); return blocked.reason === 'queue empty' ? { ...blocked, ...lane() } : blocked; }
    touchLane(engine, { lastRunAt: nowIso() }); return { ...out(true, 'ok'), ...lane() };
  });

  // ---- the Visual bar: approved images pinned as house references ----
  const mediaExists = (rel) => !!(readFileIn(path.join(stateDir, 'media'), rel) || readFileIn(path.join(root, 'assets'), rel.replace(/^assets\//, '')) || readFileIn(path.join(root, 'assets'), rel));
  route('GET', /^\/api\/references$/, () => D.listReferences(db));
  route('POST', /^\/api\/references$/, ({ body }) => {
    if (!isObj(body)) throw bad('body must be an object');
    const mediaPath = str(body.mediaPath, 'mediaPath', { max: 500, required: true });
    if (!safeRel(mediaPath) || !mediaExists(mediaPath)) throw bad('mediaPath must be an existing image under media or assets');
    const category = oneOf(body.category, 'category', D.REFERENCE_CATEGORIES, { required: true });
    const dup = D.listReferences(db).find((r) => r.mediaPath === mediaPath && r.category === category);
    return dup ?? D.addReference(db, { mediaPath, category, note: str(body.note, 'note', { max: 500 }) ?? '' });
  });
  route('DELETE', /^\/api\/references\/([^/]+)$/, ({ m }) => {
    if (!/^r_[0-9a-f]{12}$/.test(m[1]) || !D.deleteReference(db, m[1])) throw new HttpError(404, 'reference not found');
    return { ok: true };
  });

  // ---- games, stages, live numbers ----
  route('GET', /^\/api\/games$/, () => D.listGames(db).map(gameRow));

  route('POST', /^\/api\/games$/, ({ body }) => {
    if (!isObj(body)) throw bad('body must be an object');
    const slug = str(body.slug, 'slug', { max: 40, required: true });
    if (!SLUG.test(slug)) throw bad('slug must be lowercase letters, digits and dashes (2 to 40)');
    if (D.getGame(db, slug)) throw new HttpError(409, 'a game with that slug exists');
    return pubGame(D.createGame(db, { slug, name: str(body.name, 'name', { max: 100, required: true }) }));
  });

  route('PATCH', /^\/api\/games\/([^/]+)$/, ({ m, body }) => {
    const g = needGame(m[1]);
    if (!isObj(body)) throw bad('body must be an object');
    const patch = {};
    if (body.name !== undefined) patch.name = str(body.name, 'name', { max: 100, required: true });
    if (body.nextStep !== undefined) patch.nextStep = str(body.nextStep, 'nextStep', { max: 300 }) ?? '';
    if (body.note !== undefined) patch.note = str(body.note, 'note', { max: 2000 }) ?? '';
    if (body.versionType !== undefined) patch.versionType = str(body.versionType, 'versionType', { max: 40 }) ?? '';
    if (body.version !== undefined) patch.version = intIn(body.version, 'version', 1, 9999);
    if (body.universeId !== undefined) {
      const u = body.universeId === null || body.universeId === '' ? null : String(body.universeId).trim();
      if (u !== null && !/^\d{1,15}$/.test(u)) throw bad('universeId must be digits');
      patch.universeId = u;
    }
    if (body.changelog !== undefined) {
      const c = body.changelog;
      if (c === null) patch.changelog = null;
      else {
        if (!isObj(c) || !Array.isArray(c.bullets) || c.bullets.length > 30) throw bad('changelog must be {heading, bullets[]}');
        patch.changelog = { heading: str(c.heading, 'changelog.heading', { max: 200 }) ?? '', bullets: c.bullets.map((b) => str(b, 'changelog bullet', { max: 500, required: true })) };
      }
    }
    return pubGame(D.updateGame(db, g.slug, patch));
  });

  route('GET', /^\/api\/stage-requests$/, ({ query }) => D.listStageRequests(db, {
    state: oneOf(query.get('state') ?? undefined, 'state', ['open', 'approved', 'rejected', 'held']),
    game: query.get('game') && SLUG.test(query.get('game')) ? query.get('game') : undefined,
  }));

  route('POST', /^\/api\/games\/([^/]+)\/stage-requests$/, ({ m, body, who, headers }) => {
    const g = needGame(m[1]);
    if (!isObj(body)) throw bad('body must be an object');
    const requester = who === 'agent' ? agentTask(body, ['producer', 'lead'], headers) : null;
    const toStage = oneOf(body.toStage, 'toStage', D.STAGES, { required: true });
    if (toStage === 'live') throw new HttpError(403, 'only the owner marks a game live (they publish it themselves)');
    if (D.STAGES.indexOf(toStage) !== D.STAGES.indexOf(g.stage) + 1) throw bad(`${g.name} is at "${g.stage}"; the only next stage is "${D.STAGES[D.STAGES.indexOf(g.stage) + 1] ?? 'none'}"`);
    const role = requester ? requester.role : oneOf(body.role, 'role', roleIds) ?? 'producer';
    if (D.listStageRequests(db, { game: g.slug }).some((r) => r.toStage === toStage && ['open', 'held'].includes(r.state))) throw new HttpError(409, 'that stage request is already open');
    const r = D.createStageRequest(db, { game: g.slug, fromStage: g.stage, toStage, role, evidence: str(body.evidence, 'evidence', { max: 5000, required: true }) });
    emit('stage', r);
    postMessage({ role: 'lead', from: 'system', text: `${roleOf(role)?.label ?? role} asks to move ${g.name} from ${g.stage} to ${toStage}.` });
    return r;
  });

  route('POST', /^\/api\/stage-requests\/([^/]+)\/decide$/, ({ m, body }) => {
    const r = /^s_[0-9a-f]{12}$/.test(m[1]) ? D.getStageRequest(db, m[1]) : null;
    if (!r) throw new HttpError(404, 'stage request not found');
    if (!['open', 'held'].includes(r.state)) throw new HttpError(409, `request is already ${r.state}`);
    const state = oneOf(isObj(body) ? body.state : undefined, 'state', ['approved', 'rejected', 'held'], { required: true });
    const reason = str(body.reason, 'reason', { max: 2000, required: state !== 'approved' }) ?? null; // a reject or hold always says why
    const criteriaFailed = body.criteriaFailed ?? [];
    if (!Array.isArray(criteriaFailed) || criteriaFailed.length > 20 || criteriaFailed.some((c) => typeof c !== 'string' || !/^[A-Z][0-9]{1,2}$/.test(c))) throw bad('criteriaFailed must be rubric ids like G5 or S4');
    const g = needGame(r.game);
    if (state === 'approved') {
      if (g.stage !== r.fromStage) throw new HttpError(409, `game is now at "${g.stage}", not "${r.fromStage}"`);
      pubGame(D.updateGame(db, g.slug, { stage: r.toStage }));
    } else if (state === 'rejected') {
      pubGame(D.bumpGameRework(db, g.slug)); // times sent back for rework
    }
    const done = D.decideStageRequest(db, r.id, state, { reason, criteriaFailed: state === 'approved' ? [] : criteriaFailed });
    emit('stage', done); lh?.stageDecision(r, state, reason, g.slug);
    const crit = done.criteriaFailed.length ? ` Failed: ${done.criteriaFailed.join(', ')}.` : '';
    postMessage({
      role: 'lead', from: 'system',
      text: state === 'approved' ? `Stage approved: ${g.name} moved from ${r.fromStage} to ${r.toStage}.`
        : state === 'held' ? `Stage request held: ${g.name} stays at ${r.fromStage}. Reason: ${reason}.${crit}`
          : `Stage request rejected: ${g.name} stays at ${r.fromStage}. Reason: ${reason}.${crit}`,
    });
    return done;
  });

  // owner only: they published the game themselves
  route('POST', /^\/api\/games\/([^/]+)\/mark-live$/, ({ m }) => {
    const g = needGame(m[1]);
    if (g.stage !== 'ready') throw new HttpError(409, `${g.name} is at "${g.stage}"; only a game that is ready can be marked live`);
    const row = pubGame(D.updateGame(db, g.slug, { stage: 'live' }));
    postMessage({ role: 'lead', from: 'system', text: `${g.name} is live (marked by the owner).` });
    return row;
  });

  // ---- publish gate: the irreversible, human-only acts. Two steps; HQ never calls Roblox to publish. ----
  const GATE_CHECKLIST = [
    { id: 'phone', label: 'I played this version on a real phone' },
    { id: 'store-page', label: 'I checked the store page: icon, thumbnails and description' },
    { id: 'policy', label: 'I read the monetization policy and the shop copy' },
  ];
  const challenges = new Map(); // challengeId -> {game, action, expiresAt, tries}
  const gateView = (slug) => {
    const g = D.getGame(db, slug); const d = D.getGateData(db, slug);
    return { stage: g.stage, isPublic: g.isPublic, publicSinceUtc: g.publicSinceUtc, checklist: GATE_CHECKLIST.map((i) => ({ ...i, done: !!d.checklist[i.id] })), adNotes: d.adNotes };
  };
  route('GET', /^\/api\/games\/([^/]+)\/gate$/, ({ m }) => gateView(needGame(m[1]).slug));

  route('POST', /^\/api\/games\/([^/]+)\/gate\/checklist$/, ({ m, body }) => {
    const g = needGame(m[1]);
    if (!isObj(body) || typeof body.done !== 'boolean') throw bad('id and done are required');
    const id = oneOf(body.id, 'id', GATE_CHECKLIST.map((i) => i.id), { required: true });
    const d = D.getGateData(db, g.slug);
    D.setGateData(db, g.slug, { ...d, checklist: { ...d.checklist, [id]: body.done } });
    return gateView(g.slug);
  });

  // advisory only: ad money is spent in Roblox by the owner; HQ just keeps their note
  route('POST', /^\/api\/games\/([^/]+)\/ad-note$/, ({ m, body }) => {
    const g = needGame(m[1]);
    if (!isObj(body)) throw bad('body must be an object');
    const d = D.getGateData(db, g.slug);
    const adNotes = [{ note: str(body.note, 'note', { max: 2000, required: true }), at: nowIso() }, ...d.adNotes].slice(0, 50);
    D.setGateData(db, g.slug, { ...d, adNotes });
    return { adNotes };
  });

  // step 1: open a confirmation. It changes nothing and lasts 2 minutes.
  route('POST', /^\/api\/games\/([^/]+)\/gate\/start$/, ({ m, body }) => {
    const g = needGame(m[1]);
    if (!isObj(body)) throw bad('body must be an object');
    const action = oneOf(body.action, 'action', ['live', 'public'], { required: true });
    if (action === 'live' && g.stage !== 'ready') throw new HttpError(409, `${g.name} is at "${g.stage}"; only a game that is ready can go live`);
    if (action === 'public' && D.STAGES.indexOf(g.stage) < D.STAGES.indexOf('ready')) throw new HttpError(409, `${g.name} is at "${g.stage}"; it must be ready before it goes public`);
    for (const [k, c] of challenges) if (c.expiresAt <= now()) challenges.delete(k);
    const challengeId = `c_${crypto.randomBytes(6).toString('hex')}`;
    const expiresAt = now() + 2 * 60000;
    challenges.set(challengeId, { game: g.slug, action, expiresAt, tries: 0 });
    return { challengeId, expiresAt: new Date(expiresAt).toISOString() };
  });

  // step 2: type the game slug to apply it. One challenge, one use.
  route('POST', /^\/api\/games\/([^/]+)\/gate\/confirm$/, ({ m, body }) => {
    const g = needGame(m[1]);
    if (!isObj(body)) throw bad('body must be an object');
    const c = typeof body.challengeId === 'string' ? challenges.get(body.challengeId) : null;
    if (!c || c.game !== g.slug) throw new HttpError(404, 'no such confirmation (start again)');
    if (c.expiresAt <= now()) { challenges.delete(body.challengeId); throw new HttpError(410, 'the confirmation expired (start again)'); }
    if (body.typed !== g.slug) {
      if (++c.tries >= 5) challenges.delete(body.challengeId);
      throw bad(`type the game slug "${g.slug}" exactly`);
    }
    challenges.delete(body.challengeId);
    if (c.action === 'live') {
      if (g.stage !== 'ready') throw new HttpError(409, `${g.name} is at "${g.stage}", not ready`);
      const row = pubGame(D.updateGame(db, g.slug, { stage: 'live' }));
      postMessage({ role: 'lead', from: 'system', text: `${g.name} is live (confirmed by the owner at the publish gate).` });
      return { action: 'live', game: row };
    }
    const row = pubGame(D.setGamePublic(db, g.slug, nowIso()));
    postMessage({ role: 'lead', from: 'system', text: `${g.name} was set public by the owner.` });
    return { action: 'public', game: row };
  });

  const liveView = (g) => {
    const latest = D.latestGameSnapshot(db, g.slug);
    const stored = D.latestMetrics(db, g.slug);
    const metrics = Object.fromEntries(Object.keys(METRICS).map((k) => [k, stored[k]?.value ?? null]));
    metrics.likeRatio = latest && latest.up != null && latest.up + latest.down > 0 ? latest.up / (latest.up + latest.down) : null;
    // the game's own numbers (aggregates read from its DataStore) fill the metrics the public API cannot give
    const rows = D.listGameStats(db, g.slug);
    const live = rows.find((r) => r.key === 'live')?.json ?? null;
    const days = rows.filter((r) => r.key.startsWith('day-') && r.json).map((r) => ({ date: r.key.slice(4), ...r.json }));
    const stats = liveStatsView(days, live, now());
    for (const [k, v] of Object.entries(stats?.metrics ?? {})) if (v != null && k in metrics) metrics[k] = v;
    return {
      latest, series: D.gameSeries(db, g.slug, new Date(now() - 30 * 86400000).toISOString()), metrics, live, days, stats,
      metricDates: Object.fromEntries(Object.entries(stored).map(([k, v]) => [k, v.date])), targets: TARGETS, attention: D.gameAsksBy(db, g.slug, 'liveops'),
    };
  };
  route('GET', /^\/api\/games\/([^/]+)\/live$/, ({ m }) => liveView(needGame(m[1])));

  // Public numbers (needs the game to be public) and the game's own DataStore aggregates (needs Open Cloud). Both optional.
  const ocFor = (g) => { const oc = readOpenCloud(); return oc && g.universeId === oc.universeId ? oc : null; };
  async function refreshGameLive(g) {
    const errors = []; let ok = false;
    if (g.universeId) {
      try { D.addGameSnapshot(db, g.slug, await fetchLive(g.universeId), nowIso()); ok = true; } catch (e) { errors.push(`Roblox live numbers failed: ${e.message}`); }
    }
    const oc = ocFor(g);
    if (oc) {
      try {
        const dates = Array.from({ length: 14 }, (_, i) => new Date(now() - i * 86400000).toISOString().slice(0, 10));
        const got = await fetchLiveStats({ apiKey: oc.apiKey, universeId: oc.universeId, dates });
        if (got?.live) D.saveGameStat(db, g.slug, 'live', got.live, nowIso());
        for (const [date, v] of Object.entries(got?.days ?? {})) if (v && /^\d{4}-\d{2}-\d{2}$/.test(date)) D.saveGameStat(db, g.slug, `day-${date}`, v, nowIso());
        ok = true;
      } catch (e) { errors.push(`Open Cloud stats failed: ${String(e.message).split(oc.apiKey).join('[key]')}`); }
    }
    return { ok, errors };
  }
  route('POST', /^\/api\/games\/([^/]+)\/live\/refresh$/, async ({ m }) => {
    const g = needGame(m[1]);
    if (!g.universeId && !ocFor(g)) throw bad('set a universe id for this game first');
    const r = await refreshGameLive(g);
    if (!r.ok) throw new HttpError(502, r.errors.join('; '));
    emit('game', gameRow(g));
    return { ...liveView(g), errors: r.errors };
  });

  route('POST', /^\/api\/games\/([^/]+)\/metrics$/, ({ m, body, who, headers }) => {
    const g = needGame(m[1]);
    if (!isObj(body)) throw bad('body must be an object');
    if (who === 'agent') agentTask(body, ['liveops'], headers);
    const key = oneOf(body.key, 'key', Object.keys(METRICS), { required: true });
    if (typeof body.value !== 'number' || !Number.isFinite(body.value) || body.value < 0 || body.value > METRICS[key]) throw bad(`value must be a number 0..${METRICS[key]}`);
    const date = str(body.date, 'date', { max: 10 }) ?? nowIso().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('date must be YYYY-MM-DD');
    const source = who === 'agent' ? 'liveops' : 'owner';
    D.setMetric(db, g.slug, key, body.value, date, source);
    return { ok: true, metrics: liveView(g).metrics };
  });

  route('GET', /^\/api\/freshness$/, () => {
    let assetLibrary = null;
    try { assetLibrary = fs.statSync(path.join(HERE, 'assets.json')).mtime.toISOString(); } catch { /* no index yet */ }
    return {
      marketCharts: D.latestMarketSnapshots(db, 1)[0]?.fetchedAt ?? null, breakouts: D.getSetting(db, 'breakoutsAt', null),
      liveNumbers: D.latestSnapshotAt(db), assetLibrary, games: Object.fromEntries(D.listGames(db).map((g) => [g.slug, g.updatedAt])),
    };
  });

  // screenshots pasted by the owner: png/jpeg/webp, checked by content, saved under .agent-hq/media/uploads/
  const MAGIC = {
    'image/png': { ext: 'png', ok: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
    'image/jpeg': { ext: 'jpg', ok: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    'image/webp': { ext: 'webp', ok: (b) => b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  };
  route('POST', /^\/api\/uploads$/, ({ body }) => {
    if (!isObj(body)) throw bad('body must be an object');
    const name = (str(body.name, 'name', { max: 200, required: true }).split(/[\\/]/).pop().replace(/[^\w.-]+/g, '_') || 'image').slice(0, 80);
    const kind = MAGIC[oneOf(body.mime, 'mime', Object.keys(MAGIC), { required: true })];
    if (typeof body.dataBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.dataBase64)) throw bad('dataBase64 must be base64');
    if (body.dataBase64.length > Math.ceil(UPLOAD_MAX / 3) * 4) throw bad('image is larger than 5 MB');
    const buf = Buffer.from(body.dataBase64, 'base64');
    if (buf.length > UPLOAD_MAX) throw bad('image is larger than 5 MB');
    if (!kind.ok(buf)) throw bad('file content does not match its type');
    const rel = `uploads/${crypto.randomBytes(6).toString('hex')}.${kind.ext}`;
    fs.mkdirSync(path.join(stateDir, 'media', 'uploads'), { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'media', rel), buf);
    return { path: rel, name, bytes: buf.length };
  }, { maxBody: 8 * 1024 * 1024 });
  // pitches
  const normalize = (input) => {
    try { return normalizePitch(input); } catch (e) { throw new HttpError(e.status ?? 400, e.message); }
  };
  // the stored fields of a pitch row, ready to merge with edits and normalize again
  const pitchFields = (p) => Object.fromEntries(Object.entries(p).filter(([k]) => !['id', 'state', 'createdAt', 'decidedAt', 'note', 'coreLoop'].includes(k)));
  const pubPitch = (p) => { emit('pitch', p); return p; };

  route('GET', /^\/api\/pitches$/, () => D.listPitches(db));

  route('POST', /^\/api\/pitches$/, ({ body, who, headers }) => {
    if (who === 'agent') agentTask(body, ['scout'], headers);
    const data = normalize(body);
    // the scout answering an owner idea fills in the waiting "evaluating" pitch instead of adding a second one
    const waiting = data.origin === 'owner' ? D.listPitches(db).find((x) => x.state === 'evaluating' && x.title === data.title) : null;
    if (waiting) return pubPitch(D.updatePitch(db, waiting.id, { state: 'proposed', data }));
    return pubPitch(D.createPitch(db, { title: data.title, oneLiner: data.oneLiner, origin: data.origin, state: 'proposed', data }));
  });

  route('POST', /^\/api\/pitches\/ideas$/, ({ body }) => {
    if (!isObj(body)) throw bad('body must be an object');
    const title = str(body.title, 'title', { max: 200, required: true });
    const idea = str(body.idea, 'idea', { max: 2000, required: true });
    const data = normalize({ title, oneLiner: idea.slice(0, 500), origin: 'owner', game: { howItPlays: idea } });
    const p = pubPitch(D.createPitch(db, { title, oneLiner: data.oneLiner, origin: 'owner', state: 'evaluating', data }));
    queueTask({ title: `Evaluate owner idea: ${title}`.slice(0, 200), role: 'scout', createdBy: 'owner',
      body: `The owner has an idea: "${title}"\n\n${idea}\n\nCheck it against the charts and comparables. Then post the full pitch with hq_pitch (set origin to "owner" and keep this exact title) so the owner can decide.`,
    });
    return p;
  });

  route('POST', /^\/api\/pitches\/([^/]+)\/decide$/, ({ m, body }) => {
    const before = PITCH_ID.test(m[1]) ? D.getPitch(db, m[1]) : null;
    if (!before) throw new HttpError(404, 'pitch not found');
    if (!isObj(body)) throw bad('body must be an object');
    let state = oneOf(body.state, 'state', ['approved', 'changes', 'declined', 'rejected'], { required: true });
    if (state === 'rejected') state = 'declined';
    if (!['proposed', 'evaluating', 'changes'].includes(before.state)) throw new HttpError(409, `pitch is already ${before.state}`);
    const note = str(body.note, 'note', { max: 2000, required: state === 'changes' }) ?? null;
    let data;
    if (body.edits !== undefined && body.edits !== null) {
      if (!isObj(body.edits)) throw bad('edits must be an object');
      if (before.format !== undefined || before.game) data = normalize({ ...pitchFields(before), ...body.edits });
    }
    const p = pubPitch(D.decidePitch(db, before.id, state, { note, data }));
    if (state === 'approved') {
      for (const w of D.withdrawOpenPitches(db, p.id)) pubPitch(w);
      const facts = [
        `One-liner: ${p.oneLiner}`, p.edge && `Edge: ${p.edge}`, p.game?.howItPlays && `How it plays: ${p.game.howItPlays}`,
        p.evidence?.summary && `Evidence: ${p.evidence.summary}`, p.risks?.length && `Risks: ${[].concat(p.risks).join('; ')}`,
      ].filter(Boolean).join('\n');
      queueTask({ title: `Plan pitch: ${p.title}`.slice(0, 200), role: 'lead', createdBy: 'owner', body: `The owner approved this pitch. Plan it.\n\n${facts}`.slice(0, 20000) });
    } else if (state === 'changes') {
      queueTask({ title: `Revise pitch: ${p.title}`.slice(0, 200), role: 'scout', createdBy: 'owner', body: `The owner asked for changes to the pitch "${p.title}":\n\n${note}\n\nPost the revised pitch with hq_pitch (same title, origin "${p.origin}").` });
    }
    return p;
  });

  // settings
  route('GET', /^\/api\/settings$/, () => settingsAll());
  route('GET', /^\/api\/settings\/schema$/, () => SETTINGS_SCHEMA);
  route('GET', /^\/api\/playbook$/, () => loadPlaybook());
  route('GET', /^\/api\/roles$/, () => rolesMerged());
  route('POST', /^\/api\/roles\/([^/]+)$/, ({ m, body }) => {
    if (!roleIds.includes(m[1])) throw new HttpError(404, 'role not found');
    overrides.set(m[1], body);
    const role = rolesMerged().find((r) => r.id === m[1]);
    emit('role', role);
    return role;
  });

  // model catalogue for the per-role pickers; refresh re-reads the providers' live lists
  route('GET', /^\/api\/models$/, () => catalog.get());
  route('POST', /^\/api\/models\/refresh$/, async () => { await catalog.refreshAll(); return catalog.get(); });
  route('POST', /^\/api\/models\/test$/, async ({ body }) => {
    if (!isObj(body)) throw bad('body must be an object');
    const provider = oneOf(body.provider, 'provider', PROVIDER_IDS, { required: true });
    const model = str(body.model, 'model', { max: 120, required: true });
    const key = readProviders()[provider]?.apiKey;
    if (!key) throw bad(`add a ${PROVIDERS[provider].label} key first`);
    try { return await testModel({ provider, key, model, fetchFn: fetchers.models ?? fetch }); } catch (e) { return { ok: false, error: String(e.message ?? e).slice(0, 300) }; }
  });

  route('POST', /^\/api\/settings$/, async ({ body }) => {
    if (!isObj(body) || typeof body.key !== 'string') throw bad('key and value are required');
    if (body.key === 'providers') {
      // {id, apiKey} saves a key, {id, apiKey: null} removes it; the key is written to .agent-hq/providers.json only
      const v = body.value;
      if (!isObj(v)) throw bad('providers must be {id, apiKey}');
      const id = oneOf(v.id, 'id', PROVIDER_IDS, { required: true });
      const all = readProviders();
      if (v.apiKey === null) delete all[id];
      else {
        const apiKey = typeof v.apiKey === 'string' ? v.apiKey.trim() : '';
        if (!keyLooksOk(apiKey)) throw bad(`that does not look like a ${PROVIDERS[id].label} key`);
        all[id] = { apiKey };
      }
      fs.writeFileSync(provFile, JSON.stringify(all), { mode: 0o600 });
      await catalog.refresh(id);
      const value = settingsAll().providers;
      emit('settings', { key: 'providers', value });
      return { key: 'providers', value, models: catalog.get()[id] };
    }
    if (body.key === 'openCloud') {
      // write-only: the key goes to .agent-hq/opencloud.json and is never read back through any route
      const v = body.value;
      if (v === null) { try { fs.unlinkSync(ocFile); } catch { /* none */ } } else {
        if (!isObj(v)) throw bad('openCloud must be {apiKey, universeId}');
        const apiKey = typeof v.apiKey === 'string' ? v.apiKey.trim() : '';
        if (apiKey.length < 16 || apiKey.length > 600 || /\s/.test(apiKey)) throw bad('apiKey does not look like an Open Cloud key');
        const universeId = String(v.universeId ?? '').trim();
        if (!/^\d{1,15}$/.test(universeId)) throw bad('universeId must be digits');
        fs.writeFileSync(ocFile, JSON.stringify({ apiKey, universeId }), { mode: 0o600 });
        // the live numbers belong to the game with this universe id; claim it for the first game that has none
        if (!D.listGames(db).some((g) => g.universeId === universeId)) {
          const target = (v.game && D.getGame(db, String(v.game))) || D.listGames(db).find((g) => !g.universeId) || D.listGames(db)[0];
          if (target && (!target.universeId || v.game)) pubGame(D.updateGame(db, target.slug, { universeId }));
        }
      }
      const value = { configured: !!readOpenCloud() };
      emit('settings', { key: 'openCloud', value });
      return { key: 'openCloud', value };
    }
    const value = validateSetting(body.key, body.value, roleIds);
    D.setSetting(db, body.key, value);
    if (body.key === 'knowledgeLihfolk' || body.key === 'knowledgeReferences') rebuildKnowledge();
    emit('settings', { key: body.key, value });
    return { key: body.key, value };
  });

  const setPaused = (paused) => {
    D.setSetting(db, 'paused', paused);
    emit('settings', { key: 'paused', value: paused });
    return { ok: true, paused };
  };
  route('POST', /^\/api\/pause$/, () => setPaused(true));
  route('POST', /^\/api\/resume$/, () => setPaused(false));

  // market
  const { refreshMarket } = mountMarket(route, { db, fetchers, fetchCharts, now, nowIso, HttpError }); // GET /api/market, /api/market/games/:id, POST /api/market/refresh
  mountIdeas(route, { db, str, bad, isObj, agentTask, queueTask, HttpError }); // Score my idea: /api/idea-scores
  const buildKnowledge = () => {
    const s = settingsAll();
    const env = { ...process.env, ...(s.knowledgeLihfolk && { HQ_LIHFOLK_VAULT: s.knowledgeLihfolk }), ...(s.knowledgeReferences && { HQ_REFERENCES: s.knowledgeReferences }) };
    return createKnowledge({ root, stateDir, env });
  };
  let kn = knowledgeOpt ?? buildKnowledge();
  rebuildKnowledge = () => { if (!knowledgeOpt) kn = buildKnowledge(); };
  const knowledge = { status: (...a) => kn.status(...a), search: (...a) => kn.search(...a), read: (...a) => kn.read(...a), quarantined: () => kn.quarantined() };
  mountKnowledge(route, knowledge, { bad, HttpError });
  const readiness = createReadiness({ root, knowledge, getRoles: rolesMerged, now, ...readinessOpts });
  route('GET', /^\/api\/readiness$/, () => readiness());
  const play = createPlay({ root, stateDir, ...playOpts });
  route('POST', /^\/api\/games\/([^/]+)\/play$/, ({ m }) => play(needGame(m[1]).slug)); mountOpenStudio(route, { play, needGame, agentTask, roleOf, HttpError, now });
  const nb = mountNotebook(route, { db, str, bad, isObj, agentTask, gameSlugs, emit, getDoc: () => settingsAll().notebookDoc, HttpError, stateDir, touchLane, now }); // /api/notebook // GET /api/knowledge/status, /search, /read

  // title patterns across everything on the charts right now
  route('GET', /^\/api\/market\/titles$/, () => {
    const titles = [...new Set((D.latestMarketSnapshots(db, 1)[0]?.sorts ?? []).flatMap((x) => x.games.map((g) => g.name)))];
    return titleAnalysis(titles);
  });

  // background refresh: market data every `marketEveryHours` (0 = off) and live numbers every 15 minutes when Open Cloud is set
  const lastLive = new Map();
  async function runTimers() {
    const hours = settingsAll().marketEveryHours;
    const last = D.getSetting(db, 'marketAttemptAt', null);
    if (hours > 0 && (!last || now() - Date.parse(last) >= hours * 3600000)) await refreshMarket().catch(() => {});
    const oc = readOpenCloud();
    if (oc) {
      for (const g of D.listGames(db).filter((x) => x.universeId === oc.universeId)) {
        if (lastLive.has(g.slug) && now() - lastLive.get(g.slug) < 15 * 60000) continue;
        lastLive.set(g.slug, now());
        await refreshGameLive(g).catch(() => {});
        emit('game', gameRow(g));
      }
    }
  }

  route('GET', /^\/api\/market\/breakouts$/, () => D.getSetting(db, 'breakouts', { rows: [], at: null }));
  route('GET', /^\/api\/market\/benchmarks$/, () => ({ rows: loadBenchmarks() }));

  // corpus: reference games the owner wants to compare against (icons and thumbnails are stored when added)
  route('GET', /^\/api\/market\/corpus$/, () => ({ games: D.getSetting(db, 'corpus', []) }));
  route('POST', /^\/api\/market\/corpus$/, async ({ body }) => {
    if (!isObj(body)) throw bad('body must be an object');
    const universeId = String(body.universeId ?? '').trim();
    if (!/^\d{1,15}$/.test(universeId)) throw bad('universeId must be digits');
    const corpus = D.getSetting(db, 'corpus', []);
    if (corpus.some((g) => g.universeId === universeId)) return { games: corpus };
    if (corpus.length >= 100) throw bad('the corpus is full (100 games)');
    const seen = (D.latestMarketSnapshots(db, 1)[0]?.sorts ?? []).flatMap((x) => x.games).find((g) => String(g.universeId) === universeId);
    const name = str(body.name, 'name', { max: 200 }) || seen?.name || `Universe ${universeId}`;
    const [icons, thumbs] = await Promise.all([fetchers.icons([universeId]).catch(() => ({})), fetchers.thumbnails([universeId]).catch(() => ({}))]);
    const games = [...corpus, { universeId, name, icon: icons[universeId] ?? null, thumbnail: thumbs[universeId] ?? null, addedAt: nowIso() }];
    D.setSetting(db, 'corpus', games);
    return { games };
  });
  route('DELETE', /^\/api\/market\/corpus\/(\d{1,15})$/, ({ m }) => {
    const games = D.getSetting(db, 'corpus', []).filter((g) => g.universeId !== m[1]);
    D.setSetting(db, 'corpus', games);
    return { games };
  });

  // library: assets index, reusable systems catalogue
  route('GET', /^\/api\/assets$/, ({ query }) => {
    const kind = query.get('kind') || undefined;
    if (kind && kind !== 'all' && !ASSET_KINDS.includes(kind)) throw bad(`kind must be all or one of ${ASSET_KINDS.join(', ')}`);
    const scope = query.get('scope') || undefined;
    if (scope && scope !== 'all' && scope !== 'studio' && !/^game:[a-z0-9-]{1,40}$/.test(scope)) throw bad('scope must be all, studio or game:<slug>');
    return listAssetIndex(root, { search: (query.get('search') ?? '').slice(0, 100), kind, scope });
  });
  route('POST', /^\/api\/assets$/, ({ body, who, headers }) => {
    if (!isObj(body)) throw bad('body must be an object');
    if (who === 'agent') agentTask(body, ['librarian'], headers); // only a librarian task, or the owner, adds assets
    try { return addAsset(root, body); } catch (e) { throw new HttpError(e.status ?? 500, e.message); }
  });
  mountCatalog(route, assetCatalog, { str, bad, isObj, agentTask, HttpError });
  route('GET', /^\/api\/systems$/, () => ({ markdown: readSystems(root) }));

  route('GET', /^\/api\/vault$/, () => ({ chapters: parseVault(root) }));

  route('GET', /^\/api\/library$/, () => {
    const skills = [];
    const sdir = path.join(root, '.claude', 'skills');
    let names = [];
    try { names = fs.readdirSync(sdir); } catch { /* none */ }
    for (const n of names) {
      const f = path.join(sdir, n, 'SKILL.md');
      try {
        const fm = frontmatter(fs.readFileSync(f, 'utf8'));
        skills.push({ name: fm.name || n, description: fm.description || '', path: path.relative(root, f).replaceAll('\\', '/') });
      } catch { /* not a skill dir */ }
    }
    return { skills, assets: listAssets(path.join(root, 'assets')) };
  });

  // ---- request handling ----
  const send = (res, status, data, headers = {}) => {
    const buf = Buffer.from(JSON.stringify(data));
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
    res.end(buf);
  };

  function readBody(req, limit = MAX_BODY) {
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers['content-length']);
      if (declared > limit) { req.resume(); return reject(new HttpError(413, 'body too large')); } // drain, so the client can read the 413
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) { reject(new HttpError(413, 'body too large')); chunks.length = 0; return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!size) return resolve(undefined);
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(bad('invalid JSON')); }
      });
      req.on('error', reject);
    });
  }

  function serveFile(res, file, extra = {}) {
    const ext = path.extname(file).toLowerCase();
    const data = fs.readFileSync(file);
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'content-length': data.length, 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache', ...extra });
    res.end(data);
  }

  function serveIndex(res) {
    const file = path.join(publicDir, 'index.html');
    let html;
    try { html = fs.readFileSync(file, 'utf8'); } catch { throw new HttpError(404, 'index.html missing'); }
    // Never embed the owner token: any local process (agents included) can GET this page.
    // The dashboard receives it from the URL fragment (#owner=...), which browsers never send to the server.
    html = html.replace(/<meta\s+name="hq-token"[^>]*>\s*/g, '');
    const buf = Buffer.from(html);
    res.writeHead(200, { 'content-type': MIME['.html'], 'content-length': buf.length, 'cache-control': 'no-store', 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY' });
    res.end(buf);
  }

  function serveMedia(res, rel) {
    // Media only: anything else (tokens, logs, code) never leaves through this unauthenticated route.
    if (!MEDIA_INLINE.has(path.extname(rel).toLowerCase())) throw new HttpError(404, 'not found');
    const tries = [[path.join(stateDir, 'media'), rel]];
    if (rel.startsWith('assets/')) tries.push([path.join(root, 'assets'), rel.slice(7)]);
    tries.push([path.join(root, 'assets'), rel]);
    for (const [base, r] of tries) {
      const f = readFileIn(base, r);
      if (!f) continue;
      // Agent-written files share this origin: only inert media renders inline, everything else downloads.
      const inline = MEDIA_INLINE.has(path.extname(f).toLowerCase());
      return serveFile(res, f, {
        'content-security-policy': "default-src 'none'; sandbox",
        ...(inline ? {} : { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment' }),
      });
    }
    throw new HttpError(404, 'not found');
  }

  function handleSse(req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-content-type-options': 'nosniff' });
    res.write('retry: 2000\n: connected\n\n');
    clients.add(res);
    const beat = setInterval(() => res.write(': ping\n\n'), 25000);
    beat.unref();
    req.on('close', () => { clearInterval(beat); clients.delete(res); });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host;
      if (host !== `127.0.0.1:${boundPort}` && host !== `localhost:${boundPort}`) throw new HttpError(403, 'bad host');
      const url = new URL(req.url, 'http://127.0.0.1');
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw bad('bad path'); }
      if (pathname.includes('\0')) throw bad('bad path');

      if (pathname.startsWith('/api/')) {
        let who = null;
        if (pathname !== '/api/health') {
          const isEvents = pathname === '/api/events' && req.method === 'GET';
          const supplied = isEvents ? url.searchParams.get('token') : req.headers['x-hq-token'];
          who = whoIs(supplied);
          if (!who) throw new HttpError(401, 'missing or bad token');
          if (isEvents) return handleSse(req, res);
          if (who !== 'owner' && OWNER_ONLY.some(([mt, re]) => mt === req.method && re.test(pathname))) throw new HttpError(403, 'owner only');
        }
        for (const [method, re, fn, opts] of routes) {
          const m = re.exec(pathname);
          if (!m || method !== req.method) continue;
          const body = method !== 'GET' ? await readBody(req, opts.maxBody) : undefined;
          return send(res, 200, await fn({ m, body, query: url.searchParams, who, headers: req.headers }));
        }
        throw new HttpError(404, 'not found');
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed');
      if (pathname === '/' || pathname === '/index.html') return serveIndex(res);
      if (pathname.startsWith('/static/')) {
        const f = readFileIn(publicDir, pathname.slice(8));
        if (!f) throw new HttpError(404, 'not found');
        return serveFile(res, f);
      }
      if (pathname.startsWith('/media/')) return serveMedia(res, pathname.slice(7));
      throw new HttpError(404, 'not found');
    } catch (e) {
      const status = e instanceof HttpError || e?.expose ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'internal error' : e.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  boundPort = server.address().port;

  let timer = null;
  if (autoTimers) {
    timer = setInterval(() => runTimers().catch(() => {}), tickMs);
    timer.unref();
    setTimeout(() => runTimers().catch(() => {}), 5000).unref();
    // scrape the providers' model lists at boot and then daily, so the pickers are filled
    catalog.refreshAll().catch(() => {});
    setInterval(() => catalog.refreshAll().catch(() => {}), 86400000).unref();
    setInterval(() => link.poll(), 20000).unref(); setInterval(() => bridge.poll(), 15000).unref();
    assetCatalog.refreshIfOld();
    setInterval(() => assetCatalog.refreshIfOld(), 86400000).unref();
  }
  rn = runnerOwned ? runner({ db, root, emit: hookedEmit, port: boundPort, token, memoryDir, providers: readProviders, briefFor, spendGuard }) : (runner ?? null);
  if (runnerOwned) rn.start?.();

  return {
    server, db, token, ownerToken, port: boundPort, stateDir, runTimers,
    async close() {
      if (timer) clearInterval(timer);
      if (runnerOwned) rn.stop?.();
      for (const c of clients) c.end();
      clients.clear();
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      listeners.delete(bridge.onEvent); db.close();
    },
  };
}

// ---- main ----
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { createRunner } = await import('./runner.mjs');
  const port = Number(process.env.HQ_PORT) || 4317;
  const root = path.resolve(HERE, '../..');
  // The first game in the pipeline comes from agent-hq.settings.json (project.slug / project.name) when set.
  const project = readSettings(root)?.project;
  const seed = typeof project?.slug === 'string' && /^[a-z0-9-]{1,40}$/.test(project.slug)
    ? { slug: project.slug, name: project.name || project.slug, stage: 'designed' } : undefined;
  const s = await startServer({ root, port, runner: (ctx) => createRunner(ctx), autoTimers: true, seed });
  console.log(`Agent HQ on http://127.0.0.1:${s.port} (open it with scripts/Agent HQ.bat or the desktop shortcut to sign in as the owner)`);
  const stop = async () => { await s.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
