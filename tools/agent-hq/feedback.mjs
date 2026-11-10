// How a role's recent work landed, counted from what the owner already did: review verdicts on asks and the "Looks good" /
// "Needs changes" lines the task-verdict route posts to the role thread. Read only; nothing here writes.

const DAY = 86400000;
const GOOD = /^Looks good: /;
const SENT_BACK = /^Needs changes on ".*?": ([\s\S]*)$/;
const oneLine = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * @returns {{approved: number, changes: number, rejected: number, reworks: number, recent: string[], days: number}}
 *   recent = the 3 newest owner reasons (changes and rejects), newest first.
 */
export function roleStats(db, role, { days = 30, now = Date.now() } = {}) {
  const since = new Date(now - days * DAY).toISOString();
  const out = { approved: 0, changes: 0, rejected: 0, reworks: 0, recent: [], days };
  if (!db) return out;
  const reasons = [];
  const asks = db.prepare("SELECT verdict, verdictNote, answeredAt FROM asks WHERE role=? AND state='answered' AND answeredAt>=? AND verdict IN ('approved','changes','rejected')").all(role, since);
  for (const a of asks) {
    out[a.verdict === 'approved' ? 'approved' : a.verdict]++;
    if (a.verdict !== 'approved' && a.verdictNote) reasons.push([a.answeredAt, a.verdictNote]);
  }
  const msgs = db.prepare(`SELECT text, createdAt FROM messages WHERE role=? AND "from"='owner' AND createdAt>=? AND (text LIKE 'Looks good: %' OR text LIKE 'Needs changes on "%')`).all(role, since);
  for (const m of msgs) {
    if (GOOD.test(m.text)) out.approved++;
    else { out.changes++; const why = SENT_BACK.exec(m.text)?.[1]; if (why) reasons.push([m.createdAt, why]); }
  }
  out.reworks = db.prepare("SELECT COUNT(*) c FROM tasks WHERE role=? AND createdBy='owner' AND reworkCount>0 AND createdAt>=?").get(role, since).c;
  out.recent = reasons.sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 3).map((r) => oneLine(r[1], 160));
  return out;
}

/** The brief section: 4 body lines at most, or null when there is nothing to report. `small` (LLM engines) keeps 2 shorter reasons. */
export function statsSection(db, role, small = false) {
  const s = roleStats(db, role);
  if (!(s.approved + s.changes + s.rejected + s.reworks)) return null;
  const lines = [`Last ${s.days} days: ${s.approved} approved, ${s.changes} sent back with changes, ${s.rejected} rejected, ${s.reworks} reworks.`];
  if (s.recent.length) lines.push('Latest owner reasons, newest first:', ...s.recent.slice(0, small ? 1 : 2).map((r) => `- ${small ? oneLine(r, 100) : r}`));
  return `## How your recent work landed\n${lines.join('\n')}`;
}
