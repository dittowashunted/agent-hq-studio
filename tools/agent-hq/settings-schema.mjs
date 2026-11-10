import fs from 'node:fs';
// Settings schema: the one list of every owner setting (key, label, control type, default, section, help).
// The server validates with it and the Settings page renders from it (GET /api/settings/schema).
import crypto from 'node:crypto';
import path from 'node:path';
import { migrateEngine } from './db.mjs';
import { CLAUDE_MODELS } from './providers.mjs';

export class SettingError extends Error {
  constructor(message) { super(message); this.status = 400; this.expose = true; }
}
const bad = (m) => new SettingError(m);
import { defaultRunMode } from './run-mode.mjs';
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

export const ENGINES = ['app', 'antigravity', 'claude-cli', 'echo', 'groq', 'nim'];
export const CLAUDE_ENGINES = new Set(['app', 'claude-cli']); // these take a Claude model alias
export const LANES = ['app', 'antigravity'];
export const DEFAULT_LANE_SCHEDULES = {
  app: { enabled: true, everyMinutes: 60, activeFrom: '00:00', activeTo: '24:00', maxTasks: 8 },
  antigravity: { enabled: true, everyMinutes: 5, activeFrom: '00:00', activeTo: '24:00', maxTasks: 6 },
};
const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;
export const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
export const mergeLaneSchedules = (v) => Object.fromEntries(LANES.map((k) => [k, { ...DEFAULT_LANE_SCHEDULES[k], ...(v?.[k] ?? {}) }]));

// Partner agents (HQ Link / Ditto) may run without a yes only in roles that cannot edit game source.
// Roles a partner may start without the owner: derived from roles.json, never hand-listed. A role qualifies only
// when it cannot edit files, run shells, touch Studio or delegate.
const UNSAFE_TOOL = /^(Edit|Write|NotebookEdit|Bash|PowerShell|mcp__Roblox_Studio)/;
export const PARTNER_AUTO_OK = JSON.parse(fs.readFileSync(new URL('./roles.json', import.meta.url), 'utf8'))
  .filter((r) => r.id !== 'lead' && !r.needsStudio && // the Lead can hand work to every role, so it never runs on a partner's say
     !(r.mcp || []).includes('Roblox_Studio') && !(r.allowedTools || []).some((t) => UNSAFE_TOOL.test(t)))
  .map((r) => r.id);
export const DEFAULT_PARTNER_ACCESS = { enabled: false, autoRoles: [], dailyLimit: 0 }; // off until the owner opts in

export const SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'look', label: 'Look' },
  { id: 'usage', label: 'Usage' },
  { id: 'lanes', label: 'Lanes and schedules' },
  { id: 'engines', label: 'Roles and engines' },
  { id: 'art', label: 'Art' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'notebook', label: 'Notebook' },
  { id: 'integrations', label: 'Connections' },
];

const f = (key, label, type, def, section, help, extra = {}) => ({ key, label, type, default: def, section, help, ...extra });
export const FIELDS = [
  f('ownerName', 'Your name', 'string', '', 'general', 'Shown on your messages and notes.', { max: 40 }),
  f('studioLanes', 'Studio lanes', 'enum', 1, 'general', 'How many tasks may hold Roblox Studio at once.', {
    options: [{ value: 0, label: 'None' }, { value: 1, label: 'One' }, { value: 2, label: 'Two' }, { value: 'all', label: 'All' }],
  }),
  f('marketEveryHours', 'Refresh the market every', 'int', 6, 'general', 'Hours between automatic chart refreshes. 0 turns it off.', { min: 0, max: 48 }),
  f('theme', 'Theme', 'enum', 'dark', 'look', 'Colours for the whole app.', { options: [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }] }),
  f('density', 'Density', 'enum', 'comfortable', 'look', 'Compact fits more rows on screen.', { options: [{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }] }),
  f('runMode', 'Run mode', 'enum', defaultRunMode(), 'usage', 'Instant: agents start on this PC within seconds. Hourly: they wait for the Claude app worker.', { options: [{ value: 'instant', label: 'Instant' }, { value: 'hourly', label: 'Hourly' }] }),
  f('paused', 'Pause all agents', 'bool', false, 'usage', 'Nothing new starts while this is on. Running tasks finish.'),
  f('budget', 'Parallel task slots', 'int', 2, 'usage', 'How many tasks the app lane runs at the same time.', { min: 1, max: 4 }),
  f('dailySpendCap', 'Daily spend cap (USD)', 'number', 0, 'usage', 'Agents pause when today\'s spend reaches this. 0 means no cap. HQ never resumes by itself.', { min: 0, max: 500 }),
  f('replyStyle', 'Agent replies', 'enum', 'terse', 'usage', 'Terse asks agents for short notes: facts, paths, numbers.', { options: [{ value: 'terse', label: 'Terse' }, { value: 'normal', label: 'Normal' }] }),
  f('ponytailMode', 'Code style (ponytail)', 'enum', 'full', 'usage', 'Lazy-senior coding rules. Claude engines load the ponytail plugin; other engines get the rules in their brief.', { options: [{ value: 'off', label: 'Off' }, { value: 'lite', label: 'Lite' }, { value: 'full', label: 'Full' }, { value: 'ultra', label: 'Ultra' }] }),
  f('screenshotCap', 'Screenshots per task', 'int', 4, 'usage', 'The most screenshots one agent should take. 0 means none.', { min: 0, max: 12 }),
  f('cheapLookups', 'Cheap vault lookups', 'bool', true, 'usage', 'Claude agents look things up in the vault through a small model.'),
  f('batchByRole', 'Batch by role', 'bool', true, 'usage', 'A worker takes the next task of the role it just ran, so its context is reused.'),
  f('laneSchedules', 'Lane schedules', 'custom', DEFAULT_LANE_SCHEDULES, 'lanes', 'When each lane may run, how often, and how many tasks per run.'),
  f('schedules', 'Recurring tasks', 'custom', [], 'lanes', 'Tasks HQ creates on a timer.'),
  f('roleEngines', 'Engine and model per role', 'custom', {}, 'engines', 'Which engine and model each role runs on.'),
  f('artAutoRoute', 'Send art to Antigravity', 'bool', true, 'art', 'Icon, thumbnail, ad and key-art tasks go to the Antigravity lane when it is on.'),
  f('blenderFallback', 'Allow Blender', 'bool', false, 'art', 'Agents may open Blender for 3D only after the catalog and Claude Design fail.'),
  f('modelRefFirst', 'Find references before 3D work', 'bool', true, 'art', 'A designer finds pictures from several angles before any 3D model is built.'),
  f('modelRefApproval', 'References approval', 'enum', 'ask', 'art', 'Wait for your OK on the reference sheet, or start the build as soon as the sheet is done.', { options: [{ value: 'ask', label: 'Wait for my OK' }, { value: 'auto', label: 'Go ahead on its own' }] }),
  f('modelRefLane', 'References lane', 'enum', 'antigravity', 'art', 'Antigravity makes the sheet there. ChatGPT runs it on the app lane and uses a ChatGPT image tool when one is connected.', { options: [{ value: 'antigravity', label: 'Antigravity' }, { value: 'chatgpt', label: 'ChatGPT' }] }),
  f('knowledgeLihfolk', 'LihFolk vault folder', 'string', '', 'knowledge', 'Absolute path. Empty uses the default location.', { max: 300 }),
  f('knowledgeReferences', 'References folder', 'string', '', 'knowledge', 'Absolute path. Empty uses the default location.', { max: 300 }),
  f('notebookDoc', 'Notebook Google Doc', 'string', '', 'notebook', 'Link to a Google Doc to mirror notebook entries. Empty means not linked.', { max: 300 }),
  f('partnerAccess', 'Partner agents', 'custom', DEFAULT_PARTNER_ACCESS, 'integrations', 'Which of your agents Ditto may use without asking each time, and how many tasks a day.'),
  f('providers', 'API keys', 'custom', {}, 'integrations', 'Groq and NVIDIA NIM keys. Write-only.'),
  f('openCloud', 'Open Cloud', 'custom', {}, 'integrations', 'Reads live game numbers. Write-only.'),
];
export const SETTINGS_SCHEMA = { sections: SECTIONS, fields: FIELDS };

// keys the server computes instead of storing
const COMPUTED = new Set(['providers', 'openCloud']);
export const DEFAULT_SETTINGS = Object.fromEntries(FIELDS.filter((x) => !COMPUTED.has(x.key)).map((x) => [x.key, x.default]));

const noControl = (s) => !/[\u0000-\u001f\u007f]/.test(s);
const STRING_CHECKS = {
  knowledgeLihfolk: (s) => noControl(s) && path.isAbsolute(s),
  knowledgeReferences: (s) => noControl(s) && path.isAbsolute(s),
  notebookDoc: (s) => /^https:\/\/docs\.google\.com\/document\/d\/[\w-]+(?:[/?#][^\s]*)?$/.test(s),
};
const STRING_ERRORS = {
  knowledgeLihfolk: 'must be an absolute folder path',
  knowledgeReferences: 'must be an absolute folder path',
  notebookDoc: 'must be a https://docs.google.com/document/d/... link',
};

function validateField(fd, value) {
  const k = fd.key;
  switch (fd.type) {
    case 'bool':
      if (typeof value !== 'boolean') throw bad(`${k} must be a boolean`);
      return value;
    case 'int':
      if (!Number.isInteger(value) || value < fd.min || value > fd.max) throw bad(`${k} must be an integer ${fd.min}..${fd.max}`);
      return value;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value) || value < fd.min || value > fd.max) throw bad(`${k} must be a number ${fd.min}..${fd.max}`);
      return Math.round(value * 100) / 100;
    case 'enum':
      if (!fd.options.some((o) => o.value === value)) throw bad(`${k} must be one of ${fd.options.map((o) => (typeof o.value === 'string' ? `"${o.value}"` : o.value)).join(', ')}`);
      return value;
    case 'string': {
      if (typeof value !== 'string') throw bad(`${k} must be a string`);
      const v = value.trim();
      if (v.length > fd.max) throw bad(`${k} is too long (max ${fd.max})`);
      if (!noControl(v)) throw bad(`${k} has control characters`);
      if (v && STRING_CHECKS[k] && !STRING_CHECKS[k](v)) throw bad(`${k} ${STRING_ERRORS[k]}`);
      return v;
    }
    default:
      throw bad(`unknown setting ${k}`);
  }
}

const str = (v, name, { max, required = false } = {}) => {
  if (v === undefined || v === null) { if (required) throw bad(`${name} is required`); return undefined; }
  if (typeof v !== 'string') throw bad(`${name} must be a string`);
  const s = v.trim();
  if (required && !s) throw bad(`${name} is too short`);
  if (s.length > max) throw bad(`${name} is too long (max ${max})`);
  return s;
};
const oneOf = (v, name, list) => { if (!list.includes(v)) throw bad(`${name} must be one of ${list.join(', ')}`); return v; };
const intIn = (v, name, lo, hi) => { if (!Number.isInteger(v) || v < lo || v > hi) throw bad(`${name} must be an integer ${lo}..${hi}`); return v; };

function validateCustom(key, value, roleIds) {
  switch (key) {
    case 'roleEngines': {
      if (!isObj(value)) throw bad('roleEngines must be an object');
      const out = {};
      for (const [r, v] of Object.entries(value)) {
        if (!roleIds.includes(r)) throw bad(`unknown role ${r}`);
        if (!isObj(v)) throw bad('roleEngines entries must be objects');
        const engine = oneOf(migrateEngine(v.engine), 'engine', ENGINES);
        let model = str(v.model, 'model', { max: 120 }) || null;
        if (model && CLAUDE_ENGINES.has(engine) && !CLAUDE_MODELS.includes(model)) throw bad(`model for ${r} must be one of ${CLAUDE_MODELS.join(', ')}`);
        if (model && !/^[\w./:-]+$/.test(model)) throw bad(`model for ${r} has odd characters`);
        if (engine === 'antigravity' || engine === 'echo') model = null;
        out[r] = { engine, model };
      }
      return out;
    }
    case 'schedules': {
      if (!Array.isArray(value) || value.length > 50) throw bad('schedules must be an array of up to 50');
      return value.map((s) => {
        if (!isObj(s)) throw bad('schedule must be an object');
        return {
          id: str(s.id, 'schedule.id', { max: 64 }) ?? `s_${crypto.randomBytes(6).toString('hex')}`,
          role: oneOf(s.role, 'schedule.role', roleIds),
          title: str(s.title, 'schedule.title', { max: 200, required: true }),
          body: str(s.body, 'schedule.body', { max: 20000 }) ?? '',
          everyMinutes: intIn(s.everyMinutes, 'everyMinutes', 1, 525600),
          enabled: !!s.enabled,
          lastRunAt: typeof s.lastRunAt === 'string' ? s.lastRunAt.slice(0, 40) : null,
        };
      });
    }
    case 'laneSchedules': {
      if (!isObj(value)) throw bad('laneSchedules must be an object');
      const out = {};
      for (const k of LANES) {
        const v = { ...DEFAULT_LANE_SCHEDULES[k], ...(value[k] ?? {}) };
        if (typeof v.enabled !== 'boolean') throw bad(`${k}.enabled must be a boolean`);
        for (const fl of ['activeFrom', 'activeTo']) if (typeof v[fl] !== 'string' || !HHMM.test(v[fl])) throw bad(`${k}.${fl} must be HH:MM (00:00..24:00)`);
        out[k] = { enabled: v.enabled, everyMinutes: intIn(v.everyMinutes, `${k}.everyMinutes`, 5, 1440), activeFrom: v.activeFrom, activeTo: v.activeTo, maxTasks: intIn(v.maxTasks, `${k}.maxTasks`, 1, 20) };
      }
      return out;
    }
    case 'partnerAccess': {
      if (!isObj(value)) throw bad('partnerAccess must be an object');
      const v = { ...DEFAULT_PARTNER_ACCESS, ...value };
      if (typeof v.enabled !== 'boolean') throw bad('partnerAccess.enabled must be a boolean');
      if (!Array.isArray(v.autoRoles) || v.autoRoles.length > 20) throw bad('partnerAccess.autoRoles must be a list of role ids');
      for (const r of v.autoRoles) {
        if (!roleIds.includes(r)) throw bad(`unknown role ${r}`);
        if (!PARTNER_AUTO_OK.includes(r)) throw bad(`${r} can change game files, so it cannot run on a partner's request without your OK`);
      }
      return { enabled: v.enabled, autoRoles: [...new Set(v.autoRoles)], dailyLimit: intIn(v.dailyLimit, 'partnerAccess.dailyLimit', 0, 50) };
    }
    default:
      throw bad(`unknown setting ${key}`);
  }
}

const BY_KEY = new Map(FIELDS.map((x) => [x.key, x]));
/** Validate one setting and return the value to store. Throws SettingError (status 400). */
export function validateSetting(key, value, roleIds = []) {
  const fd = BY_KEY.get(key);
  if (!fd || COMPUTED.has(key)) throw bad(`unknown setting ${key}`);
  return fd.type === 'custom' ? validateCustom(key, value, roleIds) : validateField(fd, value);
}
