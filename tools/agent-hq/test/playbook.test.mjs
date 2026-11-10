import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadPlaybook, loadRoles, parseVault } from '../briefs.mjs';
import { findSources } from '../knowledge.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const book = loadPlaybook();
const roles = loadRoles();

test('playbook has the 14 vault chapters in order, with sane counts', () => {
  assert.deepEqual(book.map((c) => c.n), [...Array(14).keys()]);
  const vault = parseVault(root);
  for (const c of book) {
    assert.equal(c.title.toLowerCase(), vault.find((v) => v.n === c.n)?.title.toLowerCase(), `chapter ${c.n} title matches vault.md`);
    assert.ok(c.lihfolk.length >= 5 && c.lihfolk.length <= 12, `chapter ${c.n} lihfolk ${c.lihfolk.length}`);
    assert.ok(c.docs.length >= 2 && c.docs.length <= 6, `chapter ${c.n} docs ${c.docs.length}`);
    assert.ok(c.skills.length >= 1, `chapter ${c.n} skills`);
    assert.equal(new Set(c.lihfolk).size, c.lihfolk.length, `chapter ${c.n} duplicate titles`);
    assert.ok(c.for.every((id) => roles.some((r) => r.id === id)), `chapter ${c.n} unknown role`);
  }
});

test('playbook and roles.json agree: every role is in at least 2 chapters, both ways', () => {
  for (const r of roles) {
    const listed = book.filter((c) => c.for.includes(r.id)).map((c) => c.n);
    assert.ok(listed.length >= 2, `${r.id} appears in ${listed.length} chapters`);
    assert.deepEqual(listed, [...r.chapters].sort((a, b) => a - b), `${r.id} chapters match playbook.for`);
  }
});

test('every LihFolk title and Creator docs path exists on this PC (checked only when the sources are found)', (t) => {
  const src = findSources();
  if (!src.lihfolk.found || !src.docs.found) return t.skip('LihFolk vault or Creator docs not installed here');
  const titles = new Set();
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (e.name.endsWith('.md')) titles.add(e.name.slice(0, -3));
    }
  })(src.lihfolk.root);
  for (const c of book) {
    for (const x of c.lihfolk) assert.ok(titles.has(x), `chapter ${c.n}: no LihFolk note "${x}"`);
    for (const p of c.docs) assert.ok(fs.existsSync(path.join(src.docs.root, p)), `chapter ${c.n}: no doc ${p}`);
  }
});
