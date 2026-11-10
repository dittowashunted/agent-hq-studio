// Which game a piece of work belongs to, what an agent is told about it, and clearing finished work.
import fs from 'node:fs';
import path from 'node:path';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Slug of the one game whose name or slug appears as whole words in the text; two different games means none. */
export function gameInText(text, games) {
  const hits = (games ?? []).filter((g) => [g.name, g.slug].filter(Boolean).some((n) => new RegExp(`(?<![A-Za-z0-9])${esc(n)}(?![A-Za-z0-9])`, 'i').test(text ?? '')));
  return hits.length === 1 ? hits[0].slug : null;
}

/** Parent task's game, then the game the owner had selected, then a single game named in the text, else null. */
export function inferGame({ parentGame, selected, text, games }) {
  const known = (s) => (s && (games ?? []).some((g) => g.slug === s) ? s : null);
  return known(parentGame) ?? known(selected) ?? gameInText(text, games);
}

const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };

/** Where a game's code lives: games/<slug>/ when it has its own Rojo project, else the repo root. */
export function gameFolder(root, slug) {
  const own = `games/${slug}`;
  return exists(path.join(root, own, 'default.project.json')) ? own : '.';
}

/** The game bible chapter for a game: the G-section whose title names it, else the list of G sections. */
export function gameChapter(sections, game) {
  const top = (sections ?? []).filter((s) => /^G\d+$/.test(s.id));
  const n = norm(game.name);
  const hit = top.find((s) => n && norm(s.title).includes(n));
  return hit ? `${hit.id} (${hit.title})` : top.length ? `not matched by name; chapters: ${top.map((s) => `${s.id} ${s.title}`).join(', ')}` : 'not in the mirrored doc yet';
}

/** "## Your game" for a brief. Short on purpose; the size caps of LLM engines count it. */
export function gameSection({ task, games, root, sections }) {
  const list = games ?? [];
  const g = task.game ? list.find((x) => x.slug === task.game) : null;
  if (!g) {
    return `## Your game\nThis task has no game. Ask the Lead which game it is for (hq_ask) before changing game files. Games: ${list.length ? list.map((x) => `${x.name} (${x.slug})`).join(', ') : '(none yet)'}.`;
  }
  const dir = gameFolder(root, g.slug);
  const at = (f) => (dir === '.' ? f : `${dir}/${f}`);
  return [
    '## Your game',
    `${g.name} (${g.slug}), stage: ${g.stage}.`,
    `Work folder: ${dir === '.' ? 'the repo root (src/)' : `${dir}/`}. Docs: ${at('docs/')}. Rojo project: ${at('default.project.json')}. Game bible chapter: ${gameChapter(sections, g)}.`,
    `Run the checks with hq_game_check {game: "${g.slug}"} (tests, format, lint inside the game folder); do not cd.`,
    "Only change files inside this game's folder unless the task says otherwise; never edit the other game's files.",
  ].join('\n');
}

const HOUR = 3600 * 1000;
/** Delete done or canceled tasks that ended over an hour ago (and have no open ask), with their closed asks. Returns counts. */
export function clearFinished(db, now = Date.now()) {
  const cutoff = new Date(now - HOUR).toISOString();
  const ids = db.prepare("SELECT id FROM tasks WHERE state IN ('done','canceled') AND COALESCE(endedAt, createdAt) < ? AND NOT EXISTS (SELECT 1 FROM asks WHERE asks.taskId=tasks.id AND asks.state='open')").all(cutoff).map((r) => r.id);
  let asks = 0;
  for (const id of ids) {
    asks += Number(db.prepare("DELETE FROM asks WHERE taskId=? AND state<>'open'").run(id).changes);
    db.prepare('DELETE FROM tasks WHERE id=?').run(id);
  }
  return { tasks: ids.length, asks };
}

export const GAME_CONTEXT_OWNER_ONLY = [['POST', /^\/api\/tasks\/clear-finished$/]];
export function mountGameContext(route, { db }) {
  route('POST', /^\/api\/tasks\/clear-finished$/, () => clearFinished(db));
}
