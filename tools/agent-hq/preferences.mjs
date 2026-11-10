// Standing owner preferences: memory/<role>.prefs.md, and memory/studio.prefs.md for every role.
// They carry the owner's authority like corrections do, but they are rules to keep, not notes on one piece of work.
// Ways in: the owner's own Lessons drawer, or an agent PROPOSAL (hq_preferences_propose) that becomes a decision ask;
// only the owner's "Save" writes anything. After 5 owner corrections for a role, one cheap Lead task is queued to distill them.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mountCorrections, readCorrections } from './corrections.mjs';
import { mountResearch } from './research-notes.mjs';

export const STUDIO = 'studio';
export const PREF_CAP = 30;
export const PREF_TEXT_MAX = 200;
export const PROPOSAL_MAX_ITEMS = 8;
export const DISTILL_AFTER = 5;
export const LEARNING_OWNER_ONLY = [['POST', /^\/api\/memory\/[^/]+\/preferences$/], ['DELETE', /^\/api\/memory\/[^/]+\/preferences\/[^/]+$/]];

const LINE = /^- (\d{4}-\d{2}-\d{2}) \| (.+)$/;
const fileOf = (memoryDir, role) => path.join(memoryDir, `${role}.prefs.md`);
const idOf = (text) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 10);
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Oldest first: [{ id, date, text }]. */
export function readPrefs(memoryDir, role) {
  let text = '';
  try { text = fs.readFileSync(fileOf(memoryDir, role), 'utf8'); } catch { return []; }
  return text.split(/\r?\n/).map((l) => LINE.exec(l.trim())).filter(Boolean).map(([, date, body]) => ({ id: idOf(body), date, text: body }));
}

function write(memoryDir, role, list) {
  fs.mkdirSync(memoryDir, { recursive: true });
  const head = `# Standing owner preferences for ${role} (written by Agent HQ; only the owner adds or removes them)\n`;
  fs.writeFileSync(fileOf(memoryDir, role), head + list.map((p) => `- ${p.date} | ${p.text}`).join('\n') + (list.length ? '\n' : ''));
}

/** Adds texts (each one line, up to 200 chars; longer ones are cut). Empty and repeated ones are ignored. Returns { prefs, added }. */
export function addPrefs(memoryDir, role, texts, date) {
  const list = readPrefs(memoryDir, role);
  const have = new Set(list.map((p) => p.text));
  let added = 0;
  for (const t of texts) {
    const text = oneLine(t).slice(0, PREF_TEXT_MAX).trim();
    if (!text || have.has(text)) continue;
    have.add(text); list.push({ id: idOf(text), date, text }); added++;
  }
  const next = list.slice(-PREF_CAP);
  if (added) write(memoryDir, role, next);
  return { prefs: next, added };
}

/** Removes one preference by id. Returns the new list, or null when there is no such one. */
export function deletePref(memoryDir, role, id) {
  const list = readPrefs(memoryDir, role);
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) return null;
  write(memoryDir, role, next);
  return next;
}

/** Studio preferences first, then the role's own, newest last. Used by briefs. */
export const prefsFor = (memoryDir, role) => [...readPrefs(memoryDir, STUDIO), ...(role === STUDIO ? [] : readPrefs(memoryDir, role))];

/** Checks an agent's proposed items: 1 to 8 strings of at most 200 characters. Returns the cleaned, de-duplicated list. */
export function cleanItems(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('items must be a non-empty list of strings');
  if (items.length > PROPOSAL_MAX_ITEMS) throw new Error(`send at most ${PROPOSAL_MAX_ITEMS} items`);
  const out = [];
  for (const it of items) {
    const t = oneLine(typeof it === 'string' ? it : '');
    if (!t) throw new Error('every item must be a non-empty string');
    if (t.length > PREF_TEXT_MAX) throw new Error(`each item must be ${PREF_TEXT_MAX} characters or fewer`);
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * Mounts: GET/POST /api/memory/:role/preferences and DELETE .../:id (owner only; role may be "studio"), POST /api/preferences/propose
 * (agent task token), the correction delete route, and research notes. Returns { answered(ask, answer), noted(role) } for the server hooks.
 * c: { db, D, emit, memoryDir, stateDir, roleIds, roleLabel, queueTask, nowIso, str, bad, isObj, agentTask, HttpError, onNoteSaved }
 */
export function mountLearning(route, c) {
  const { db, D, emit, memoryDir, roleIds, roleLabel, queueTask, nowIso, str, bad, isObj, agentTask, HttpError } = c;
  mountCorrections(route, { memoryDir, roleIds, HttpError });
  mountResearch(route, c);
  const target = (v) => { if (v !== STUDIO && !roleIds.includes(v)) throw bad('role must be "studio" or a known role id'); return v; };
  const label = (r) => (r === STUDIO ? 'the whole studio' : roleLabel(r));
  const today = () => nowIso().slice(0, 10);

  route('GET', /^\/api\/memory\/([^/]+)\/preferences$/, ({ m }) => ({ preferences: readPrefs(memoryDir, target(m[1])) }));
  route('POST', /^\/api\/memory\/([^/]+)\/preferences$/, ({ m, body }) => {
    const role = target(m[1]);
    if (!isObj(body)) throw bad('body must be an object');
    const text = str(body.text, 'text', { max: PREF_TEXT_MAX, required: true });
    const r = addPrefs(memoryDir, role, [text], today());
    return { preferences: r.prefs, added: r.added > 0 };
  });
  route('DELETE', /^\/api\/memory\/([^/]+)\/preferences\/([0-9a-f]{10})$/, ({ m }) => {
    const preferences = deletePref(memoryDir, target(m[1]), m[2]);
    if (!preferences) throw new HttpError(404, 'no such preference');
    return { preferences };
  });

  // An agent proposes; the decision ask is the owner's say. Proposals wait in settings until the ask is answered.
  const KEY = 'prefProposals';
  route('POST', /^\/api\/preferences\/propose$/, ({ body, headers }) => {
    if (!isObj(body)) throw bad('body must be an object');
    const t = agentTask(body, undefined, headers);
    const role = target(body.role);
    let items; try { items = cleanItems(body.items); } catch (e) { throw bad(e.message); }
    const ask = D.createAsk(db, {
      taskId: t.id, role: t.role, kind: 'decision', title: `Save these as standing preferences for ${label(role)}?`.slice(0, 200),
      why: `${roleLabel(t.role)} proposes ${items.length === 1 ? 'this rule' : 'these rules'}. Every future brief for ${label(role)} would include ${items.length === 1 ? 'it' : 'them'}, with your authority.\n\n${items.map((i) => `- ${i}`).join('\n')}`,
      options: [{ id: 'save', label: 'Save', recommended: true }, { id: 'not-now', label: 'Not now' }],
    });
    const all = D.getSetting(db, KEY, {});
    const keep = Object.fromEntries(Object.entries(all).slice(-49));
    D.setSetting(db, KEY, { ...keep, [ask.id]: { role, items } });
    emit('ask', ask);
    return { askId: ask.id, items: items.length, note: 'Nothing is saved until the owner answers Save.' };
  });

  /** Hook for the owner's answer to any ask. Writes only for an answered "save" on a proposal HQ made. Always returns false (the normal flow continues). */
  const answered = (ask, answer) => {
    const all = D.getSetting(db, KEY, {});
    const p = all[ask.id];
    if (!p) return false;
    delete all[ask.id];
    D.setSetting(db, KEY, all);
    if (answer === 'save') addPrefs(memoryDir, p.role, p.items, today());
    return false;
  };

  // The 5th owner correction for a role since its last distill queues one cheap Lead task (at most one open per role).
  const noted = (role) => {
    const counts = D.getSetting(db, 'distillCounts', {});
    counts[role] = (counts[role] ?? 0) + 1;
    const title = `Distill owner preferences for ${roleLabel(role)}`;
    const open = D.listTasks(db, { role: 'lead', limit: 200 }).some((t) => t.title === title && (t.state === 'queued' || t.state === 'working'));
    if (counts[role] >= DISTILL_AFTER && !open) {
      counts[role] = 0;
      const notes = readCorrections(memoryDir, role).filter((x) => x.kind === 'correction').slice(-DISTILL_AFTER);
      queueTask({
        title, role: 'lead', model: 'haiku', createdBy: 'owner',
        body: `The owner sent ${roleLabel(role)} (role id: ${role}) work back ${DISTILL_AFTER} times. Their notes, oldest first:\n${notes.map((n) => `- ${n.text}`).join('\n')}\n\n` +
          `Find the rules that should hold for every future task, not one-off fixes. Call hq_preferences_propose { role: "${role}", items: [...] } with at most ${PROPOSAL_MAX_ITEMS} plain instructions of ${PREF_TEXT_MAX} characters or fewer. ` +
          'If nothing is lasting, say so in hq_complete and propose nothing. Do not edit any file. The owner decides what is saved.',
      });
    }
    D.setSetting(db, 'distillCounts', counts);
  };
  return { answered, noted };
}
