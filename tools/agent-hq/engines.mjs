import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const isWin = process.platform === 'win32';

function find(name) {
  try {
    const out = execFileSync(isWin ? 'where' : 'which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!isWin) return lines[0] ?? null;
    // Windows: only spawnable files count (the extensionless npm shim is a sh script)
    return lines.find((l) => /\.exe$/i.test(l)) ?? lines.find((l) => /\.(cmd|bat)$/i.test(l)) ?? null;
  } catch {
    return null;
  }
}

/** Resolved once at startup. Only the optional claude-cli engine needs an exe; "echo" is built in. */
export function detectEngines() {
  return { 'claude-cli': find('claude') };
}

/**
 * Node refuses to spawn .cmd/.bat with shell:false (EINVAL), and we never use a shell for user text.
 * npm shims just forward to a real exe or js file, so read the target out of the shim.
 */
function resolveCommand(exe, args) {
  if (!/\.(cmd|bat)$/i.test(exe)) return { command: exe, args };
  const shim = fs.readFileSync(exe, 'utf8');
  const m = shim.match(/"%dp0%\\([^"]+\.(?:exe|js|mjs|cjs))"/i);
  if (!m) throw new Error(`cannot resolve ${exe} without a shell`);
  const target = path.join(path.dirname(exe), m[1]);
  return /\.exe$/i.test(target)
    ? { command: target, args }
    : { command: process.execPath, args: [target, ...args] };
}

const ECHO_CODE = `
const ms = Number(process.env.HQ_ECHO_MS || 150);
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ type: 'assistant', message: { content: [{ type: 'text', text: 'echo ok' }] } });
setTimeout(() => { out({ type: 'result', subtype: 'success', result: 'echo ok', total_cost_usd: 0, session_id: 'echo-session' }); process.exit(0); }, ms);
`;

/** Replace bare Edit/Write with path rules from the role's files (Edit(path) also covers Write and NotebookEdit; both are listed to be explicit). */
export function scopedWriteTools(allowedTools = [], files = [], gameDir = '.') {
  const writes = allowedTools.some((t) => t === 'Edit' || t === 'Write');
  const rest = allowedTools.filter((t) => t !== 'Edit' && t !== 'Write');
  if (!writes) return { allowed: rest, disallowed: ['Edit', 'Write', 'NotebookEdit'] };
  const prefix = !gameDir || gameDir === '.' ? '' : `${gameDir.replace(/\/+$/, '')}/`;
  const rules = [];
  for (const g of files) {
    const glob = String(g).replace(/^\.?\//, '');
    const full = glob.startsWith('assets/') ? glob : prefix + glob;
    rules.push(`Edit(${full})`, `Write(${full})`);
  }
  return { allowed: [...rest, ...rules], disallowed: [] };
}

/** Arguments for the claude CLI. Pure so it can be tested. Headless default mode denies anything not allowed. */
// Windows exposes a PowerShell tool next to Bash; every allow rule is written for Bash, so PowerShell is always off.
export function claudeArgs({ brief, model, allowedTools = [], files = [], gameDir = '.', mcpConfigPath, studio = false }) {
  const scoped = scopedWriteTools(allowedTools, files, gameDir);
  // agents run the probes as `python -u scripts/...` (unbuffered output); allow that form of an allowed python rule too
  const py = scoped.allowed.filter((t) => t.startsWith('Bash(python scripts/')).map((t) => t.replace('Bash(python ', 'Bash(python -u '));
  const allowed = [...scoped.allowed, ...py, ...(studio ? ['mcp__Roblox_Studio__*'] : [])];
  const disallowed = [...scoped.disallowed, 'PowerShell'];
  return [
    '-p', brief, '--output-format', 'stream-json', '--verbose',
    '--model', model || 'sonnet',
    '--permission-mode', 'default',
    '--allowedTools', ...allowed,
    '--disallowedTools', ...disallowed,
    '--mcp-config', mcpConfigPath, '--strict-mcp-config',
  ];
}

export function spawnEngine({ engine, exe, brief, model, allowedTools = [], files = [], gameDir = '.', mcpConfigPath, cwd, env, studio = false }) {
  let command, args;
  if (engine === 'echo') {
    command = process.execPath;
    args = ['-e', ECHO_CODE];
  } else if (engine === 'claude-cli') {
    ({ command, args } = resolveCommand(exe, claudeArgs({ brief, model, allowedTools, files, gameDir, mcpConfigPath, studio })));
  } else if (engine === 'groq' || engine === 'nim') {
    command = process.execPath; // exe is llm-agent.mjs; it reads the brief, key and role from env
    args = [exe];
  } else {
    throw new Error(`unknown engine: ${engine}`);
  }
  return spawn(command, args, {
    cwd, env: env ?? process.env, shell: false, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !isWin, // own process group so cancel can kill the tree with process.kill(-pid)
  });
}
