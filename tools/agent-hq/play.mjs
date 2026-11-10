// Play: build the game's place file with rojo and open it in the default app (Roblox Studio). It never publishes.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { findExe } from './readiness.mjs';

export class PlayError extends Error {
  constructor(message) { super(message); this.status = 409; this.expose = true; }
}

const runDefault = (cmd, args, opts) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 120000, windowsHide: true, ...opts }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve({ stdout, stderr })));
});

// explorer.exe, open and xdg-open all hand a file to its default app; no shell is involved
const openDefault = (file) => new Promise((resolve, reject) => {
  const [cmd, ...args] = process.platform === 'win32' ? ['explorer.exe', file] : process.platform === 'darwin' ? ['open', file] : ['xdg-open', file];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.once('error', reject);
  child.once('spawn', () => { child.unref(); resolve(); });
});

export function createPlay({ root, stateDir, find = findExe, run = runDefault, open = openDefault }) {
  /** Build <root>/default.project.json into <stateDir>/builds/<slug>.rbxlx and open it. Returns { ok, file }. */
  return async function play(slug) {
    const rojo = find('rojo');
    if (!rojo) throw new PlayError('Rojo is not installed on this PC, so the place cannot be built. Install it with aftman, then try again.');
    const project = path.join(root, 'default.project.json');
    if (!fs.existsSync(project)) throw new PlayError('default.project.json was not found in the repo, so there is nothing to build.');
    const file = path.join(stateDir, 'builds', `${slug}.rbxlx`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { await run(rojo, ['build', project, '-o', file], { cwd: root }); } catch (e) {
      throw new PlayError(`Rojo could not build the place: ${String(e.stderr || e.message).trim().split(/\r?\n/)[0].slice(0, 200)}`);
    }
    try { await open(file); } catch (e) { throw new PlayError(`The place was built but could not be opened: ${String(e.message).slice(0, 160)}`); }
    return { ok: true, file };
  };
}
