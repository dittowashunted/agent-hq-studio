// Score my idea: the owner submits an idea, a scout task scores it on five rows, the server stores it.
// normalizeScore throws an Error with .status = 400 (like pitches.mjs); the routes turn that into an HttpError.
import crypto from 'node:crypto';
import * as D from './db.mjs';

export const ROW_NAMES = ['Demand', 'Competition', 'Money', 'First five minutes', 'Build size'];
const IDEA_ID = /^i_[0-9a-f]{12}$/;
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const text = (v, name, max) => {
  if (typeof v !== 'string' || !v.trim()) throw bad(`${name} is required`);
  if (v.trim().length > max) throw bad(`${name} is too long (max ${max} characters)`);
  return v.trim();
};
const mark = (v, name) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 10) throw bad(`${name} must be a number from 0 to 10`);
  return Math.round(n * 10) / 10;
};

/** The five rows are required, in order, by name. The overall score is the row mean to 1 decimal; the caller never sends one. */
export function normalizeScore(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('score must be an object');
  if (!Array.isArray(input.rows) || input.rows.length !== ROW_NAMES.length) throw bad(`rows must be exactly ${ROW_NAMES.length} entries: ${ROW_NAMES.join(', ')}`);
  const rows = input.rows.map((r, i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw bad(`rows[${i}] must be an object`);
    if (typeof r.name !== 'string' || r.name.trim().toLowerCase() !== ROW_NAMES[i].toLowerCase()) throw bad(`rows[${i}].name must be "${ROW_NAMES[i]}" (the rows go in this order: ${ROW_NAMES.join(', ')})`);
    return { name: ROW_NAMES[i], score: mark(r.score, `rows[${i}].score`), evidence: text(r.evidence, `rows[${i}].evidence`, 1000) };
  });
  const score = Math.round((rows.reduce((n, r) => n + r.score, 0) / rows.length) * 10) / 10;
  return { score, verdict: text(input.verdict, 'verdict', 500), rows, change: text(input.change, 'change', 2000) };
}

export function initIdeas(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS idea_scores (id TEXT PRIMARY KEY, title TEXT NOT NULL, idea TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open',
    score REAL, verdict TEXT, rows TEXT, change TEXT, taskId TEXT, createdAt TEXT NOT NULL, scoredAt TEXT)`);
}

// state "failed" is not stored: an open idea whose scout task failed or was canceled reads as failed
const view = (db, r) => {
  const failed = r.state === 'open' && ['failed', 'canceled'].includes(D.getTask(db, r.taskId)?.state);
  let rows = [];
  try { rows = r.rows ? JSON.parse(r.rows) : []; } catch { /* keep [] */ }
  return { id: r.id, title: r.title, idea: r.idea, state: failed ? 'failed' : r.state, score: r.score, verdict: r.verdict, rows, change: r.change, taskId: r.taskId, createdAt: r.createdAt, scoredAt: r.scoredAt };
};

export const IDEAS_OWNER_ONLY = [['POST', /^\/api\/idea-scores$/]];

export function mountIdeas(route, { db, str, bad: badReq, isObj, agentTask, queueTask, HttpError }) {
  initIdeas(db);
  const get = (id) => (IDEA_ID.test(id) ? db.prepare('SELECT * FROM idea_scores WHERE id = ?').get(id) : null);

  route('GET', /^\/api\/idea-scores$/, () => ({ ideas: db.prepare('SELECT * FROM idea_scores ORDER BY createdAt DESC, rowid DESC').all().map((r) => view(db, r)) }));

  route('POST', /^\/api\/idea-scores$/, ({ body }) => {
    if (!isObj(body)) throw badReq('body must be an object');
    const title = str(body.title, 'title', { max: 200, required: true });
    const idea = str(body.idea, 'idea', { max: 2000, required: true });
    const id = `i_${crypto.randomBytes(6).toString('hex')}`;
    const t = queueTask({
      title: `Score idea: ${title}`.slice(0, 200), role: 'scout', createdBy: 'owner',
      body: `The owner wants this game idea scored: "${title}"\n\n${idea}\n\nIdea id: ${id}\n\n` +
        `Check it against the charts and comparables, then call hq_idea_score {ideaId: "${id}", verdict, rows, change}. ` +
        `rows has exactly five entries, in this order: ${ROW_NAMES.join(', ')}. Each is {name, score, evidence}: score 0 to 10 where 10 is best for the owner ` +
        `(a crowded field scores low on Competition, a big build scores low on Build size) and evidence is what you found, with numbers and links where you have them. ` +
        `verdict is one line. change says what would raise the score. Do not send an overall score: HQ works it out.`,
    });
    db.prepare('INSERT INTO idea_scores (id, title, idea, state, taskId, createdAt) VALUES (?,?,?,?,?,?)').run(id, title, idea, 'open', t.id, new Date().toISOString());
    return view(db, get(id));
  });

  route('POST', /^\/api\/idea-scores\/([^/]+)\/score$/, ({ m, body, who, headers }) => {
    const row = get(m[1]);
    if (!row) throw new HttpError(404, 'idea not found');
    if (who === 'agent') {
      const t = agentTask(body, ['scout'], headers);
      if (t.id !== row.taskId) throw new HttpError(403, 'that task is not scoring this idea');
    }
    if (row.state !== 'open') throw new HttpError(409, 'that idea is already scored');
    let s;
    try { s = normalizeScore(body); } catch (e) { throw new HttpError(e.status ?? 400, e.message); }
    db.prepare("UPDATE idea_scores SET state = 'scored', score = ?, verdict = ?, rows = ?, change = ?, scoredAt = ? WHERE id = ?")
      .run(s.score, s.verdict, JSON.stringify(s.rows), s.change, new Date().toISOString(), row.id);
    return view(db, get(row.id));
  });
}
