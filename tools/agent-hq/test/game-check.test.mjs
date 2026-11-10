import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGameCheck, styluaArgs } from '../game-check.mjs';
import { claudeArgs } from '../engines.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-'));
fs.mkdirSync(path.join(root, 'games/top-eleven'), { recursive: true });
fs.writeFileSync(path.join(root, 'games/top-eleven/default.project.json'), '{}');
fs.writeFileSync(path.join(root, 'stylua.toml'), '');

test('runs in the game folder, skips a missing tool, caps the tail, uses the root stylua config', async () => {
  const calls = [];
  const run = async (cmd, args, o) => {
    calls.push({ cmd, args, ...o });
    if (cmd === 'selene') return { missing: true };
    return { code: cmd === 'lune' ? 0 : 1, out: 'x'.repeat(9000) };
  };
  const r = await runGameCheck({ root, slug: 'top-eleven', run });
  assert.equal(r.folder, 'games/top-eleven');
  assert.ok(calls.every((c) => c.cwd === path.resolve(root, 'games/top-eleven') && c.timeout === 120000));
  assert.equal(r.steps[0].ok, true);
  assert.equal(r.steps[0].tail.length, 4096);
  assert.equal(r.steps[2].skipped, true);
  assert.equal(r.ok, false);
  assert.deepEqual(calls[1].args, ['--check', '--config-path', path.join(root, 'stylua.toml'), 'src', 'tests']);
});

test('stylua keeps the game config when it has one; the repo-root game needs no flag', () => {
  const game = path.join(root, 'games/top-eleven');
  assert.deepEqual(styluaArgs(root, game, (p) => p === path.join(game, 'stylua.toml')), ['--check', 'src', 'tests']);
  assert.deepEqual(styluaArgs(root, root, () => true), ['--check', 'src', 'tests']);
});

test('claudeArgs scopes edits to the role files in the game folder', () => {
  const builder = claudeArgs({ brief: 'b', model: 'sonnet', allowedTools: ['Read', 'Edit', 'Write', 'Skill'], files: ['src/server/**', 'assets/**'], gameDir: 'games/top-eleven', mcpConfigPath: 'm.json' });
  assert.equal(builder[builder.indexOf('--permission-mode') + 1], 'default');
  assert.ok(builder.includes('Edit(games/top-eleven/src/server/**)'));
  assert.ok(builder.includes('Write(games/top-eleven/src/server/**)'));
  assert.ok(builder.includes('Edit(assets/**)'));
  assert.ok(!builder.includes('Edit') && !builder.includes('Write'));
  // a writer keeps its edit rules; only PowerShell is off (all rules are written for Bash)
  assert.deepEqual(builder.slice(builder.indexOf('--disallowedTools'), builder.indexOf('--disallowedTools') + 2), ['--disallowedTools', 'PowerShell']);
  assert.ok(!builder.includes('mcp__Roblox_Studio__*'));
  for (const tools of [['Read', 'mcp__hq__*'], ['Read', 'Grep']]) {
    const a = claudeArgs({ brief: 'b', allowedTools: tools, files: ['docs/**'], gameDir: 'games/top-eleven', mcpConfigPath: 'm.json' });
    const i = a.indexOf('--disallowedTools');
    assert.deepEqual(a.slice(i, i + 5), ['--disallowedTools', 'Edit', 'Write', 'NotebookEdit', 'PowerShell']);
    assert.ok(!a.some((x) => x.startsWith('Edit(')));
  }
});

test('game check: tests never see HQ tokens or provider keys', async () => {
  const { scrubbedEnv } = await import('../game-check.mjs');
  const env = scrubbedEnv({ PATH: 'p', HQ_TOKEN: 'a', HQ_TASK_TOKEN: 'b', GROQ_API_KEY: 'c', ANTHROPIC_API_KEY: 'd', HOME: 'h', GITHUB_TOKEN: 'e', AWS_SECRET_ACCESS_KEY: 'f' });
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'PATH']);
});

test('game check: a tool planted inside the repo is never run', async () => {
  const { resolveTool } = await import('../game-check.mjs');
  const root = path.resolve('C:/repo');
  assert.equal(resolveTool('lune', root, () => path.join(root, 'games', 'x', 'lune.exe')), null);
  assert.equal(resolveTool('lune', root, () => 'C:/tools/lune.exe'), 'C:/tools/lune.exe');
  assert.equal(resolveTool('lune', root, () => null), null);
});

test('claudeArgs: a Studio task may use the Roblox Studio MCP tools', () => {
  const a = claudeArgs({ brief: 'b', allowedTools: ['Read'], files: [], mcpConfigPath: 'm.json', studio: true });
  assert.ok(a.includes('mcp__Roblox_Studio__*'));
});

test('game check: the type check is reported as skipped without the Roblox definitions file', async () => {
  const r = await runGameCheck({ root: path.resolve('C:/repo'), slug: 'space-agency', run: async () => ({ code: 0, out: 'ok' }), exists: () => false });
  const t = r.steps.find((s) => s.cmd.startsWith('luau-lsp'));
  assert.ok(t.skipped && /globalTypes/.test(t.tail));
});

test('runner: Studio MCP only for Studio roles, pinned to the Roblox launcher, never from repo files', async () => {
  const { studioServer } = await import('../runner.mjs');
  const env = { LOCALAPPDATA: 'C:/Users/x/AppData/Local', SystemRoot: 'C:/Windows' };
  assert.equal(studioServer({ mcp: [] }, { env, exists: () => true }), null);
  assert.equal(studioServer({ mcp: ['Roblox_Studio'] }, { env, exists: () => false }), null);
  const s = studioServer({ mcp: ['Roblox_Studio'] }, { env, exists: () => true });
  assert.match(s.command, /System32[\\/]cmd\.exe$/);
  assert.deepEqual(s.args, ['/c', path.join('C:/Users/x/AppData/Local', 'Roblox', 'mcp.bat')]);
});

test('claudeArgs: an allowed python scripts rule also allows the unbuffered -u form', () => {
  const a = claudeArgs({ brief: 'b', allowedTools: ['Read', 'Bash(python scripts/*)'], files: [], mcpConfigPath: 'm.json' });
  assert.ok(a.includes('Bash(python scripts/*)') && a.includes('Bash(python -u scripts/*)'));
  assert.ok(!claudeArgs({ brief: 'b', allowedTools: ['Read'], files: [], mcpConfigPath: 'm.json' }).some((x) => x.includes('python')));
});
