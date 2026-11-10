// Readiness: is everything the agents rely on actually on this PC? Tools, knowledge folders, and each role's skills.
// Paths and lookups are injectable so tests can use temp dirs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const isWin = process.platform === 'win32';

/** Absolute path of an executable on PATH, or null. Never uses a shell. */
export function findExe(name) {
  try {
    const out = execFileSync(isWin ? 'where' : 'which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return (isWin ? lines.find((l) => /\.(exe|cmd|bat)$/i.test(l)) : lines[0]) ?? null;
  } catch { return null; }
}

// Skills the Claude app and CLI ship with: there is no folder on disk to look for.
const BUILT_IN = new Set(['run', 'code-review', 'security-review', 'simplify', 'init', 'loop', 'schedule', 'claude-api', 'update-config', 'keybindings-help', 'fewer-permission-prompts', 'dataviz']); // dataviz ships inside the Claude app, not as a folder
const BUILT_IN_PLUGINS = new Set(['anthropic-skills']);

// statSync follows links: skills are often symlinks or junctions into another folder
const kind = (p, n) => { try { return fs.statSync(path.join(p, n)); } catch { return null; } };
const list = (p) => { try { return fs.readdirSync(p); } catch { return []; } };
const dirs = (p) => list(p).filter((n) => kind(p, n)?.isDirectory());
const files = (p) => list(p).filter((n) => kind(p, n)?.isFile());
const frontName = (file) => {
  try {
    const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(600); const n = fs.readSync(fd, buf, 0, 600, 0); fs.closeSync(fd);
    return /^---\r?\n[\s\S]*?^name:\s*["']?([^\r\n"']+)/m.exec(buf.toString('utf8', 0, n))?.[1]?.trim() ?? null;
  } catch { return null; }
};

/** Every skill and command name found on disk, bare and as plugin:name. */
export function indexSkills({ root, home = os.homedir() }) {
  const names = new Set();
  const add = (plugin, name) => { if (!name) return; names.add(name); if (plugin) names.add(`${plugin}:${name}`); };
  const skillRoot = (dir, plugin) => {
    for (const d of dirs(dir)) { add(plugin, d); add(plugin, frontName(path.join(dir, d, 'SKILL.md'))); }
  };
  const commandRoot = (dir, plugin) => { for (const f of files(dir)) if (/\.md$/i.test(f)) add(plugin, f.replace(/\.md$/i, '')); };
  skillRoot(path.join(root, '.claude/skills'), null);
  skillRoot(path.join(root, '.agents/skills'), null);
  skillRoot(path.join(home, '.claude/skills'), null);
  commandRoot(path.join(root, '.claude/commands'), null);
  commandRoot(path.join(home, '.claude/commands'), null);
  const pluginRoot = (base, plugin) => { skillRoot(path.join(base, 'skills'), plugin); commandRoot(path.join(base, 'commands'), plugin); };
  const cache = path.join(home, '.claude/plugins/cache');
  for (const market of dirs(cache)) for (const plugin of dirs(path.join(cache, market))) for (const ver of dirs(path.join(cache, market, plugin))) pluginRoot(path.join(cache, market, plugin, ver), plugin);
  const local = path.join(home, '.claude/local-plugins');
  for (const plugin of dirs(local)) pluginRoot(path.join(local, plugin), plugin);
  const markets = path.join(home, '.claude/plugins/marketplaces');
  for (const market of dirs(markets)) {
    pluginRoot(path.join(markets, market), null);
    for (const plugin of dirs(path.join(markets, market, 'plugins'))) pluginRoot(path.join(markets, market, 'plugins', plugin), plugin);
  }
  return names;
}

const looksLikePath = (n) => /[\\/]/.test(n) || /\.md$/i.test(n);

export function createReadiness({ root, home = os.homedir(), find = findExe, knowledge, getRoles, now = Date.now, env = process.env }) {
  let memo = null; // the skill index reads a few hundred folders: reuse it for a minute
  const index = () => {
    if (!memo || now() - memo.at > 60000) memo = { at: now(), names: indexSkills({ root, home }) };
    return memo.names;
  };
  const skillFound = (name, names) => {
    if (looksLikePath(name)) return fs.existsSync(path.join(root, name));
    if (BUILT_IN.has(name) || BUILT_IN_PLUGINS.has(name.split(':')[0])) return true;
    return names.has(name);
  };

  return async function check() {
    const names = index();
    const exe = (...cands) => { for (const c of cands.filter(Boolean)) { const p = find(c); if (p) return { found: true, path: p }; } return { found: false }; };
    const tools = { python: exe(env.HQ_PYTHON, 'python', 'python3', 'py'), claude: exe('claude'), rojo: exe('rojo') };

    const st = await knowledge.status();
    const kn = st.sources.map((s) => ({ id: s.id, label: s.label, found: s.found, notes: s.notes, words: s.words }));
    const quarantined = (await knowledge.quarantined()).map((q) => ({ source: q.source, path: q.path, rule: q.rule }));

    const roles = getRoles().map((r) => {
      const skills = (r.skills ?? []).map((s) => ({ name: s.name, found: skillFound(s.name, names) }));
      return {
        id: r.id, label: r.label, enabled: r.enabled !== false, rules: r.rules?.length ?? 0, chapters: r.chapters?.length ?? 0,
        skills, missing: skills.filter((s) => !s.found).map((s) => s.name),
      };
    });

    const missing = [];
    for (const [k, v] of Object.entries(tools)) if (!v.found) missing.push(`tool: ${k}`);
    for (const k of kn) if (!k.found) missing.push(`knowledge: ${k.label}`);
    for (const r of roles) if (r.enabled) for (const m of r.missing) missing.push(`skill: ${m} (${r.label})`);
    return { at: new Date(now()).toISOString(), ok: missing.length === 0, missing, tools, knowledge: kn, roles, quarantined };
  };
}
