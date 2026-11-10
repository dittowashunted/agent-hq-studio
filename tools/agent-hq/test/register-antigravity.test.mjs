import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const regFile = path.resolve(import.meta.dirname, '../register-antigravity.mjs');

test('register-antigravity: dry run writes nothing, install merges, remove cleans up', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-home-'));
  const file = path.join(home, '.gemini/config/mcp_config.json');
  const sc = path.join(home, '.gemini/config/sidecars/agent-hq-design/sidecar.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const original = JSON.stringify({ mcpServers: { Roblox_Studio: { command: 'cmd.exe', args: ['/c', 'x'] } } });
  fs.writeFileSync(file, original);

  const out = spawnSync(process.execPath, [regFile, '--dry-run', '--home', home], { encoding: 'utf8' }).stdout;
  assert.match(out, /Roblox_Studio/);
  assert.match(out, /agent-hq/);
  assert.match(out, /sidecar\.json/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.ok(!fs.existsSync(sc), 'dry run wrote no sidecar');

  spawnSync(process.execPath, [regFile, '--home', home]);
  const merged = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(merged.mcpServers.Roblox_Studio && merged.mcpServers['agent-hq']);
  assert.ok(fs.readdirSync(path.dirname(file)).some((f) => f.includes('.bak-')));
  const side = JSON.parse(fs.readFileSync(sc, 'utf8'));
  assert.equal(side.builtin, 'schedule');
  assert.match(side.args[0], /^CRON_TZ=\S+ \*\/5 \* \* \* \*$/);
  assert.equal(side.display_name, 'Agent HQ design lane');
  assert.equal(side.restart_policy, 'always');
  assert.ok(!('enabled' in side));
  for (const g of ['mcp(agent-hq/hq_next_task)', 'mcp(agent-hq/hq_lane_gate)', 'mcp(agent-hq/hq_learn)']) {
    assert.ok(side.agent_permissions.access_grants.includes(g), g);
  }
  assert.ok(side.agent_permissions.access_grants.some((g) => /^read_file\(.*\.agents\)$/.test(g)));
  assert.match(side.args.at(-1), /hq_lane_gate/);
  assert.match(side.agent_permissions.workspace_uris[0], /^file:\/\/\//);

  spawnSync(process.execPath, [regFile, '--home', home, '--every', '15']);
  assert.match(JSON.parse(fs.readFileSync(sc, 'utf8')).args[0], / \*\/15 \* \* \* \*$/);

  spawnSync(process.execPath, [regFile, '--remove', '--home', home]);
  const removed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(removed.mcpServers.Roblox_Studio && !removed.mcpServers['agent-hq']);
  assert.ok(!fs.existsSync(path.dirname(sc)), 'sidecar folder removed');
  fs.rmSync(home, { recursive: true, force: true });
});
