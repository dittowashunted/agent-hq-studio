// References before 3D work: a 3D model task is held while a designer reference task finds pictures from several angles.
// The held task is queued once the owner approves the sheet (modelRefApproval "ask") or the sheet task finishes ("auto").
import crypto from 'node:crypto';

const MODEL_ROLES = new Set(['world', 'librarian', 'builder', 'designer', 'ui']);
// "data model", "AI model" and "model picker" must miss, so a bare "model" is not a hit; "model of" is.
// "prop" alone is left out: placing existing props from the catalog needs no reference sheet.
const MODEL = /\b(?:3-?d|meshe?s?|model of|vehicles?|creatures?|statues?|low[- ]?poly|blender|sculpt(?:s|ed|ing)?)\b/i;
export const isModelTask = ({ title = '', role } = {}) => MODEL_ROLES.has(role) && MODEL.test(title);

const SHEET = /^Reference sheet: /;
export const REF_RELEASE_LINE = 'Build from this approved reference sheet. 3D order: catalog or asset pack, then Claude Design, then Blender only if Blender is on in Settings.';

export function initModelRefs(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS model_refs (
    id TEXT PRIMARY KEY, refTaskId TEXT NOT NULL, spec TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'waiting',
    createdAt TEXT NOT NULL, releasedTaskId TEXT
  )`);
}

/** Is this task a reference-sheet task? Looked up in model_refs, never by title alone. Safe on a db without the table. */
export function isRefTask(db, taskId) {
  try { return !!db?.prepare('SELECT 1 FROM model_refs WHERE refTaskId=?').get(taskId); } catch { return false; }
}

export function createModelRefs({ db, D, settingsAll, create, postMessage, roleOn = () => true }) {
  initModelRefs(db);
  const get = (sql, ...a) => db.prepare(sql).get(...a);

  // the row whose reference task is this task or one of its ancestors (a "Changes:" rework leads back to it)
  const rowFor = (task) => {
    for (let id = task?.id, i = 0; id && i < 8; i++, id = D.getTask(db, id)?.parentId) {
      const r = get('SELECT * FROM model_refs WHERE refTaskId=?', id);
      if (r) return r;
    }
    return null;
  };
  const family = (refTaskId) => { // the reference task and everything below it
    let ids = [refTaskId]; let kids = ids;
    for (let i = 0; i < 4 && kids.length; i++) {
      kids = db.prepare(`SELECT id FROM tasks WHERE parentId IN (${kids.map(() => '?').join(',')})`).all(...kids).map((r) => r.id);
      ids = ids.concat(kids);
    }
    return ids;
  };
  const imagePaths = (refTaskId) => {
    const ids = family(refTaskId);
    const rows = db.prepare(`SELECT mediaPath FROM asks WHERE taskId IN (${ids.map(() => '?').join(',')}) AND mediaPath IS NOT NULL
      AND state != 'dismissed' AND COALESCE(verdict, '') != 'rejected' ORDER BY createdAt, rowid`).all(...ids);
    return [...new Set(rows.map((r) => r.mediaPath))].slice(0, 12);
  };

  function release(row, from) {
    if (!db.prepare("UPDATE model_refs SET state='released' WHERE id=? AND state='waiting'").run(row.id).changes) return null; // once only
    const spec = JSON.parse(row.spec);
    const summary = (from?.summary || D.getTask(db, row.refTaskId)?.summary || '').trim().slice(0, 4000);
    const paths = imagePaths(row.refTaskId);
    const tail = `\n\n## Approved reference sheet\n${summary || '(no description was written)'}\n\nReference images:\n${paths.length ? paths.map((p) => `- ${p}`).join('\n') : '- (none attached)'}\n\n${REF_RELEASE_LINE}`;
    const task = create({ ...spec, body: `${(spec.body || '').slice(0, 20000 - tail.length)}${tail}`, refsDone: true });
    db.prepare('UPDATE model_refs SET releasedTaskId=? WHERE id=?').run(task.id, row.id);
    postMessage({ role: spec.role, from: 'system', text: `The reference sheet is in. Started the build: ${spec.title}`, taskId: task.id });
    return task;
  }

  return {
    /** Called for every new task. Returns the reference task when the task was held for a sheet, else null. */
    hold(f) {
      const s = settingsAll();
      if (!s.modelRefFirst || f.refsDone || f.gateFor || (f.state && f.state !== 'queued') || f.attempt > 1 || f.reworkCount > 0) return null;
      if (!isModelTask(f) || SHEET.test(f.title) || !roleOn('designer')) return null;
      const ask = s.modelRefApproval !== 'auto';
      const name = f.title.slice(0, 160);
      const ref = create({
        title: `Reference sheet: ${name}`, role: 'designer', game: f.game ?? null, needsStudio: false, createdBy: f.createdBy ?? 'owner',
        engine: s.modelRefLane === 'chatgpt' ? 'app' : 'antigravity',
        body: `Find references for this 3D work before anything is built.\n\nTitle: ${f.title}\n\n${f.body || ''}`.slice(0, 20000),
      });
      db.prepare('INSERT INTO model_refs (id, refTaskId, spec, state, createdAt) VALUES (?,?,?,?,?)')
        .run(`mr_${crypto.randomBytes(6).toString('hex')}`, ref.id, JSON.stringify(f), 'waiting', new Date().toISOString());
      postMessage({ role: f.role, from: 'system', taskId: ref.id,
        text: `Finding references for ${name} first. The build starts after ${ask ? 'you approve the sheet' : 'the sheet is done'}.` });
      return ref;
    },
    /** The owner approved an ask. True when it belongs to a reference sheet (so the caller must not queue "Build approved concept"). */
    approved(ask, task) {
      const row = rowFor(task);
      if (!row) return false;
      if (row.state === 'waiting' && settingsAll().modelRefApproval !== 'auto') release(row, task);
      return true;
    },
    /** The owner rejected an ask: a waiting build is dropped. */
    rejected(ask, task) {
      const row = rowFor(task);
      if (row?.state !== 'waiting' || !db.prepare("UPDATE model_refs SET state='dropped' WHERE id=? AND state='waiting'").run(row.id).changes) return;
      postMessage({ role: JSON.parse(row.spec).role, from: 'system', taskId: task?.id, text: `Reference sheet rejected. The build was not started: ${JSON.parse(row.spec).title}` });
    },
    /** Every task update: in "auto" mode the finished reference task releases its build. A failed or canceled sheet tells the owner. */
    taskChanged(t) {
      if (t?.state === 'failed' || t?.state === 'canceled') {
        const row = get("SELECT * FROM model_refs WHERE refTaskId=? AND state='waiting'", t.id);
        if (!row) return;
        const spec = JSON.parse(row.spec);
        // canceled is final; a failed sheet can still be retried, so its build keeps waiting
        if (t.state === 'canceled') db.prepare("UPDATE model_refs SET state='dropped' WHERE id=?").run(row.id);
        postMessage({ role: spec.role, from: 'system', taskId: t.id, text: t.state === 'canceled'
          ? `Reference sheet canceled. The build was not started: ${spec.title}`
          : `Reference sheet failed. The build is waiting: retry the sheet, or create the build again with Find references turned off in Settings: ${spec.title}` });
        return;
      }
      if (!t || (t.state !== 'done' && t.state !== 'review') || settingsAll().modelRefApproval !== 'auto') return;
      const row = get("SELECT * FROM model_refs WHERE refTaskId=? AND state='waiting'", t.id);
      if (row) release(row, t);
    },
  };
}
