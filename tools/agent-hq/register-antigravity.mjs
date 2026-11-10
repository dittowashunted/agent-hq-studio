// Registers Agent HQ with the Antigravity app:
//   1. the "agent-hq" MCP entry in mcp_config.json
//   2. the "Agent HQ design lane" scheduled automation (sidecar.json)
// It never enables the automation: the owner does that in Antigravity > Automations.
// Usage: node register-antigravity.mjs [--dry-run] [--remove] [--home <dir>] [--every <minutes>]
// --every is how often the lane checks in (default 5; match Settings > Lanes, then run this again after changing it).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cronFor } from './run-mode.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const remove = args.includes('--remove');
const homeIdx = args.indexOf('--home');
const everyIdx = args.indexOf('--every');
const every = Number(everyIdx >= 0 ? args[everyIdx + 1] : process.env.HQ_ANTIGRAVITY_EVERY) || 5;
const home = homeIdx >= 0 ? args[homeIdx + 1] : os.homedir();

const repo = path.resolve(import.meta.dirname, '../..');
const mcpPath = path.join(import.meta.dirname, 'mcp.mjs');
const entry = { command: process.execPath, args: [mcpPath] };
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

const PROMPT =
  'Agent HQ design lane. First call the agent-hq MCP tool hq_lane_gate with engine "antigravity". ' +
  'If run is false, stop immediately and do nothing else. ' +
  'Otherwise repeat up to maxTasks times: call hq_next_task with engine "antigravity" (if the queue is empty, stop); ' +
  'read the art rules and skill named in the brief (.agents/rules/agent-hq-art-direction.md, then the roblox-ui-concept or roblox-store-art skill); ' +
  'create the images with generate_image; run its scored self-check on every image; ' +
  'save each under assets/concepts/<taskId>-<n>.png; call hq_add_media for each; optionally record a lesson with hq_learn; then hq_complete. ' +
  'If the hq_* tools are not available, use node tools/agent-hq/hqctl.mjs instead (see --help).';

const sidecar = () => ({
  builtin: 'schedule',
  args: [`CRON_TZ=${Intl.DateTimeFormat().resolvedOptions().timeZone} ${cronFor(every)}`, 'agentapi', 'new-conversation', '--', PROMPT],
  restart_policy: 'always',
  display_name: 'Agent HQ design lane',
  description: `Every ${every} minutes, asks Agent HQ whether to work (HQ cadence settings decide), makes the queued concept images under the art rules, and reports back.`,
  agent_permissions: {
    workspace_uris: [pathToFileURL(repo).href],
    access_grants: [
      'mcp(agent-hq/hq_next_task)', 'mcp(agent-hq/hq_note)', 'mcp(agent-hq/hq_ask_owner)',
      'mcp(agent-hq/hq_add_media)', 'mcp(agent-hq/hq_complete)', 'mcp(agent-hq/hq_vault)',
      'mcp(agent-hq/hq_lane_gate)', 'mcp(agent-hq/hq_learn)',
      `read_file(${path.join(repo, 'src/client/UI')})`, `read_file(${path.join(repo, 'docs')})`,
      `read_file(${path.join(repo, '.claude/skills')})`, `read_file(${path.join(repo, '.agents')})`,
      `read_file(${path.join(repo, 'assets')})`, `read_file(${path.join(repo, 'captures')})`,
      `write_file(${path.join(repo, 'assets/concepts')})`,
    ],
  },
});

const json = (o) => JSON.stringify(o, null, 4) + '\n';
const backup = (file) => fs.existsSync(file) && fs.copyFileSync(file, `${file}.bak-${stamp()}`);

// ---- MCP config. The first file is created if missing; the second only if it exists. ----
const mcpTargets = [
  { file: path.join(home, '.gemini/config/mcp_config.json'), create: true },
  { file: path.join(home, '.gemini/antigravity/mcp_config.json'), create: false },
];
for (const { file, create } of mcpTargets) {
  const exists = fs.existsSync(file);
  if (!exists && !create) continue;
  let cfg = {};
  if (exists) {
    try { cfg = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
    catch (e) { console.error(`skip ${file}: not valid JSON (${e.message})`); process.exitCode = 1; continue; }
  }
  cfg.mcpServers = { ...(cfg.mcpServers ?? {}) };
  if (remove) delete cfg.mcpServers['agent-hq']; else cfg.mcpServers['agent-hq'] = entry;
  if (dryRun) { console.log(`# ${file}\n${json(cfg)}`); continue; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  backup(file);
  fs.writeFileSync(file, json(cfg));
  console.log(`${remove ? 'removed agent-hq from' : 'registered agent-hq in'} ${file}`);
}

// ---- Scheduled automation (no "enabled" flag is ever written) ----
const sidecarDir = path.join(home, '.gemini/config/sidecars/agent-hq-design');
const sidecarFile = path.join(sidecarDir, 'sidecar.json');
if (remove) {
  if (dryRun) console.log(`# would remove ${sidecarDir}`);
  else { fs.rmSync(sidecarDir, { recursive: true, force: true }); console.log(`removed ${sidecarDir}`); }
} else if (dryRun) {
  console.log(`# ${sidecarFile}\n${json(sidecar())}`);
} else {
  fs.mkdirSync(sidecarDir, { recursive: true });
  backup(sidecarFile);
  fs.writeFileSync(sidecarFile, json(sidecar()));
  console.log(`wrote ${sidecarFile} (enable it in Antigravity > Automations)`);
}
