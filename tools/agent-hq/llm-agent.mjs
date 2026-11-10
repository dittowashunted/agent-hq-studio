// Runs one HQ task on an OpenAI-compatible API (Groq, NVIDIA NIM) with a small tool loop. Spawned by runner.mjs the
// same way as the claude CLI, and prints the same stream-json lines ({type:'assistant'}, {type:'result'}) it parses.
// Tools: read/search the repo, write and edit inside the role's own files, run the role's allow-listed check commands,
// fetch public web pages, and the hq_* reporting tools. No shell, ever.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import dns from 'node:dns/promises';
import { spawn } from 'node:child_process';
import { chat, listModels, pickModel, PROVIDERS } from './providers.mjs';
import { TOOLS as HQ_TOOLS, handlers } from './mcp.mjs';

export const ROOT = process.env.HQ_ROOT ? path.resolve(process.env.HQ_ROOT) : path.resolve(import.meta.dirname, '../..');
const DENY = /(^|\/)(\.agent-hq|\.git|node_modules)(\/|$)|(^|\/)\.env[^/]*$|owner-token|\.pem$|\.key$/i;
const TEXT_MAX = 14000; // per tool result sent to the model
const OLD_MAX = 700; // tool results older than the last few turns are cut to this, to keep every request small

const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n...[${s.length - n} more chars cut]` : s);

/** Repo-relative path, or throws for anything outside the repo or on the deny list. */
export function safePath(p) {
  if (typeof p !== 'string' || !p.trim()) throw new Error('path is required');
  const abs = path.resolve(ROOT, p.replace(/\\/g, '/'));
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('path is outside the repo');
  if (DENY.test(rel)) throw new Error('that path is off limits');
  return { abs, rel };
}

/** Glob ("src/server/**", "docs/*.md") to a RegExp over repo-relative paths. */
export const globRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*') + '$');

/** "Bash(stylua:*)" -> "stylua"; "Bash(python scripts/*)" -> "python scripts/". */
export const commandPrefixes = (allowed = []) => allowed
  .map((t) => /^Bash\((.+)\)$/.exec(t)?.[1]).filter(Boolean).map((s) => s.replace(/:\*$/, '').replace(/\*$/, ''));

// The only flags each check command may take (exact, or a "--name=" prefix); any other "-..." argument is refused,
// so a prefix like "git diff" cannot smuggle --output=<file> and friends.
const FLAGS = {
  stylua: ['--check'], selene: [], lune: [], rojo: ['-o', '--output'], 'luau-lsp': ['--definitions=', '--sourcemap='],
  python: [], git: ['--stat', '--name-only', '--'],
};

/** argv for an allowed command, or throws. Plain words only: no shell operators, no "..", allow-listed flags, repo paths. */
export function checkCommand(cmd, prefixes) {
  if (typeof cmd !== 'string' || cmd.length > 400) throw new Error('command is required');
  if (/[|;&<>`$\n\r'"]|\.\./.test(cmd)) throw new Error('shell operators, quotes and ".." are not allowed');
  const c = cmd.trim().replace(/\s+/g, ' ');
  const p = prefixes.find((x) => c === x.trim() || c.startsWith(x.endsWith('/') ? x : x + ' '));
  if (!p) throw new Error(`not allowed. Allowed commands start with: ${prefixes.join(', ') || '(none for this role)'}`);
  const argv = c.split(' ');
  const fixed = p.trim().split(' ').length - (p.endsWith('/') ? 1 : 0); // "python scripts/" fixes only "python"
  const flags = FLAGS[argv[0]] ?? [];
  for (const a of argv.slice(fixed)) {
    if (a.startsWith('-')) {
      if (!flags.some((f) => (f.endsWith('=') ? a.startsWith(f) : a === f))) throw new Error(`flag ${a} is not allowed for ${argv[0]}`);
      const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : '';
      if (v) safePath(v);
    } else if (/[\\/.]/.test(a) || /^[a-z]:/i.test(a)) {
      if (path.isAbsolute(a) || /^[a-z]:/i.test(a)) throw new Error('absolute paths are not allowed');
      safePath(a); // the deny list applies to every path-like argument
    }
  }
  return argv;
}

/** The parent env without HQ credentials or the API key, for check commands. */
export const childEnv = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([k]) => !/^HQ_/i.test(k)));

const TEXT_EXT = /\.(luau|lua|md|json|toml|mjs|js|ts|css|html|txt|ya?ml|py|ps1|bat|csv)$/i;
function walk(dir, out, limit) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (out.length >= limit) return;
    const abs = path.join(dir, e.name);
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    if (DENY.test(rel)) continue;
    if (e.isDirectory()) walk(abs, out, limit); else out.push(rel);
  }
}

/** True for loopback, private, link-local, unspecified and IPv4-mapped forms of them. */
export function privateIp(ip) {
  const a = String(ip).toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:/, '');
  if (net.isIPv4(a)) return /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(a);
  return a === '::' || a === '::1' || /^(fc|fd|fe[89ab])/.test(a);
}

/** Throws unless the URL is https on a public host whose every DNS address is public. */
async function assertPublic(u) {
  if (u.protocol !== 'https:') throw new Error('only https URLs');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error('only public hosts');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((x) => privateIp(x.address))) throw new Error('only public hosts');
}

/** GET with every redirect hop re-checked. ponytail: DNS is checked, not pinned (rebinding window); pin with an undici Agent if this ever fetches untrusted hosts unattended at scale. */
async function safeFetch(url, hops = 5) {
  let u = new URL(url);
  for (let i = 0; i <= hops; i++) {
    await assertPublic(u);
    const r = await fetch(u, { headers: { 'user-agent': 'AgentHQ/1.0 (+local research)' }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    const loc = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
    if (!loc) return r;
    u = new URL(loc, u);
  }
  throw new Error('too many redirects');
}

function htmlToText(html) {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, ' ')
    .replace(/<(br|p|div|li|h\d|tr)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

const fn = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const S = (description) => ({ type: 'string', description });
const I = (description) => ({ type: 'integer', description });

/** Repo tools for a role: { defs, run(name, args) }. */
export function repoTools(role) {
  const writable = (role.files ?? []).map(globRe);
  const canWrite = role.mode !== 'read' && writable.length > 0;
  const prefixes = commandPrefixes(role.allowedTools);
  const mayWrite = (rel) => {
    if (!canWrite) throw new Error(`the ${role.id} role is read-only`);
    if (!writable.some((re) => re.test(rel))) throw new Error(`you may only write your own files: ${role.files.join(', ')}`);
  };
  const defs = [
    fn('read_file', 'Read a text file. Large files come back in pages: pass offset (first line, 1-based) and limit (lines).', { path: S('Repo-relative path'), offset: I('First line, default 1'), limit: I('Lines, default 300, max 800') }, ['path']),
    fn('list_files', 'List files under a folder (recursive, max 300).', { dir: S('Repo-relative folder, default the repo root'), glob: S('Optional filter like src/**/*.luau') }),
    fn('search', 'Find lines containing text (case-insensitive) in repo text files. Max 60 hits.', { text: S('Text to find'), dir: S('Folder to search, default the repo root'), glob: S('Optional file filter like **/*.luau') }, ['text']),
    fn('fetch_url', 'GET a public web page or JSON API (https only) and return its text, trimmed.', { url: S('https URL') }, ['url']),
  ];
  if (canWrite) {
    defs.push(
      fn('write_file', `Create or replace a whole file. Only inside: ${role.files.join(', ')}.`, { path: S('Repo-relative path'), content: S('Full new file content') }, ['path', 'content']),
      fn('edit_file', 'Replace one exact, unique snippet in a file. Prefer this over write_file for small changes.', { path: S('Repo-relative path'), old: S('Exact existing text, unique in the file'), new: S('Replacement text') }, ['path', 'old', 'new']),
    );
  }
  if (prefixes.length) defs.push(fn('run_check', `Run one allowed check command from the repo root and get its output. Allowed: ${prefixes.join(', ')}.`, { command: S('For example: lune run tests/run') }, ['command']));

  async function run(name, a) {
    switch (name) {
      case 'read_file': {
        const { abs } = safePath(a.path);
        const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
        const from = Math.max(1, Number(a.offset) || 1);
        const n = Math.min(800, Math.max(1, Number(a.limit) || 300));
        const page = lines.slice(from - 1, from - 1 + n).map((l, i) => `${from + i}\t${l}`).join('\n');
        const more = from - 1 + n < lines.length ? `\n[${lines.length} lines total; read on with offset ${from + n}]` : '';
        return page + more;
      }
      case 'list_files': {
        const { abs } = safePath(a.dir || '.');
        const out = []; walk(abs, out, 2000);
        const re = a.glob ? globRe(a.glob) : null;
        const hits = out.filter((p) => !re || re.test(p));
        return hits.slice(0, 300).join('\n') + (hits.length > 300 ? `\n[${hits.length - 300} more]` : '') || '(empty)';
      }
      case 'search': {
        const { abs } = safePath(a.dir || '.');
        const needle = String(a.text ?? '').toLowerCase();
        if (!needle) throw new Error('text is required');
        const re = a.glob ? globRe(a.glob) : null;
        const files = []; walk(abs, files, 5000);
        const hits = [];
        for (const f of files) {
          if (hits.length >= 60) break;
          if (!TEXT_EXT.test(f) || (re && !re.test(f))) continue;
          let txt; try { const st = fs.statSync(path.join(ROOT, f)); if (st.size > 1e6) continue; txt = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
          txt.split(/\r?\n/).forEach((l, i) => { if (hits.length < 60 && l.toLowerCase().includes(needle)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 200)}`); });
        }
        return hits.join('\n') || 'no matches';
      }
      case 'fetch_url': {
        let u; try { u = new URL(a.url); } catch { throw new Error('bad url'); }
        const r = await safeFetch(u.href);
        const type = r.headers.get('content-type') || '';
        const body = await r.text();
        return `HTTP ${r.status} ${type}\n` + (type.includes('html') ? htmlToText(body) : body);
      }
      case 'write_file': {
        const { abs, rel } = safePath(a.path); mayWrite(rel);
        if (typeof a.content !== 'string') throw new Error('content is required');
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        const old = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
        const eol = old?.includes('\r\n') ? '\r\n' : '\n'; // keep the file's line endings
        fs.writeFileSync(abs, a.content.replace(/\r?\n/g, eol));
        return `wrote ${rel} (${a.content.length} chars)`;
      }
      case 'edit_file': {
        const { abs, rel } = safePath(a.path); mayWrite(rel);
        const txt = fs.readFileSync(abs, 'utf8');
        const eol = txt.includes('\r\n') ? '\r\n' : '\n';
        const oldS = String(a.old ?? '').replace(/\r?\n/g, eol);
        const n = oldS ? txt.split(oldS).length - 1 : 0;
        if (n !== 1) throw new Error(n === 0 ? 'old text not found; read the file again and copy it exactly' : `old text appears ${n} times; include more context`);
        fs.writeFileSync(abs, txt.replace(oldS, () => String(a.new ?? '').replace(/\r?\n/g, eol)));
        return `edited ${rel}`;
      }
      case 'run_check': {
        const argv = checkCommand(a.command, prefixes);
        return await new Promise((resolve) => {
          let out = '';
          const child = spawn(argv[0], argv.slice(1), { cwd: ROOT, env: childEnv(), shell: false, windowsHide: true, timeout: 300000 });
          child.stdout.on('data', (d) => { out += d; });
          child.stderr.on('data', (d) => { out += d; });
          child.on('error', (e) => resolve(`could not run: ${e.message}`));
          child.on('close', (code) => resolve(`exit ${code}\n${out.slice(-TEXT_MAX)}`));
        });
      }
      default: throw new Error(`unknown tool ${name}`);
    }
  }
  return { defs, run };
}

// hq tools the model may call; claiming and lane tools belong to workers, not to a task.
const HQ_ALLOWED = new Set(['hq_note', 'hq_ask_owner', 'hq_add_media', 'hq_complete', 'hq_create_task', 'hq_game_create', 'hq_task_move', 'hq_vault', 'hq_learn', 'hq_pitch', 'hq_idea_score', 'hq_stage_request', 'hq_asset_add', 'hq_metric', 'hq_list_tasks', 'hq_knowledge_search', 'hq_knowledge_read', 'hq_notebook_read', 'hq_notebook_add', 'hq_research_save', 'hq_preferences_propose', 'hq_game_check']);
export function hqToolDefs(roleId) {
  return HQ_TOOLS.filter((t) => HQ_ALLOWED.has(t.name) && (!['hq_create_task', 'hq_game_create', 'hq_task_move'].includes(t.name) || roleId === 'lead') && (!['hq_pitch', 'hq_idea_score'].includes(t.name) || roleId === 'scout'))
    .map((t) => {
      const props = { ...t.inputSchema.properties };
      delete props.taskId; delete props.taskToken; // the process env carries them
      return fn(t.name, t.description, props, (t.inputSchema.required ?? []).filter((k) => k !== 'taskId' && k !== 'taskToken'));
    });
}

/** Drops reasoning blocks some models put in content. */
export const stripThink = (s) => String(s ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();

const size = (messages) => messages.reduce((n, m) => n + (m.content?.length ?? 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0);
const CUT_NOTE = '\n...[older result cut; call the tool again if you need it]';
/**
 * Shrinks old tool results in place so each request stays small: those older than the last few messages always,
 * then newer ones too until the conversation fits budgetChars (Groq's free tier allows about 8K tokens a minute).
 */
export function compact(messages, keepLast = 6, budgetChars = Infinity) {
  const cut = messages.length - keepLast;
  const shrink = (m) => { if (m.role === 'tool' && m.content.length > OLD_MAX) m.content = m.content.slice(0, OLD_MAX) + CUT_NOTE; };
  messages.forEach((m, i) => { if (i < cut) shrink(m); });
  for (let i = 2; i < messages.length - 1 && size(messages) > budgetChars; i++) shrink(messages[i]);
}

const SYSTEM = `You are an autonomous agent doing ONE task for Agent HQ on a Roblox (Luau) project. Work with the tools, not by guessing.
- Read only what you need: search first, then read_file the relevant lines.
- Make small, careful edits with edit_file. Keep each file's style. Never touch files outside your role.
- If the role has run_check, run the checks named in the brief after editing and fix what fails.
- You cannot install tools, publish, or spend money. Ask the owner (hq_ask_owner) for anything only a person can do.
- Be brief in your messages. When done, call hq_complete with: files changed, checks run and their result, anything the owner must do.`;

async function main() {
  const env = process.env;
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  const provider = env.HQ_LLM_PROVIDER;
  const key = env.HQ_LLM_KEY;
  const role = JSON.parse(env.HQ_ROLE_JSON || '{}');
  const brief = fs.readFileSync(env.HQ_BRIEF_FILE, 'utf8');
  const maxTurns = Math.min(60, Number(env.HQ_LLM_MAX_TURNS) || (role.mode === 'write' ? 30 : 16));
  let model = env.HQ_LLM_MODEL || '';
  if (!model) model = pickModel(provider, await listModels(provider, key));
  if (!model) throw new Error('no model available for this key');
  out({ type: 'system', subtype: 'init', model, provider });

  const repo = repoTools(role);
  let tools = [...repo.defs, ...hqToolDefs(role.id)];
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: brief }];
  const usage = { input_tokens: 0, output_tokens: 0 };
  const budget = Number(env.HQ_LLM_CTX_CHARS) || PROVIDERS[provider]?.ctxChars || 60000;
  let finalText = ''; let completed = false;

  for (let turn = 0; turn < maxTurns && !completed; turn++) {
    compact(messages, 6, budget);
    let res;
    try {
      res = await chat({ provider, key, model, messages, tools, maxTokens: role.mode === 'write' ? 6000 : 3000 });
    } catch (e) {
      // some models reject the tools param: carry on without tools rather than fail the task
      if (e.status === 400 && tools.length && /tool/i.test(e.message)) { tools = []; out({ type: 'stderr', text: 'model rejected tools; continuing without them' }); turn--; continue; }
      throw e;
    }
    usage.input_tokens += res.usage?.prompt_tokens ?? 0;
    usage.output_tokens += res.usage?.completion_tokens ?? 0;
    const msg = res.choices?.[0]?.message ?? {};
    const text = stripThink(msg.content);
    const offered = new Set(tools.map((t) => t.function.name));
    const all = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    // a made-up tool name left in history makes Groq refuse every later request, so keep only real calls
    const calls = all.filter((c) => c.id && offered.has(c.function?.name));
    const bogus = all.filter((c) => !calls.includes(c)).map((c) => c.function?.name).filter(Boolean);
    if (text) { finalText = text; out({ type: 'assistant', message: { content: [{ type: 'text', text }] } }); }
    // store only content and tool calls: reasoning fields must not go back to the provider
    messages.push({ role: 'assistant', content: text || '', ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.function.name, arguments: c.function.arguments || '{}' } })) } : {}) });
    if (bogus.length && !calls.length && turn < maxTurns - 1) { messages.push({ role: 'user', content: `There is no tool named ${bogus.join(', ')}. Use only: ${[...offered].join(', ')}.` }); continue; }
    if (!calls.length) break; // the model answered without tools: that is its final report
    for (const c of calls) {
      const name = c.function?.name;
      let result;
      try {
        const args = c.function?.arguments ? JSON.parse(c.function.arguments) : {};
        out({ type: 'tool', name, args: clip(JSON.stringify(args), 300) });
        if (HQ_ALLOWED.has(name) && handlers[name]) {
          const r = await handlers[name](args);
          result = typeof r === 'string' ? r : JSON.stringify(r);
          if (name === 'hq_complete') { completed = true; finalText = args.summary || finalText; }
        } else {
          result = await repo.run(name, args);
        }
      } catch (e) {
        result = `ERROR: ${e.message}`;
      }
      messages.push({ role: 'tool', tool_call_id: c.id, content: clip(String(result), TEXT_MAX) });
    }
  }
  out({ type: 'result', subtype: 'success', result: finalText || '(no report)', usage, total_cost_usd: 0, model });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().then(() => process.exit(0), (e) => {
    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: String(e.message ?? e).slice(0, 800) }) + '\n');
    process.exit(1);
  });
}
