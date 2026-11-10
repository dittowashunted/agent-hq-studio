import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildBrief, loadRoles, parseVault } from '../briefs.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const roles = loadRoles();
const task = (engine) => ({ id: 't_abc', title: 'Do thing', body: 'Details here', engine });

test('every role has 6+ rules, 3+ skills, 3+ doneWhen and 2+ chapters', () => {
  assert.equal(roles.length, 16);
  for (const r of roles) {
    assert.ok(r.rules?.length >= 6 && r.rules.length <= 12, `${r.id} rules ${r.rules?.length}`);
    assert.ok(r.skills.length >= 3, `${r.id} skills ${r.skills.length}`);
    assert.ok(r.doneWhen.length >= 3, `${r.id} doneWhen ${r.doneWhen.length}`);
    assert.ok(r.chapters.length >= 2, `${r.id} chapters ${r.chapters.length}`);
    assert.ok(r.rules.every((x) => typeof x === 'string' && x.length > 20 && !x.includes('—')), `${r.id} rule text`);
    assert.equal(new Set(r.skills.map((s) => s.name)).size, r.skills.length, `${r.id} duplicate skills`);
  }
});

test('models save usage: haiku for scout, librarian and kid-tester, opus only for lead and architect', () => {
  const model = Object.fromEntries(roles.map((r) => [r.id, r.model]));
  for (const id of ['scout', 'librarian', 'kid-tester']) assert.equal(model[id], 'haiku', id);
  for (const id of ['lead', 'architect']) assert.equal(model[id], 'opus', id);
  assert.deepEqual(roles.filter((r) => r.model === 'opus').map((r) => r.id).sort(), ['architect', 'lead']);
  for (const r of roles.filter((x) => !['scout', 'librarian', 'kid-tester', 'lead', 'architect'].includes(x.id))) assert.equal(r.model, 'sonnet', r.id);
});

test('art and 3D rules: lane first, catalog then Claude Design then Blender only when on, never drawn with code', () => {
  const text = (id) => roles.find((r) => r.id === id).rules.join('\n');
  for (const id of ['ui', 'designer', 'world', 'librarian', 'builder']) assert.match(text(id), /Claude Design|Antigravity|asset pack/, id);
  for (const id of ['world', 'librarian', 'builder', 'designer']) {
    assert.match(text(id), /catalog or an asset pack first, then Claude Design, then Blender/, id);
    assert.match(text(id), /only when the owner turned it on in Settings/, id);
  }
  assert.match(text('thumbnails'), /Antigravity lane/);
  assert.match(text('thumbnails'), /Never draw them with code/);
});

test('hard rules in role rules match CLAUDE.md', () => {
  const claude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /No paid random items/);
  const all = roles.map((r) => r.rules.join('\n')).join('\n');
  assert.match(all, /Net\.isEnum/);
  assert.match(all, /R_\{UserId\}_\{PurchaseId\}/);
  assert.doesNotMatch(all, /paid (power|luck) is fine|allow paid random/i);
  assert.match(roles.find((r) => r.id === 'merchant').rules.join('\n'), /No paid random items/);
  assert.match(roles.find((r) => r.id === 'ui').rules.join('\n'), /12 px or larger.*44 px or larger/);
});

test('briefs carry the role rules and the read-before section, and stay small', () => {
  const limit = { app: 16000, antigravity: 16000, groq: 8000, nim: 8000 };
  for (const engine of Object.keys(limit)) {
    for (const r of roles) {
      const b = buildBrief({ task: task(engine), role: r.id, root });
      assert.match(b, /## Rules for your role/, `${engine} ${r.id}`);
      assert.ok(b.includes(`- ${r.rules[0]}`), `${engine} ${r.id} first rule`);
      assert.match(b, /## Read before you start/, `${engine} ${r.id}`);
      assert.match(b, /hq_knowledge_search/, `${engine} ${r.id}`);
      assert.ok(b.length <= limit[engine], `${engine} ${r.id} brief is ${b.length} chars, limit ${limit[engine]}`);
    }
  }
});

test('LLM engines get at most 5 LihFolk titles in read-before', () => {
  const b = buildBrief({ task: task('groq'), role: 'lead', root });
  const section = /## Read before you start\n([\s\S]*?)(\n## |$)/.exec(b)[1];
  const titles = /LihFolk notes[^\n]*\n((?:- .*\n?)+)/.exec(section)[1].trim().split('\n');
  assert.ok(titles.length <= 5, `got ${titles.length}`);
});

test('vault.md has 14 numbered chapters, 4000+ words, the benchmark and discovery facts, and a credits line', () => {
  const md = fs.readFileSync(path.join(root, '.claude/skills/roblox-agent-team/vault.md'), 'utf8');
  assert.ok(md.split(/\s+/).length >= 4000, 'at least 4,000 words');
  assert.deepEqual(parseVault(root).map((c) => c.n), [...Array(14).keys()]);
  for (const c of parseVault(root)) {
    const words = c.text.split(/\s+/).length;
    assert.ok(words >= 250 && words <= 600, `chapter ${c.n} has ${words} words`);
  }
  for (const s of ['June 15', 'August 20', 'October 12', '10.3', 'GameAnalytics', 'LihFolk Vault V2 (CC BY 4.0)', 'Roblox Creator Hub docs']) assert.ok(md.includes(s), s);
  assert.doesNotMatch(md, /—/, 'no em dashes');
});
