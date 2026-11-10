// Owner corrections: the owner's notes on a role's work, kept for good in memory/<role>.corrections.md.
// They are separate from agent lessons (memory/<role>.md, hq_learn) so that lessons, which agents write, can never push them out.
// Only the owner's own actions write here: a "changes" verdict, a reject reason, or a note on an approval. There is no agent route.
// Line: "- <date> | <correction|preference> | <game slug or any> | <text>". Newest 40 per role; exact repeats are ignored.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const CORRECTIONS_CAP = 40;
export const CORRECTION_TEXT_MAX = 300;
const KINDS = ['correction', 'preference'];
const LINE = /^- (\d{4}-\d{2}-\d{2}) \| (correction|preference) \| ([a-z0-9-]{1,40}|any) \| (.+)$/;

const fileOf = (memoryDir, role) => path.join(memoryDir, `${role}.corrections.md`);
const idOf = (c) => crypto.createHash('sha1').update(`${c.kind}|${c.game}|${c.text}`).digest('hex').slice(0, 10);
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, CORRECTION_TEXT_MAX).trim();

/** Oldest first: [{ id, date, kind, game, text }]. */
export function readCorrections(memoryDir, role) {
  let text = '';
  try { text = fs.readFileSync(fileOf(memoryDir, role), 'utf8'); } catch { return []; }
  return text.split(/\r?\n/).map((l) => LINE.exec(l.trim())).filter(Boolean)
    .map(([, date, kind, game, body]) => ({ id: idOf({ kind, game, text: body }), date, kind, game, text: body }));
}

function write(memoryDir, role, list) {
  fs.mkdirSync(memoryDir, { recursive: true });
  const head = `# Owner corrections for ${role} (written by Agent HQ from the owner's own notes)\n`;
  fs.writeFileSync(fileOf(memoryDir, role), head + list.map((c) => `- ${c.date} | ${c.kind} | ${c.game} | ${c.text}`).join('\n') + (list.length ? '\n' : ''));
}

/**
 * Saves one owner note for a role. Returns { corrections, added }. An empty note, an unknown kind or an exact repeat adds nothing.
 * @param {{kind: 'correction'|'preference', game?: string|null, text: string}} entry
 * @param {string} date YYYY-MM-DD
 */
export function addCorrection(memoryDir, role, { kind, game, text }, date) {
  const list = readCorrections(memoryDir, role);
  const c = { kind, game: /^[a-z0-9-]{1,40}$/.test(game ?? '') ? game : 'any', text: oneLine(text), date };
  if (!KINDS.includes(c.kind) || !c.text) return { corrections: list, added: false };
  c.id = idOf(c);
  if (list.some((x) => x.id === c.id)) return { corrections: list, added: false };
  const next = [...list, c].slice(-CORRECTIONS_CAP);
  write(memoryDir, role, next);
  return { corrections: next, added: true };
}

/** Removes one entry by id. Returns the new list, or null when there is no such entry. */
export function deleteCorrection(memoryDir, role, id) {
  const list = readCorrections(memoryDir, role);
  const next = list.filter((c) => c.id !== id);
  if (next.length === list.length) return null;
  write(memoryDir, role, next);
  return next;
}

/** DELETE /api/memory/:role/corrections/:id. The server's owner-only list keeps agent tokens out of this and of any add route. */
export function mountCorrections(route, { memoryDir, roleIds, HttpError }) {
  route('DELETE', /^\/api\/memory\/([^/]+)\/corrections\/([0-9a-f]{10})$/, ({ m }) => {
    if (!roleIds.includes(m[1])) throw new HttpError(400, 'role must be a known role id');
    const corrections = deleteCorrection(memoryDir, m[1], m[2]);
    if (!corrections) throw new HttpError(404, 'no such correction');
    return { corrections };
  });
}
