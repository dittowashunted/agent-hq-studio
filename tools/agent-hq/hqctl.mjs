#!/usr/bin/env node
// Command-line fallback for the hq_* MCP tools, for sessions where the agent-hq MCP server is not loaded.
// It reuses the MCP handlers, so validation and behaviour are identical. Prints JSON.
// Talks to HQ_URL (default http://127.0.0.1:4317) with the token from .agent-hq/token.

import fs from 'node:fs';

const USAGE = `Agent HQ command line (same actions as the hq_* MCP tools). Run from the repo root.
Every command that touches a task (note, ask, media, complete, learn, pitch, idea, stage, asset, metric) also needs the task token from your brief:
  add  --token <taskToken>  to the command, or set the HQ_TASK_TOKEN environment variable. Never share it or use another task's token.

  node tools/agent-hq/hqctl.mjs gate <engine> [--manual]                    should this lane work now? (engine: app | antigravity)
  node tools/agent-hq/hqctl.mjs next <engine>                              take the oldest queued task, prints {task, brief}
  node tools/agent-hq/hqctl.mjs note <taskId> <text>                       progress note to the role thread
  node tools/agent-hq/hqctl.mjs ask <taskId> <kind> <title> <why>          ask the owner (kind: decision | try | approve | review)
  node tools/agent-hq/hqctl.mjs media <taskId> <path> <ask>                attach an image from the repo for review
  node tools/agent-hq/hqctl.mjs complete <taskId> <summary> [--state review|done|failed]
  node tools/agent-hq/hqctl.mjs learn <taskId> <lesson>                    record a reusable lesson for the task's role
  node tools/agent-hq/hqctl.mjs pitch '<json>' | <file.json> --task <taskId>   the full pitch schema (see hq_pitch)
  node tools/agent-hq/hqctl.mjs idea '<json>' | <file.json> --task <taskId>    scout: score an owner idea {ideaId, verdict, rows, change} (see hq_idea_score)
  node tools/agent-hq/hqctl.mjs stage <game> <toStage> <evidence> --task <taskId>      producer and lead: request the next stage
  node tools/agent-hq/hqctl.mjs asset <name> <kind> <scope> <file> --task <taskId> [--tags a,b]   librarian: add an asset to the index
  node tools/agent-hq/hqctl.mjs metric <game> <key> <value> --task <taskId> [--date YYYY-MM-DD]   live ops: record a measured number
  node tools/agent-hq/hqctl.mjs prefs-propose <role> <items>               propose standing preferences (role id or studio; items = JSON array or one text) --task <taskId>
  node tools/agent-hq/hqctl.mjs research-save <title> <url> <summary>      keep a web finding for later agents --task <taskId>
  node tools/agent-hq/hqctl.mjs game-create <name> [pitch] --task <taskId>    lead: create a game
  node tools/agent-hq/hqctl.mjs task-move <game|none> <taskId...> --task <leadTaskId>   lead: move tasks and their children to a game
  node tools/agent-hq/hqctl.mjs game-check <slug> --task <id>              run your task's game tests, format and lint inside its folder
  node tools/agent-hq/hqctl.mjs market                                     latest Roblox charts snapshot
  node tools/agent-hq/hqctl.mjs knowledge-search <words> [--limit N]       search the local Roblox notes (LihFolk, Creator docs, cards, research); prints text
  node tools/agent-hq/hqctl.mjs knowledge-read <source> <path> [--section <heading words>]   read one note found by knowledge-search
  node tools/agent-hq/hqctl.mjs notebook [--limit N]                       read the shared notebook; prints text
  node tools/agent-hq/hqctl.mjs notebook-section <id>                      read one game bible section (G1.3 = 3D models)
  node tools/agent-hq/hqctl.mjs notebook-mirror <file> --lane-token <t> [--source <docUrl>]  store the exported Google Doc text (lane worker)
  node tools/agent-hq/hqctl.mjs notebook-add <text> --task <taskId>        add one short note to the shared notebook
  node tools/agent-hq/hqctl.mjs --help
`;

const argv = process.argv.slice(2);
const flags = new Set();
const pos = [];
const opt = {}; // --state, --task, --tags, --date, --section, --limit
for (let i = 0; i < argv.length; i++) {
  if (['--state', '--task', '--tags', '--date', '--token', '--section', '--limit', '--lane-token', '--source'].includes(argv[i])) opt[argv[i].slice(2)] = argv[++i];
  else if (argv[i] === '--manual') flags.add('manual');
  else if (argv[i] === '--help' || argv[i] === '-h') flags.add('help');
  else pos.push(argv[i]);
}

// writeSync so a large brief is never cut off. After a network call we let the process end by itself:
// process.exit() with live fetch sockets can crash node on Windows.
const out = (o, code = 0, exit = true) => { fs.writeSync(1, JSON.stringify(o, null, 2) + '\n'); process.exitCode = code; if (exit) process.exit(code); };
const fail = (msg, exit = true) => out({ error: msg }, 1, exit);

if (flags.has('help') || pos.length === 0) {
  console.log(USAGE);
  process.exit(flags.has('help') ? 0 : 1);
}

// Explicit arguments only: never inherit a task or role from the environment.
delete process.env.HQ_TASK;
delete process.env.HQ_ROLE;
// The task token comes from --token, else from HQ_TASK_TOKEN. mcp.mjs reads the environment when it loads.
if (opt.token) process.env.HQ_TASK_TOKEN = opt.token;
const { handlers, api } = await import('./mcp.mjs');

const [cmd, ...a] = pos;
const arity = { gate: 1, next: 1, note: 2, ask: 4, media: 3, complete: 2, learn: 2, pitch: 1, idea: 1, market: 0, stage: 3, asset: 4, metric: 3, 'knowledge-search': 1, 'knowledge-read': 2, notebook: 0, 'notebook-add': 1, 'notebook-section': 1, 'notebook-mirror': 1, 'prefs-propose': 2, 'research-save': 3, 'game-create': 1, 'task-move': 2, 'game-check': 1 };
if (!(cmd in arity)) fail(`unknown command "${cmd}". Run with --help.`);
const TASK_COMMANDS = ['game-create', 'task-move', 'notebook-add', 'note', 'ask', 'media', 'complete', 'learn', 'pitch', 'idea', 'stage', 'asset', 'metric', 'prefs-propose', 'research-save'];
if (TASK_COMMANDS.includes(cmd) && !process.env.HQ_TASK_TOKEN) fail(`"${cmd}" needs your task token: add --token <taskToken> (it is in your brief) or set HQ_TASK_TOKEN.`);
if (['game-create', 'task-move', 'stage', 'asset', 'metric', 'pitch', 'idea', 'notebook-add', 'prefs-propose', 'research-save'].includes(cmd) && !opt.task) fail(`"${cmd}" needs --task <taskId> (the working task of the role that may do this).`);
if (cmd === 'game-create' && a.length === 2) arity[cmd] = 2;
if (cmd === 'task-move' && a.length > 2) arity[cmd] = a.length;
if (a.length !== arity[cmd]) fail(`"${cmd}" takes ${arity[cmd]} argument(s), got ${a.length}. Run with --help.`);

try {
  let res; let text; // knowledge commands print text (with the reference-data line first), the rest print JSON
  if (cmd === 'gate') res = await handlers.hq_lane_gate({ engine: a[0], manual: flags.has('manual') });
  else if (cmd === 'next') res = await handlers.hq_next_task({ engine: a[0] });
  else if (cmd === 'note') res = await handlers.hq_note({ taskId: a[0], text: a[1] });
  else if (cmd === 'ask') res = await handlers.hq_ask_owner({ taskId: a[0], kind: a[1], title: a[2], why: a[3] });
  else if (cmd === 'media') res = await handlers.hq_add_media({ taskId: a[0], path: a[1], ask: a[2] });
  else if (cmd === 'complete') res = await handlers.hq_complete({ taskId: a[0], summary: a[1], ...(opt.state ? { state: opt.state } : {}) });
  else if (cmd === 'learn') res = await handlers.hq_learn({ taskId: a[0], lesson: a[1] });
  else if (cmd === 'pitch') {
    let p; try { p = JSON.parse(fs.existsSync(a[0]) ? fs.readFileSync(a[0], 'utf8') : a[0]); } catch { fail('pitch needs a JSON object or a path to a JSON file'); }
    res = await handlers.hq_pitch({ ...p, taskId: opt.task });
  } else if (cmd === 'idea') {
    let p; try { p = JSON.parse(fs.existsSync(a[0]) ? fs.readFileSync(a[0], 'utf8') : a[0]); } catch { fail('idea needs a JSON object or a path to a JSON file'); }
    res = await handlers.hq_idea_score({ ...p, taskId: opt.task });
  } else if (cmd === 'stage') {
    res = await handlers.hq_stage_request({ taskId: opt.task, game: a[0], toStage: a[1], evidence: a[2] });
  } else if (cmd === 'asset') {
    res = await handlers.hq_asset_add({ taskId: opt.task, name: a[0], kind: a[1], scope: a[2], file: a[3], tags: opt.tags ? opt.tags.split(',').map((t) => t.trim()).filter(Boolean) : [] });
  } else if (cmd === 'metric') {
    res = await handlers.hq_metric({ taskId: opt.task, game: a[0], key: a[1], value: Number(a[2]), ...(opt.date ? { date: opt.date } : {}) });
  } else if (cmd === 'prefs-propose') {
    let items = a[1]; try { const j = JSON.parse(a[1]); if (Array.isArray(j)) items = j; } catch { /* one plain text */ }
    res = await handlers.hq_preferences_propose({ taskId: opt.task, role: a[0], items: Array.isArray(items) ? items : [items] });
  } else if (cmd === 'game-create') {
    res = await handlers.hq_game_create({ taskId: opt.task, name: a[0], ...(a[1] ? { pitch: a[1] } : {}) });
  } else if (cmd === 'task-move') {
    res = await handlers.hq_task_move({ taskId: opt.task, game: a[0] === 'none' ? null : a[0], taskIds: a.slice(1) });
  } else if (cmd === 'research-save') {
    res = await handlers.hq_research_save({ taskId: opt.task, title: a[0], url: a[1], summary: a[2] });
  } else if (cmd === 'game-check') {
    text = await handlers.hq_game_check({ game: a[0], taskId: opt.task });
  } else if (cmd === 'knowledge-search') {
    text = await handlers.hq_knowledge_search({ q: a[0], ...(opt.limit ? { limit: Number(opt.limit) } : {}) });
  } else if (cmd === 'notebook') {
    text = await handlers.hq_notebook_read({ ...(opt.limit ? { limit: Number(opt.limit) } : {}) });
  } else if (cmd === 'notebook-section') {
    text = await handlers.hq_notebook_read({ section: a[0] });
  } else if (cmd === 'notebook-mirror') {
    text = await handlers.hq_notebook_mirror({ markdown: fs.readFileSync(a[0], 'utf8'), laneToken: opt['lane-token'], ...(opt.source ? { source: opt.source } : {}) });
  } else if (cmd === 'notebook-add') {
    res = await handlers.hq_notebook_add({ taskId: opt.task, text: a[0] });
  } else if (cmd === 'knowledge-read') {
    text = await handlers.hq_knowledge_read({ source: a[0], path: a[1], ...(opt.section ? { section: opt.section } : {}) });
  } else res = await api('GET', '/api/market');
  if (text !== undefined) fs.writeSync(1, `${text}\n`);
  else out(typeof res === 'string' ? { task: null, message: res } : res, 0, false);
} catch (e) {
  fail(String(e.message ?? e), false);
}
