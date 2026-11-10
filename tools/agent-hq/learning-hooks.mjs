// Instant results and learning from every criticism.
//  - A Lead plan's tasks report to the Lead's thread the moment they finish; when all have finished, one follow-up task asks the Lead to check them.
//  - Gate FAIL reasons become lessons for the worked role; owner criticism and stage rejections become owner corrections.
import fs from 'node:fs';
import path from 'node:path';
import { quarantine } from './knowledge.mjs';

export const LESSON_CAP = 40;
export const MAX_ROUNDS = 3;
const FINISHED = new Set(['done', 'failed', 'canceled']);
const CRITICISM = /\b(no|wrong|don't|dont|stop|not what i|ugly|bad|should have|instead|fix|worse|again)\b|\btoo /i;
const oneLine = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n).trim();
const LESSON = /^- (\d{4}-\d{2}-\d{2}): (.+)$/;

export const isCriticism = (text) => CRITICISM.test(String(text ?? ''));

/** Same file and format hq_learn writes: memory/<role>.md, "- date: text". Exact repeats are ignored; the newest LESSON_CAP stay. */
export function saveLesson(memoryDir, role, text, date) {
  const file = path.join(memoryDir, `${role}.md`);
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split('\n').map((l) => LESSON.exec(l.trim())).filter(Boolean).map((x) => ({ date: x[1], text: x[2] })); } catch { /* none yet */ }
  const t = oneLine(text, 300);
  if (!t || lines.some((l) => l.text === t)) return false;
  lines = [...lines, { date, text: t }].slice(-LESSON_CAP);
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.writeFileSync(file, lines.map((l) => `- ${l.date}: ${l.text}`).join('\n') + '\n');
  return true;
}

const roundOf = (title) => { const m = / \(round (\d)\)$/.exec(title); return m ? Number(m[1]) : /^Results in: /.test(title) ? 1 : 0; };
const baseTitle = (title) => title.replace(/^Results in: /, '').replace(/ \(round \d\)$/, '');

export function createLearningHooks({ db, D, memoryDir, postMessage, queueTask, remember, roleLabel = (r) => r, nowIso = () => new Date().toISOString() }) {
  const seen = new Set();
  const kids = (id) => db.prepare('SELECT id, role, state, title, summary, error, gateFor, startedAt FROM tasks WHERE parentId=? ORDER BY createdAt, rowid').all(id);
  const planKids = (id) => kids(id).filter((k) => !k.gateFor && k.role !== 'lead');
  // a task in review still waits on its own review gates; without open gates it is as finished as it will get on its own
  const settled = (k) => FINISHED.has(k.state) || (k.state === 'review' && !D.gateTasks(db, k.id, k.startedAt ?? '').some((g) => !FINISHED.has(g.state) && g.state !== 'review'));

  function followUp(lead) {
    if (!lead || lead.role !== 'lead' || !(lead.state === 'review' || FINISHED.has(lead.state))) return null;
    const list = planKids(lead.id);
    if (!list.length || !list.every(settled)) return null;
    if (kids(lead.id).some((k) => k.role === 'lead' && /^Results in: /.test(k.title)) || seen.has(`plan:${lead.id}`)) return null;
    const round = roundOf(lead.title) + 1;
    if (round > MAX_ROUNDS) return null;
    seen.add(`plan:${lead.id}`);
    const rows = list.slice(0, 20).map((k) => `- ${roleLabel(k.role)} | ${k.state} | ${oneLine(k.title, 100)} | ${oneLine(k.state === 'failed' ? k.error || k.summary : k.summary, 300) || '(no summary)'}`).join('\n');
    return queueTask({
      // base trimmed first so the round suffix (the loop cap) is never cut off
      title: `Results in: ${baseTitle(lead.title).slice(0, 170)}${round > 1 ? ` (round ${round})` : ''}`, role: 'lead', game: lead.game, parentId: lead.id, createdBy: 'results',
      body: `Your plan "${lead.title}" has finished. Results, one line per task (role | state | title | summary):\n${rows}\n\nCheck them against the owner's request. Tell the owner in plain words what is done and what is not. Queue fixes only for real failures.`.slice(0, 20000),
    });
  }

  return {
    /** A task asking again replaces its older open questions, so Home never shows the same request three times. Images are kept. */
    supersede(ask, emit = () => {}) {
      if (!ask?.taskId || ask.kind === 'review' || ask.kind === 'reference') return [];
      const old = db.prepare("SELECT id FROM asks WHERE taskId=? AND role=? AND state='open' AND kind=? AND id<>?").all(ask.taskId, ask.role, ask.kind, ask.id);
      for (const { id } of old) emit('ask', D.answerAsk(db, id, { answer: null, state: 'dismissed' }));
      return old.map((r) => r.id);
    },
    /** Call on every task update. */
    taskChanged(t) {
      if (!t || t.gateFor) return;
      if (t.role === 'lead') { if (t.state === 'review' || FINISHED.has(t.state)) followUp(t); return; }
      if (!['done', 'review', 'failed'].includes(t.state)) return;
      const lead = t.parentId ? D.getTask(db, t.parentId) : null;
      if (!(lead?.role === 'lead' || t.createdBy === 'lead')) return;
      const key = t.state === 'failed' ? `${t.id}:failed` : t.id;
      if (seen.has(key)) return;
      seen.add(key);
      const what = t.state === 'failed' ? `failed: ${oneLine(t.error || t.summary, 200) || 'no reason given'}` : oneLine(String(t.summary ?? '').split('\n')[0], 200) || 'no summary';
      postMessage({ role: 'lead', from: 'system', text: t.state === 'failed' ? `${roleLabel(t.role)} ${t.title ? `"${oneLine(t.title, 80)}" ` : ''}${what}` : `${roleLabel(t.role)} finished ${oneLine(t.title, 80)}: ${what}`, taskId: lead?.id ?? null });
      followUp(lead);
    },
    /** A reviewer's FAIL becomes a lesson for the role whose work failed. */
    gateFail(orig, g) {
      const reason = oneLine(String(g.summary ?? '').replace(/^\s*fail\w*[:\s.,-]*/i, ''), 300);
      const head = `${roleLabel(g.role)} FAIL on ${oneLine(orig.title.replace(/^(?:Fix|Rework|Check): /, ''), 60)}: `;
      if (quarantine(reason)) return false; // agent text: never keep a line that tries to steer later agents
      return saveLesson(memoryDir, orig.role, head + (reason || 'no reason given'), nowIso().slice(0, 10));
    },
    /** The owner said something critical in a role's thread. Agent text never reaches this. */
    criticism(role, text, game) {
      if (!isCriticism(text)) return false;
      remember(role, 'correction', game, text);
      return true;
    },
    /** The owner rejected or held a stage request: the reason is a correction for the role that asked. */
    stageDecision(r, state, reason, game) {
      if ((state === 'rejected' || state === 'held') && reason) remember(r.role, 'correction', game, reason);
    },
  };
}
