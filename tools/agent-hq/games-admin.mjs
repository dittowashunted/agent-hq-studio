// Games the Lead can create, and moving work between games (a task plus its children and gate tasks).
export const slugFromName = (name) => String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');

export function moveTasks(db, D, rootId, game, depth = 6) {
  const seen = new Set([rootId]);
  let level = [rootId];
  for (let d = 0; d < depth && level.length; d++) {
    const next = [];
    for (const id of level) {
      for (const r of db.prepare('SELECT id FROM tasks WHERE parentId=? OR gateFor=?').all(id, id)) if (!seen.has(r.id)) { seen.add(r.id); next.push(r.id); }
    }
    level = next;
  }
  const moved = [];
  for (const id of seen) { const t = D.updateTask(db, id, { game }); if (t) moved.push(t); }
  return moved;
}

export function mountGamesAdmin(route, { db, D, pubGame, pubTask, postMessage, SLUG, str, bad, isObj, agentTask, needTask, HttpError }) {
  // The working task that the caller's task token belongs to (verified here, not trusted from the client). Used by hq_game_check.
  route('POST', /^\/api\/tasks\/whoami$/, ({ body, who, headers }) => {
    if (who !== 'agent') throw new HttpError(403, 'agents only');
    const t = agentTask(body, null, headers);
    return { id: t.id, role: t.role, game: t.game ?? null };
  });
  // Lead only, with its task token. The owner uses POST /api/games.
  route('POST', /^\/api\/games\/lead-create$/, ({ body, who, headers }) => {
    if (!isObj(body)) throw bad('body must be an object');
    if (who !== 'agent') throw new HttpError(403, 'owners create games with POST /api/games');
    agentTask(body, ['lead'], headers);
    const name = str(body.name, 'name', { max: 100, required: true });
    const slug = slugFromName(name);
    if (!SLUG.test(slug)) throw bad('the name needs at least two letters or digits');
    const dup = D.listGames(db).find((g) => g.slug === slug || g.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (dup) throw new HttpError(409, `a game called "${dup.name}" already exists (slug ${dup.slug}); use that slug`);
    const g = D.createGame(db, { slug, name });
    const pitch = str(body.pitch, 'pitch', { max: 300 });
    const out = pubGame(pitch ? D.updateGame(db, slug, { note: pitch }) : g);
    postMessage({ role: 'lead', from: 'system', text: `Lead created the game ${name}.` });
    return out;
  });

  // Owner, or the Lead with its task token. game is a known slug or null.
  route('POST', /^\/api\/tasks\/([^/]+)\/game$/, ({ m, body, who, headers }) => {
    if (!isObj(body)) throw bad('body must be an object');
    if (who === 'agent') agentTask(body, ['lead'], headers);
    const t = needTask(m[1]);
    const game = body.game === null || body.game === '' ? null : str(body.game, 'game', { max: 40, required: true });
    if (game !== null && (!SLUG.test(game) || !D.getGame(db, game))) throw bad('unknown game');
    const moved = moveTasks(db, D, t.id, game);
    for (const x of moved) pubTask(x);
    return { game, moved: moved.map((x) => x.id) };
  });
}

/**
 * POST /api/games/:slug/open-studio: the owner, or an agent on a working Studio task of a Studio role, opens the game's place in
 * Studio (rojo build, then the default app; never publishes). At most once per 10 minutes per game, so agents cannot flood the desktop.
 */
export function mountOpenStudio(route, { play, needGame, agentTask, roleOf, HttpError, now = Date.now }) {
  const last = new Map();
  route('POST', /^\/api\/games\/([^/]+)\/open-studio$/, ({ m, body, who, headers }) => {
    const g = needGame(m[1]);
    if (who === 'agent') {
      const t = agentTask(body, null, headers);
      if (!t.needsStudio || !(roleOf(t.role)?.mcp ?? []).includes('Roblox_Studio')) throw new HttpError(403, 'only Studio tasks of Studio roles can open Studio');
      if (t.game && t.game !== g.slug) throw new HttpError(403, `your task is for ${t.game}, not ${g.slug}`);
    }
    if (last.has(g.slug) && now() - last.get(g.slug) < 10 * 60000) throw new HttpError(429, 'Studio was opened for this game in the last 10 minutes; use the open window');
    last.set(g.slug, now());
    return play(g.slug);
  });
}
