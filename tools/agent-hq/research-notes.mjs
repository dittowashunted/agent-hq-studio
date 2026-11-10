// Research memory: what an agent learned from the web, kept as one markdown note per find in <stateDir>/research-notes/.
// knowledge.mjs reads that folder as the "notes" source (low trust, quarantine applies), so later agents find it with hq_knowledge_search.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { quarantine } from './knowledge.mjs';

export const NOTES_DIR = 'research-notes';
export const TITLE_MAX = 200;
export const URL_MAX = 500;
export const SUMMARY_MAX = 4000;
export const NOTES_CAP = 500;

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Writes one note. Throws an Error with a plain message when title, url or summary is not acceptable.
 * @returns {{file: string, path: string, held: string|null}} file name, path as the notes source lists it, and the quarantine rule if the text would be hidden.
 */
export function saveResearchNote(stateDir, { title, url, summary, role }, date) {
  const t = oneLine(title).replace(/"/g, "'");
  if (!t || t.length > TITLE_MAX) throw new Error(`title is required (up to ${TITLE_MAX} characters)`);
  const link = oneLine(url);
  let parsed = null;
  try { parsed = new URL(link); } catch { /* checked below */ }
  if (!parsed || parsed.protocol !== 'https:' || link.length > URL_MAX || /\s/.test(String(url).trim())) throw new Error(`url must be an https link of up to ${URL_MAX} characters`);
  const body = String(summary ?? '').replace(/\r\n/g, '\n').trim();
  if (!body || body.length > SUMMARY_MAX) throw new Error(`summary is required (up to ${SUMMARY_MAX} characters)`);
  const dir = path.join(stateDir, NOTES_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const slug = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'note';
  const hash = crypto.createHash('sha1').update(`${link}\n${t}`).digest('hex').slice(0, 6);
  const file = `${date}-${slug}-${hash}.md`;
  if (!fs.existsSync(path.join(dir, file)) && fs.readdirSync(dir).length >= NOTES_CAP) throw new Error(`research notes are full (${NOTES_CAP}); ask the owner to remove old ones`);
  const text = `---\ntitle: "${t}"\ndescription: "${oneLine(body).slice(0, 200).replace(/"/g, "'")}"\n---\n# ${t}\n\nSaved ${date} by ${role}. Source: ${link}\n\n${body}\n`;
  fs.writeFileSync(path.join(dir, file), text);
  return { file, path: file, held: quarantine(text) };
}

/** POST /api/research-notes (agent task token). c: { stateDir, nowIso, str, bad, isObj, agentTask, onNoteSaved }. Makes the folder so the source is found at start. */
export function mountResearch(route, c) {
  const { stateDir, nowIso, str, bad, isObj, agentTask, onNoteSaved } = c;
  fs.mkdirSync(path.join(stateDir, NOTES_DIR), { recursive: true });
  route('POST', /^\/api\/research-notes$/, ({ body, headers }) => {
    if (!isObj(body)) throw bad('body must be an object');
    const t = agentTask(body, undefined, headers);
    const f = { title: str(body.title, 'title', { max: TITLE_MAX, required: true }), url: str(body.url, 'url', { max: URL_MAX, required: true }), summary: str(body.summary, 'summary', { max: SUMMARY_MAX, required: true }), role: t.role };
    let r; try { r = saveResearchNote(stateDir, f, nowIso().slice(0, 10)); } catch (e) { throw bad(e.message); }
    try { onNoteSaved?.(); } catch { /* the note is saved either way */ }
    return { saved: true, source: 'notes', path: r.path, ...(r.held ? { held: `Hidden from search because it looks like an instruction to agents (${r.held}). Rewrite it as plain facts.` } : {}) };
  });
}
