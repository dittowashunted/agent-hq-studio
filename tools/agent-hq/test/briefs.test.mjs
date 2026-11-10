import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildBrief, loadRoles, readRules, parseVault, RESET_TEXT } from '../briefs.mjs';
import { openDb, addMessage } from '../db.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const task = { id: 't_abc', title: 'Do thing', body: 'Details here' };
const HQCTL = 'node tools/agent-hq/hqctl.mjs';
const ICONS = new Set(['sparkles', 'pulse', 'compass', 'books', 'hammer', 'layout', 'mountain', 'gamepad', 'smile', 'scale', 'image', 'shieldCheck', 'trend', 'store', 'scan', 'palette']);

test('roles.json has 16 roles with required fields', () => {
  const roles = loadRoles();
  assert.equal(roles.length, 16);
  for (const r of roles) {
    for (const k of ['id', 'label', 'job', 'chapters', 'mode', 'files', 'engine', 'model', 'needsStudio', 'allowedTools', 'agentType', 'skills', 'mcp', 'doneWhen', 'gates', 'color', 'color2', 'icon']) {
      assert.ok(k in r, `${r.id}.${k}`);
    }
    assert.match(r.color, /^#[0-9a-f]{6}$/i, r.id);
    assert.ok(ICONS.has(r.icon), `${r.id} icon ${r.icon}`);
    assert.ok(Array.isArray(r.skills) && r.skills.every((s) => s.name && s.when), r.id);
    for (const g of r.gates) assert.ok(roles.some((x) => x.id === g), `${r.id} gate ${g}`);
  }
  assert.equal(new Set(loadRoles().map((r) => r.icon)).size, 16, 'one icon per role');
});

test('brief has rules, chapter 5 for ui, task text', () => {
  const rules = readRules(root);
  assert.match(rules, /Never publish/);
  const b = buildBrief({ task, role: 'ui', root });
  assert.ok(b.includes(rules));
  assert.ok(b.includes(parseVault(root).find((c) => c.n === 5).text));
  assert.match(b, /Details here/);
  assert.match(b, /hq_complete/);
});

test('delegation section only for lead', () => {
  assert.match(buildBrief({ task, role: 'lead', root }), /hq_create_task/);
  assert.doesNotMatch(buildBrief({ task, role: 'builder', root }), /hq_create_task/);
});

test('task id line, engine sections, designer defaults', () => {
  const ui = buildBrief({ task: { ...task, engine: 'app' }, role: 'ui', root });
  assert.ok(ui.includes('Your HQ task id: t_abc. Pass it as taskId to every hq_* tool.'));
  assert.match(ui, /Claude desktop app/);
  assert.doesNotMatch(ui, /generate_image/);

  const roles = loadRoles();
  assert.equal(roles.find((r) => r.id === 'designer').engine, 'antigravity');
  assert.equal(roles.find((r) => r.id === 'thumbnails').engine, 'antigravity');
  assert.equal(roles.filter((r) => r.engine === 'app').length, 14);
});

test('builder brief names its three skills, tools, gates and definition of done', () => {
  const b = buildBrief({ task: { ...task, engine: 'app' }, role: 'builder', root });
  for (const s of ['superpowers:test-driven-development', 'superpowers:systematic-debugging', 'superpowers:verification-before-completion']) {
    assert.ok(b.includes(`Invoke with the Skill tool: ${s}`), s);
  }
  assert.match(b, /If a listed skill is not installed, say so in hq_note and continue/);
  assert.match(b, /Tools to prefer[\s\S]*Roblox_Studio/);
  for (const d of loadRoles().find((r) => r.id === 'builder').doneWhen) assert.ok(b.includes(d), d);
  assert.match(b, /## Definition of done/);
  assert.match(b, /Record 0 to 2 reusable lessons with hq_learn before hq_complete/);
  assert.deepEqual(loadRoles().find((r) => r.id === 'builder').gates, ['reviewer', 'playtester']);
});

test('antigravity brief names the art rule file and skills, not the Skill tool', () => {
  const b = buildBrief({ task: { ...task, engine: 'antigravity' }, role: 'designer', root });
  assert.ok(b.includes('.agents/rules/agent-hq-art-direction.md'));
  assert.ok(b.includes('.agents/skills/roblox-ui-concept/SKILL.md'));
  assert.ok(b.includes('.agents/skills/roblox-store-art/SKILL.md'));
  assert.match(b, /scored self-check on every image/);
  assert.match(b, /generate_image/);
  assert.ok(b.includes('assets/concepts/<taskId>-<n>.png'));
  assert.doesNotMatch(b, /Invoke with the Skill tool: \.agents/);
  assert.doesNotMatch(b, /Claude desktop app/);
});

test('every role brief has the hqctl line and a lessons section; referenced files exist', () => {
  for (const r of loadRoles()) {
    const b = buildBrief({ task, role: r.id, root });
    assert.ok(b.includes(HQCTL), r.id);
    assert.ok(b.includes('## Lessons from earlier tasks (follow them)'), r.id);
    assert.ok(b.includes('## Definition of done'), r.id);
    assert.ok(b.includes("Never read, print or use .agent-hq/owner-token; owner approvals are the owner's alone."), r.id);
    for (const s of r.skills.filter((x) => x.name.includes('/'))) assert.ok(fs.existsSync(path.join(root, s.name)), s.name);
  }
});

test('lessons come from memory/<role>.md, newest 10 (6 on Groq/NIM)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-brief-'));
  fs.cpSync(path.join(root, '.claude/skills/roblox-agent-team'), path.join(tmp, '.claude/skills/roblox-agent-team'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'tools/agent-hq/memory'), { recursive: true });
  const lines = Array.from({ length: 20 }, (_, i) => `- 2026-10-22: lesson number ${i + 1}`);
  fs.writeFileSync(path.join(tmp, 'tools/agent-hq/memory/builder.md'), lines.join('\n') + '\n');
  const b = buildBrief({ task, role: 'builder', root: tmp });
  assert.ok(b.includes('lesson number 20') && b.includes('lesson number 11'));
  assert.ok(!b.includes('lesson number 10\n') && !b.includes('lesson number 1\n'));
  const small = buildBrief({ task: { ...task, engine: 'groq' }, role: 'builder', root: tmp });
  assert.ok(small.includes('lesson number 15') && !small.includes('lesson number 14\n'));
  assert.doesNotMatch(buildBrief({ task, role: 'ui', root: tmp }), /lesson number/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('conversation so far: last 6 owner/agent messages after the latest reset', () => {
  const db = openDb(':memory:');
  addMessage(db, { role: 'builder', from: 'owner', text: 'before reset' });
  addMessage(db, { role: 'builder', from: 'system', text: RESET_TEXT });
  for (let i = 1; i <= 12; i++) addMessage(db, { role: 'builder', from: i % 2 ? 'owner' : 'agent', text: `msg ${i}` });
  addMessage(db, { role: 'builder', from: 'system', text: 'Task done' });
  addMessage(db, { role: 'ui', from: 'owner', text: 'other thread' });
  const b = buildBrief({ task, role: 'builder', root, db });
  assert.match(b, /## Conversation so far/);
  assert.ok(b.includes('Owner: msg 11') && b.includes('Builder: msg 12') && b.includes('msg 7'));
  assert.ok(!b.includes('msg 6\n') && !b.includes('before reset') && !b.includes('other thread') && !b.includes('Task done'));
  assert.doesNotMatch(buildBrief({ task, role: 'builder', root }), /Conversation so far/);
});

test('the task token line appears only when a token is given', () => {
  const b = buildBrief({ task, role: 'builder', root, taskToken: 'tkn_abc123' });
  assert.ok(b.includes("Your HQ task token: tkn_abc123. Pass it as taskToken (with taskId) to every hq_* tool. Never share it or use another task's token."));
  assert.ok(b.indexOf('Your HQ task id') < b.indexOf('Your HQ task token') && b.indexOf('## Reporting') < b.indexOf('Your HQ task id'), 'id then token, after the reporting block');
  assert.ok(b.trimEnd().endsWith("use another task's token."), 'the token line is last');
  assert.match(b, /add --token <your task token> to every task command/);
  assert.equal((b.match(/tkn_abc123/g) ?? []).length, 1, 'the token appears once');
  const none = buildBrief({ task, role: 'builder', root });
  assert.doesNotMatch(none, /task token|--token/);
});

test('attached images are listed under a Read-first heading', () => {
  const t = { ...task, attachPaths: ['uploads/abc.png', 'assets/concepts/t_1-1.png', '../etc/passwd'] };
  const b = buildBrief({ task: t, role: 'ui', root });
  assert.match(b, /## Attached images \(Read them first\)/);
  assert.ok(b.includes('- .agent-hq/media/uploads/abc.png'));
  assert.ok(b.includes('- assets/concepts/t_1-1.png'));
  assert.ok(!b.includes('passwd'));
  assert.ok(b.indexOf('## Attached images') < b.indexOf('## Your task'));
  const asJson = buildBrief({ task: { ...task, attachPaths: JSON.stringify(['uploads/x.jpg']) }, role: 'ui', root });
  assert.ok(asJson.includes('- .agent-hq/media/uploads/x.jpg'));
  assert.doesNotMatch(buildBrief({ task, role: 'ui', root }), /Attached images/);
});

test('producer and lead briefs explain stage requests; scout, liveops and librarian get their own sections', () => {
  for (const role of ['producer', 'lead']) {
    const b = buildBrief({ task, role, root });
    assert.match(b, /## Stage requests/, role);
    assert.match(b, /hq_stage_request \{game, toStage, evidence\}/);
    assert.match(b, /live \(the owner only\)/);
  }
  assert.doesNotMatch(buildBrief({ task, role: 'builder', root }), /Stage requests/);

  const scout = buildBrief({ task, role: 'scout', root });
  assert.match(scout, /## Pitch format/);
  for (const f of ['competitors', 'comparables', 'money', 'game {howItPlays, first60s', 'evidence {summary, links}', 'building', 'risks', 'FULL schema']) assert.ok(scout.includes(f), f);

  const ops = buildBrief({ task, role: 'liveops', root });
  assert.match(ops, /## Metrics and attention/);
  assert.match(ops, /hq_metric \{game, key, value, date\?\}/);
  assert.match(ops, /Brought to your attention/);

  assert.match(buildBrief({ task, role: 'librarian', root }), /hq_asset_add \{name, kind/);
  assert.doesNotMatch(buildBrief({ task, role: 'ui', root }), /hq_asset_add|hq_metric|Pitch format/);
});

test('Visual bar: pinned house references are listed for designer, thumbnails and ui only', () => {
  const references = [
    { mediaPath: 'uploads/ref1.png', category: 'ui-icons', note: 'chunky outlines' },
    { mediaPath: 'assets/concepts/t_9-1.png', category: 'screens', note: '' },
    { mediaPath: 'uploads/pack.png', category: 'packaging' },
    { mediaPath: '../secret.png', category: 'screens' },
  ];
  for (const role of ['designer', 'thumbnails', 'ui']) {
    const b = buildBrief({ task, role, root, references });
    assert.match(b, /## House references \(the Visual bar\)/, role);
    assert.ok(b.includes('house reference for every hand-off'));
    assert.ok(b.includes('### UI icons\n- .agent-hq/media/uploads/ref1.png (chunky outlines)'));
    assert.ok(b.includes('### Screens\n- assets/concepts/t_9-1.png'));
    assert.ok(b.includes('### Packaging\n- .agent-hq/media/uploads/pack.png'));
    assert.ok(!b.includes('secret') && !b.includes('### 3D models'));
    assert.ok(b.indexOf('## House references') < b.indexOf('## Your task'));
  }
  for (const role of ['builder', 'reviewer', 'lead']) assert.doesNotMatch(buildBrief({ task, role, root, references }), /House references/);
  assert.doesNotMatch(buildBrief({ task, role: 'designer', root }), /House references/);
  assert.doesNotMatch(buildBrief({ task, role: 'designer', root, references: [] }), /House references/);
});

const heads = (b) => [...b.matchAll(/^## (.+)$/gm)].map((m) => m[1]);

test('cache-friendly order: the same-per-role sections come first, the task, done, reporting, id and token last', () => {
  const b = buildBrief({ task: { ...task, engine: 'app' }, role: 'builder', root, taskToken: 'tkn_abc123' });
  const h = heads(b);
  const at = (name) => h.findIndex((x) => x.startsWith(name));
  const staticOrder = ['Rules every agent gets', 'Skills you must use', 'Tools to prefer', 'Rules for your role', 'Usage and notebook', 'Your job', "Your game's own vault", 'Your knowledge chapters', 'Read before you start', 'Reference library', 'Files you own', 'Where you run'];
  staticOrder.forEach((n, i) => { assert.ok(at(n) >= 0, n); if (i) assert.ok(at(staticOrder[i - 1]) < at(n), `${staticOrder[i - 1]} before ${n}`); });
  const changing = ['Owner corrections', 'Lessons from earlier tasks', 'Your task', 'Definition of done', 'Reporting'];
  changing.forEach((n, i) => { assert.ok(at(n) >= 0, n); if (i) assert.ok(at(changing[i - 1]) < at(n), `${changing[i - 1]} before ${n}`); });
  assert.ok(at('Where you run') < at('Owner corrections'), 'every static section is above every changing one');
  assert.ok(b.indexOf('## Your task') < b.indexOf('Your HQ task id'));
  // two different tasks for the same role share the whole static prefix
  const other = buildBrief({ task: { id: 't_zzz', title: 'Other', body: 'x', engine: 'app' }, role: 'builder', root, taskToken: 'tkn_other' });
  const cut = (x) => x.slice(0, x.indexOf('## Owner corrections'));
  assert.equal(cut(b), cut(other));
});

test('usage settings: terse vs normal differ by the terse line, screenshot cap and Blender follow the settings', () => {
  const brief = (settings, engine = 'app') => buildBrief({ task: { ...task, engine }, role: 'ui', root, settings });
  const terse = brief({ replyStyle: 'terse' });
  const normal = brief({ replyStyle: 'normal' });
  const TERSE = 'Keep notes and replies short: facts, paths, numbers.';
  assert.ok(terse.includes(TERSE) && !normal.includes(TERSE));
  assert.equal(terse.split('\n').filter((l) => !l.startsWith('- Keep notes and replies short:')).join('\n'), normal, 'nothing else differs');
  assert.ok(brief({ screenshotCap: 7 }).includes('Take at most 7 screenshots per task, at half scale, and say why for each.'));
  assert.match(brief({ screenshotCap: 0 }), /Take no screenshots/);
  assert.ok(brief({ blenderFallback: false }).includes('Blender is off: do not open Blender.'));
  assert.doesNotMatch(brief({ blenderFallback: true }), /Blender is off/);
  assert.match(brief({ blenderFallback: true }), /Blender is on, as the last step only/);
  assert.match(brief({ cheapLookups: true }), /lihfolk:lihfolk-lookup/);
  assert.doesNotMatch(brief({ cheapLookups: false }), /lihfolk-lookup/);
  assert.doesNotMatch(brief({ cheapLookups: true }, 'groq'), /lihfolk-lookup/, 'Claude engines only');
  assert.match(brief({}), /hq_notebook_read/);
  const none = buildBrief({ task: { ...task, engine: 'app' }, role: 'ui', root });
  assert.ok(none.includes(TERSE) && none.includes('Take at most 4 screenshots'), 'no settings means defaults');
});

test('art section for thumbnails, designer and art tasks only', () => {
  const art = (role, t) => buildBrief({ task: { ...task, ...t }, role, root });
  for (const role of ['thumbnails', 'designer']) {
    const b = art(role, { title: 'Do thing', engine: 'antigravity' });
    assert.match(b, /## Art specs and variants/);
    for (const s of ['512 x 512', '1920 x 1080', 'bottom 15 to 20 percent', '3 or more variants', 'Review Packaging group', 'Visual bar', 'Never draw them with code']) assert.ok(b.includes(s), `${role}: ${s}`);
    assert.ok(b.indexOf('## Art specs and variants') < b.indexOf('## Owner corrections'), `${role}: art specs are static for art roles`);
  }
  const ui = art('ui', { title: 'Make 3 thumbnails for the launch' });
  assert.match(ui, /## Art specs and variants/);
  assert.ok(ui.indexOf('## Art specs and variants') > ui.indexOf('## Owner corrections') && ui.indexOf('## Art specs and variants') < ui.indexOf('## Your task'));
  assert.doesNotMatch(art('builder', { title: 'Fix the server timer' }), /Art specs and variants/);
});

test('builder briefs stay under a stated size per engine', () => {
  const size = (engine, t = {}) => buildBrief({ task: { ...task, engine, ...t }, role: 'builder', root, taskToken: 'tkn_abc123' }).length;
  assert.ok(size('app') <= 16000, `app ${size('app')}`);
  assert.ok(size('app', { title: 'New game icon' }) <= 17500, 'with the art section');
  assert.ok(size('groq') <= 8000, `groq ${size('groq')}`);
});


test('ponytail: LLM and antigravity code roles get the rules, Claude engines one line, off removes both', () => {
  const brief = (engine, role, settings) => buildBrief({ task: { ...task, engine }, role, root, settings });
  const groq = brief('groq', 'builder', {});
  assert.match(groq, /## Code style \(ponytail full\)\n- Ask first whether the code needs to exist/);
  assert.ok(groq.match(/## Code style[^\n]*\n((?:- [^\n]*\n?)+)/)[1].trim().split('\n').length <= 6);
  assert.match(brief('antigravity', 'builder', {}), /## Code style \(ponytail full\)/);
  const cli = brief('claude-cli', 'builder', {});
  assert.match(cli, /Ponytail plugin is active at full; follow it\./);
  assert.doesNotMatch(cli, /## Code style/);
  assert.equal(brief('app', 'builder', {}).match(/ponytail/gi).length, 1);
  const lite = brief('groq', 'builder', { ponytailMode: 'lite' });
  const ultra = brief('groq', 'builder', { ponytailMode: 'ultra' });
  assert.match(lite, /ponytail lite/);
  assert.ok(lite.length < groq.length && groq.length < ultra.length);
  assert.match(ultra, /Shortest working diff, no comments beyond one line/);
  for (const engine of ['groq', 'antigravity', 'claude-cli', 'app']) assert.doesNotMatch(brief(engine, 'builder', { ponytailMode: 'off' }), /ponytail/i, engine);
  assert.doesNotMatch(brief('groq', 'architect', {}), /## Code style/, 'roles that do not write code skip the rules');
});

test('feedback, preferences and research lines sit in the right order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-br-'));
  fs.writeFileSync(path.join(dir, 'builder.prefs.md'), '- 2026-11-04 | Keep modules small\n');
  fs.writeFileSync(path.join(dir, 'builder.corrections.md'), '- 2026-11-04 | correction | any | Use studs\n');
  fs.writeFileSync(path.join(dir, 'builder.md'), '- 2026-11-04: a lesson\n');
  const db = openDb(':memory:');
  addMessage(db, { role: 'builder', from: 'owner', text: 'Looks good: Shop' });
  const b = buildBrief({ task: { ...task, engine: 'app' }, role: 'builder', root, db, memoryDir: dir });
  const at = (s) => b.indexOf(s);
  const order = ['## Research and rules', '## Owner preferences (standing)', '## Owner corrections', '## How your recent work landed', '## Lessons from earlier', '## Your task'].map(at);
  assert.ok(order.every((n) => n >= 0), String(order));
  assert.deepEqual([...order].sort((x, y) => x - y), order);
  assert.match(b, /hq_research_save/);
  assert.doesNotMatch(b, /hq_preferences_propose/, 'only the lead proposes from chat');
  assert.match(buildBrief({ task, role: 'lead', root }), /hq_preferences_propose/);
  // no data: no section
  assert.doesNotMatch(buildBrief({ task, role: 'builder', root, db: openDb(':memory:'), memoryDir: fs.mkdtempSync(path.join(os.tmpdir(), 'hq-br2-')) }), /How your recent work landed|Owner preferences/);
});
