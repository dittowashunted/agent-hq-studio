// Guards for the look the dashboard is built to: role tiles, retired colours, no shipped images, files the page links to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const files = walk(pub);
const text = files.filter((f) => /\.(css|js|html|svg|json)$/.test(f));

test('16 roles, each with color and color2; designer pair is exact', () => {
  const roles = JSON.parse(fs.readFileSync(path.join(root, 'roles.json'), 'utf8'));
  assert.equal(roles.length, 16);
  for (const r of roles) {
    assert.match(r.color, /^#[0-9a-f]{6}$/i, r.id);
    assert.match(r.color2, /^#[0-9a-f]{6}$/i, r.id);
  }
  const d = roles.find((r) => r.id === 'designer');
  assert.equal(d.color, '#d77cf0');
  assert.equal(d.color2, '#6f8dff');
});

test('the retired cyan and orange are gone from public/', () => {
  for (const f of text) {
    const s = fs.readFileSync(f, 'utf8').toLowerCase();
    for (const bad of ['2ee6d6', '46, 230, 214', 'ff6b2c']) assert.ok(!s.includes(bad), `${path.relative(root, f)} still has ${bad}`);
  }
});

test('no raster images are shipped in public/', () => {
  const bad = files.filter((f) => /\.(png|webp)$/i.test(f));
  assert.deepEqual(bad, []);
});

test('every stylesheet index.html links exists', () => {
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  const hrefs = [...html.matchAll(/<link rel="stylesheet" href="\/static\/([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 10, 'expected the split stylesheets');
  for (const h of hrefs) assert.ok(fs.existsSync(path.join(pub, h)), h);
});

test('every font theme.css loads exists, and the licence note is beside them', () => {
  const css = fs.readFileSync(path.join(pub, 'theme.css'), 'utf8');
  const srcs = [...css.matchAll(/url\("\/static\/([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(srcs.length > 0);
  for (const s of srcs) assert.ok(fs.existsSync(path.join(pub, s)), s);
  assert.ok(fs.existsSync(path.join(pub, 'fonts', 'OFL.txt')));
});
