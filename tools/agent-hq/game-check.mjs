// Run a game's tests, format check and lint inside its own folder (agents cannot cd in headless mode).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { gameFolder } from './game-context.mjs';
import { findExe } from './readiness.mjs';

const TAIL = 4096;
const tail = (s) => { const t = String(s ?? ''); return t.length > TAIL ? t.slice(-TAIL) : t; };

// Tests run agent-written code: never hand it HQ's tokens or provider keys.
// Allowlist: only what the tools need to start and find their files.
const ENV_KEEP = /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|LANG|LC_ALL|TERM)$/i;
// ponytail: same Windows user, so test code could still read .agent-hq from disk; a separate low-privilege user would close that.
export const scrubbedEnv = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([k]) => ENV_KEEP.test(k)));

/** The tool's real path from PATH, looked up outside the repo, so a lune.exe planted in a game folder can never run. */
export function resolveTool(cmd, root, lookup = findExe) {
  const p = lookup(cmd);
  if (!p) return null;
  const inside = path.resolve(p).toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep);
  return inside ? null : p;
}

export function defaultRun(cmd, args, { cwd, timeout, root }) {
  return new Promise((resolve) => {
    const exe = resolveTool(cmd, root ?? cwd);
    if (!exe) return resolve({ missing: true, code: null, out: '' });
    execFile(exe, args, { cwd, timeout, env: scrubbedEnv(), shell: false, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout ?? ''}${stderr ?? ''}`;
      if (err?.code === 'ENOENT') return resolve({ missing: true, code: null, out: '' });
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: err?.killed ? `${out}\n(timed out)` : out });
    });
  });
}

/** stylua defaults differ from the repo's style; use the root config when the game folder has none. */
export function styluaArgs(root, folderAbs, exists = fs.existsSync) {
  const base = ['--check'];
  if (exists(path.join(folderAbs, 'stylua.toml')) || exists(path.join(folderAbs, '.stylua.toml'))) return [...base, 'src', 'tests'];
  const rootCfg = path.join(root, 'stylua.toml');
  return exists(rootCfg) && path.resolve(folderAbs) !== path.resolve(root)
    ? [...base, '--config-path', rootCfg, 'src', 'tests'] : [...base, 'src', 'tests'];
}

export async function runGameCheck({ root, slug, run = defaultRun, exists = fs.existsSync }) {
  const folder = gameFolder(root, slug);
  const cwd = path.resolve(root, folder);
  const plan = [
    ['lune', ['run', 'tests/run']],
    ['stylua', styluaArgs(root, cwd, exists)],
    ['selene', ['src']],
  ];
  // type check (rojo sourcemap, then luau-lsp) only when the Roblox definitions file exists
  const defs = path.join(cwd, '.types', 'globalTypes.d.luau');
  const typed = exists(defs);
  if (typed) plan.push(['rojo', ['sourcemap', 'default.project.json', '-o', 'sourcemap.json']], ['luau-lsp', ['analyze', `--definitions=${defs}`, '--sourcemap=sourcemap.json', 'src']]);
  const steps = [];
  for (const [cmd, args] of plan) {
    const label = [cmd, ...args].join(' ');
    const r = await run(cmd, args, { cwd, timeout: 120000, root });
    if (r.missing) steps.push({ cmd: label, ok: true, skipped: true, code: null, tail: `${cmd} is not installed; skipped` });
    else steps.push({ cmd: label, ok: r.code === 0, code: r.code, tail: tail(r.out) });
  }
  if (!typed) steps.push({ cmd: 'luau-lsp analyze', ok: true, skipped: true, code: null, tail: 'no .types/globalTypes.d.luau in this game: type check skipped' });
  return { game: slug, folder, steps, ok: steps.every((s) => s.ok) };
}
