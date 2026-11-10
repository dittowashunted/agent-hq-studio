import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getTask, updateTask, listTasks, createTask, nextRunnable, getSetting, setSetting, issueTaskToken, listReferences } from './db.mjs';
import { buildBrief, loadRoles } from './briefs.mjs';
import { detectEngines, spawnEngine } from './engines.mjs';
import { gameFolder } from './game-context.mjs';

const mcpPath = path.join(import.meta.dirname, 'mcp.mjs');
const llmAgentPath = path.join(import.meta.dirname, 'llm-agent.mjs');
const LLM_ENGINES = new Set(['groq', 'nim']); // OpenAI-compatible APIs, run by llm-agent.mjs
const isWin = process.platform === 'win32';

function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, shell: false });
    else process.kill(-child.pid, 'SIGKILL');
  } catch { /* already gone */ }
}

/**
 * The Roblox Studio MCP server, pinned to Roblox's own launcher outside the repo (never read from repo files agents can edit).
 * Only for roles that list Roblox_Studio in their mcp, on tasks that need Studio. Null when Studio's MCP launcher is not installed.
 */
export function studioServer(role, { env = process.env, exists = fs.existsSync } = {}) {
  if (!(role?.mcp ?? []).includes('Roblox_Studio')) return null;
  const bat = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Roblox', 'mcp.bat') : null;
  return bat && exists(bat) ? { command: path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'), args: ['/c', bat] } : null;
}

export function createRunner({ db, root, emit = () => {}, port = 4317, token = '', tickMs = 2000, echoMs = 150, engines: detected, memoryDir, providers = () => ({}), briefFor, spendGuard }) {
  const stateDir = path.join(root, '.agent-hq');
  const logDir = path.join(stateDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const exes = detected ?? detectEngines();
  const roles = loadRoles();
  const procs = new Map(); // taskId -> { child, task, canceled }
  let timer = null;
  let stopped = false; // after stop() the db may be closed: late child exits must not touch it

  const publish = (id) => { const t = getTask(db, id); if (t) emit('task', t); return t; };
  const studioHolder = () => [...procs.values()].find((p) => p.task.needsStudio)?.task.id ?? null;

  function fail(id, error) {
    updateTask(db, id, { state: 'failed', error });
    publish(id);
  }

  function start(task) {
    const role = roles.find((r) => r.id === task.role);
    const pref = getSetting(db, 'roleEngines', {})[task.role] ?? {};
    const engine = task.engine || pref.engine || 'claude-cli';
    const llmKey = LLM_ENGINES.has(engine) ? providers()?.[engine]?.apiKey ?? null : null;
    const exe = LLM_ENGINES.has(engine) ? (llmKey ? llmAgentPath : null) : exes[engine] ?? null;
    if (engine !== 'echo' && !exe) return fail(task.id, LLM_ENGINES.has(engine) ? `no ${engine} API key: add one in Settings, Model providers` : 'engine not installed');
    const model = task.model || pref.model || (engine === 'claude-cli' ? role?.model : null) || null;

    let child, mcpConfigPath, briefPath = null;
    const taskToken = issueTaskToken(db, task.id); // per-task secret: proves to the server which task is calling
    try {
      mcpConfigPath = path.join(stateDir, `mcp-${task.id}.json`);
      const studio = task.needsStudio ? studioServer(role) : null; // Studio tasks of Studio roles get the Roblox Studio MCP too
      fs.writeFileSync(mcpConfigPath, JSON.stringify({
        mcpServers: { hq: { command: process.execPath, args: [mcpPath], env: {
          HQ_URL: `http://127.0.0.1:${port}`, HQ_TOKEN: token, HQ_TASK: task.id, HQ_ROLE: task.role, HQ_TASK_TOKEN: taskToken,
        } }, ...(studio ? { Roblox_Studio: studio } : {}) },
      }), { mode: 0o600 }); // holds the HQ token; owner-only, deleted when the task ends
      const brief = briefFor ? briefFor(task, taskToken) : buildBrief({ task, role: task.role, root, db, taskToken, memoryDir, references: listReferences(db) });
      let env = { ...process.env, HQ_ECHO_MS: String(echoMs) };
      if (llmKey) {
        // the brief can exceed the Windows command-line limit, so it goes in a file; the key only in this child's env
        briefPath = path.join(stateDir, `brief-${task.id}.txt`);
        fs.writeFileSync(briefPath, brief, { mode: 0o600 });
        env = { ...env, HQ_URL: `http://127.0.0.1:${port}`, HQ_TOKEN: token, HQ_TASK: task.id, HQ_ROLE: task.role, HQ_TASK_TOKEN: taskToken,
          HQ_ROOT: root, HQ_LLM_PROVIDER: engine, HQ_LLM_KEY: llmKey, HQ_LLM_MODEL: model ?? '', HQ_BRIEF_FILE: briefPath,
          HQ_ROLE_JSON: JSON.stringify({ id: role?.id, mode: role?.mode, files: role?.files ?? [], allowedTools: role?.allowedTools ?? [] }) };
      }
      child = spawnEngine({ engine, exe, brief, model, mcpConfigPath, cwd: root, allowedTools: role?.allowedTools ?? [], files: role?.files ?? [], gameDir: task.game ? gameFolder(root, task.game) : '.', env, studio: !!studio });
    } catch (e) {
      return fail(task.id, `spawn failed: ${e.message}`);
    }

    const entry = { child, task: { ...task, needsStudio: task.needsStudio ? 1 : 0 }, canceled: false };
    procs.set(task.id, entry);
    updateTask(db, task.id, { state: 'working', engine, model, error: null });
    publish(task.id);

    const logFile = path.join(logDir, `${task.id}.ndjson`);
    let lastText = '', resultText = '', stderrTail = '', buf = '', resultError = false;
    const onLine = (line) => {
      if (!line.trim()) return;
      fs.appendFileSync(logFile, line + '\n');
      emit('log', { taskId: task.id, line });
      let ev; try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === 'assistant') {
        const text = (ev.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
        if (text) lastText = text;
      } else if (ev.type === 'result') {
        if (typeof ev.result === 'string') resultText = ev.result;
        if (ev.is_error || ev.status === 'ERROR') resultError = true;
        const cost = ev.total_cost_usd ?? ev.usage?.total_cost_usd;
        const patch = {};
        if (typeof cost === 'number') patch.costUsd = cost;
        const conv = ev.session_id ?? ev.conversation_id;
        if (conv) patch.conversationId = conv;
        if (Object.keys(patch).length && !stopped) { updateTask(db, task.id, patch); publish(task.id); } // output can arrive after stop() closed the db
      }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      const parts = buf.split('\n');
      buf = parts.pop();
      parts.forEach(onLine);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      stderrTail = (stderrTail + d).slice(-1000);
      onLine(JSON.stringify({ type: 'stderr', text: d }));
    });

    let finished = false;
    const finish = (code, spawnError) => {
      if (finished) return;
      finished = true;
      procs.delete(task.id);
      fs.rm(mcpConfigPath, { force: true }, () => {});
      if (briefPath) fs.rm(briefPath, { force: true }, () => {});
      if (stopped) return;
      if (buf) onLine(buf);
      if (!entry.canceled) {
        const cur = getTask(db, task.id);
        if (cur?.state === 'working') { // not already completed through MCP
          if (code === 0 && !resultError) {
            updateTask(db, task.id, { state: 'review', summary: (lastText || resultText).slice(0, 500) || null });
          } else {
            updateTask(db, task.id, { state: 'failed', error: (spawnError || `exit ${code}: ${resultText || stderrTail || lastText}`).slice(0, 1000) });
          }
        }
      }
      publish(task.id);
    };
    child.on('error', (e) => finish(null, e.message));
    child.on('close', (code) => finish(code));
  }

  function runSchedules() {
    const schedules = getSetting(db, 'schedules', []);
    const roleEngines = getSetting(db, 'roleEngines', {});
    const nowMs = Date.now();
    let changed = false;
    for (const s of schedules) {
      if (!s.enabled || !(s.everyMinutes > 0)) continue;
      const last = s.lastRunAt ? Date.parse(s.lastRunAt) : 0;
      if (nowMs < last + s.everyMinutes * 60000) continue;
      const open = listTasks(db, { role: s.role }).some((t) => (t.state === 'queued' || t.state === 'working') && t.createdBy === 'schedule' && t.title === s.title);
      s.lastRunAt = new Date(nowMs).toISOString();
      changed = true;
      if (!open) publish(createTask(db, { title: s.title, body: s.body ?? '', role: s.role, createdBy: 'schedule', engine: roleEngines[s.role]?.engine ?? roles.find((x) => x.id === s.role)?.engine ?? 'app' }).id);
    }
    if (changed) { setSetting(db, 'schedules', schedules); emit('settings', { key: 'schedules', value: schedules }); }
  }

  function tick() {
    if (spendGuard?.() || getSetting(db, 'paused', false)) return;
    runSchedules();
    const budget = getSetting(db, 'budget', 2);
    while (procs.size < budget) {
      const t = nextRunnable(db, { studioBusy: studioHolder() !== null });
      if (!t) break;
      start(t);
    }
  }

  return {
    start() {
      if (timer) return;
      stopped = false;
      // tasks left "working" by a previous process are dead (app/antigravity ones belong to a desktop session)
      for (const t of listTasks(db, { state: 'working' })) {
        if ((t.engine === 'claude-cli' || t.engine === 'echo' || LLM_ENGINES.has(t.engine)) && !procs.has(t.id)) fail(t.id, 'interrupted by restart');
      }
      timer = setInterval(tick, tickMs);
      tick();
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      timer = null;
      for (const p of procs.values()) { p.canceled = true; killTree(p.child); }
    },
    cancel(id) {
      const p = procs.get(id);
      if (p) { p.canceled = true; killTree(p.child); }
      const t = getTask(db, id);
      if (!t || ['done', 'failed', 'canceled'].includes(t.state)) return t;
      updateTask(db, id, { state: 'canceled' });
      return publish(id);
    },
    running: () => [...procs.keys()],
    studioHolder,
    engines: () => ({ 'claude-cli': !!exes['claude-cli'], echo: true, groq: !!providers()?.groq?.apiKey, nim: !!providers()?.nim?.apiKey }),
    tick,
  };
}
