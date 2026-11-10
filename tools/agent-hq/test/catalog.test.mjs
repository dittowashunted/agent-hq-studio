import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server.mjs';

const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-cat-')); dirs.push(d); return d; };
const running = [];
after(async () => { for (const s of running) await s.close(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const fbx = Buffer.from('fbx-bytes');
const jpg = Buffer.from('jpg-bytes');
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const DL = 'https://dl.polyhaven.org/file/ph-assets';
const ASSETS = {
  rocket_chair: { name: 'Rocket Chair', type: 2, categories: ['furniture'], tags: ['metal', 'space'], description: 'A chair shaped like a rocket.', polycount: 900 },
  rusty_metal: { name: 'Rusty Metal', type: 1, categories: ['metal'], tags: ['rust'], description: 'Old steel plates.' },
  noon_grass: { name: 'Noon Grass', type: 0, categories: ['outdoor'], tags: ['sunny'], description: 'A bright field.' },
};
const files = (over = {}) => ({
  fbx: { '1k': { fbx: {
    url: `${DL}/chair_1k.fbx`, size: fbx.length, md5: md5(fbx),
    include: { 'textures/chair_diff_1k.jpg': { url: `${DL}/chair_diff_1k.jpg`, size: jpg.length, md5: md5(jpg) }, 'textures/chair_nor_1k.exr': { url: `${DL}/chair_nor_1k.exr`, size: 9, md5: 'x' } },
  } } },
  nor_gl: { '1k': { jpg: { url: `${DL}/chair_nor_gl_1k.jpg`, size: jpg.length, md5: md5(jpg) } } },
  ...over,
});

function fakeWeb(fileData = files()) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), ua: init?.headers?.['User-Agent'] });
    const u = String(url);
    const json = (b) => ({ ok: true, status: 200, json: async () => b });
    if (u.endsWith('/assets')) return json(ASSETS);
    if (u.includes('/files/')) return json(fileData);
    if (u.endsWith('.fbx')) return { ok: true, status: 200, arrayBuffer: async () => fbx };
    return { ok: true, status: 200, arrayBuffer: async () => jpg };
  };
  return { seen, fetchImpl };
}

async function hq(web, setup = () => {}, mirror = null) {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'tools/agent-hq'), { recursive: true });
  setup(root);
  const s = await startServer({ root, port: 0, stateDir: tmp(), catalogFetch: web.fetchImpl, catalogLihfolk: path.join(root, 'none'), catalogMirror: mirror ?? path.join(root, 'no-mirror') });
  running.push(s);
  const call = async (method, route, body, token = s.ownerToken) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${route}`, {
      method, headers: { 'x-hq-token': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, json: await r.json() };
  };
  return { ...s, root, call };
}

test('refresh names HQ to Poly Haven and makes everything searchable', async () => {
  const web = fakeWeb();
  const a = await hq(web);
  await a.call('POST', '/api/catalog/refresh', {});
  assert.equal(web.seen[0].ua, 'AgentHQ-Studio/1.0');
  const r = (await a.call('GET', '/api/catalog?q=rocket')).json;
  assert.equal(r.results[0].name, 'Rocket Chair');
  assert.equal(r.results[0].licence, 'CC0');
  assert.match(r.results[0].preview, /cdn\.polyhaven\.com/);
  assert.equal((await a.call('GET', '/api/catalog?q=steel')).json.results[0].id, 'polyhaven:rusty_metal');
  assert.equal((await a.call('GET', '/api/catalog?type=hdri')).json.found, 1);
  assert.equal((await a.call('GET', '/api/catalog?q=rocket+field')).json.found, 0); // every word must match
});

test('fetch saves a model for Roblox, skips EXR, records the source and indexes it', async () => {
  const a = await hq(fakeWeb());
  await a.call('POST', '/api/catalog/refresh', {});
  const r = await a.call('POST', '/api/catalog/fetch', { id: 'polyhaven:rocket_chair', res: '1k' });
  assert.equal(r.status, 200);
  const dir = path.join(a.root, 'assets/library/polyhaven/rocket_chair');
  assert.ok(fs.existsSync(path.join(dir, 'chair_1k.fbx')));
  assert.ok(fs.existsSync(path.join(dir, 'textures/chair_nor_gl_1k.jpg')));
  assert.ok(!fs.existsSync(path.join(dir, 'textures/chair_nor_1k.exr')));
  assert.match(fs.readFileSync(path.join(dir, 'SOURCE.txt'), 'utf8'), /Licence: CC0/);
  const index = (await a.call('GET', '/api/assets?search=Rocket')).json.assets;
  assert.equal(index[0].kind, 'model');
});

test('a bad checksum, a strange host or a path escape saves nothing', async () => {
  const cases = [
    files({ fbx: { '1k': { fbx: { url: `${DL}/c.fbx`, size: 1, md5: 'wrong', include: {} } } } }),
    files({ fbx: { '1k': { fbx: { url: 'https://evil.example/c.fbx', size: 1, md5: md5(fbx), include: {} } } } }),
    files({ fbx: { '1k': { fbx: { url: `${DL}/c.fbx`, size: 1, md5: md5(fbx), include: { '../../../evil.png': { url: `${DL}/e.png`, size: 1, md5: md5(jpg) } } } } } }),
  ];
  for (const data of cases) {
    const a = await hq(fakeWeb(data));
    await a.call('POST', '/api/catalog/refresh', {});
    const r = await a.call('POST', '/api/catalog/fetch', { id: 'polyhaven:rocket_chair' });
    assert.equal(r.status, 502);
    assert.ok(!fs.existsSync(path.join(a.root, '..', 'evil.png')));
  }
});

test('huge downloads are refused', async () => {
  const a = await hq(fakeWeb(files({ fbx: { '1k': { fbx: { url: `${DL}/c.fbx`, size: 400 * 1024 * 1024, md5: 'x', include: {} } } } })));
  await a.call('POST', '/api/catalog/refresh', {});
  assert.equal((await a.call('POST', '/api/catalog/fetch', { id: 'polyhaven:rocket_chair' })).status, 400);
});

test('a downloaded pack is indexed, with its licence read from the pack', async () => {
  const a = await hq(fakeWeb(), (root) => {
    const p = path.join(root, 'assets/packs/kenney_ui-pack');
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, 'License.txt'), 'Creative Commons Zero, CC0');
    fs.writeFileSync(path.join(p, 'button_blue.png'), 'x');
    fs.writeFileSync(path.join(p, 'click_soft.ogg'), 'x');
    const q = path.join(root, 'assets/packs/mystery');
    fs.mkdirSync(q);
    fs.writeFileSync(path.join(q, 'thing.png'), 'x');
  });
  const r = (await a.call('GET', '/api/catalog?q=button')).json.results[0];
  assert.equal(r.licence, 'CC0');
  assert.match(r.description, /1 image files, 1 sound files/);
  assert.match((await a.call('GET', '/api/catalog?q=mystery')).json.results[0].licence, /Unknown/);
});

test('agents can search, only a librarian task can fetch, and only the owner can refresh', async () => {
  const a = await hq(fakeWeb());
  assert.equal((await a.call('GET', '/api/catalog', undefined, a.token)).status, 200);
  assert.equal((await a.call('POST', '/api/catalog/refresh', {}, a.token)).status, 403);
  assert.equal((await a.call('POST', '/api/catalog/fetch', { id: 'polyhaven:rocket_chair' }, a.token)).status, 403);
});

// ---------- the local Poly Haven mirror: models and hdris only, no textures ----------
const SOURCE_TXT = 'Rocket Chair\nhttps://polyhaven.com/a/rocket_chair\nLicence: CC0\nAuthors: Test Author\nTags: metal, space\n';
function makeMirror() {
  const m = tmp();
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(m, rel)), { recursive: true }); fs.writeFileSync(path.join(m, rel), text); };
  put('models/rocket_chair/rocket_chair_1k.fbx', 'mirror-fbx');
  put('models/rocket_chair/textures/chair_diff_1k.jpg', 'mirror-jpg');
  put('models/rocket_chair/textures/chair_nor_1k.exr', 'exr');
  put('models/rocket_chair/SOURCE.txt', SOURCE_TXT);
  put('hdris/noon_grass/noon_grass_1k.hdr', 'mirror-hdr');
  put('hdris/noon_grass/SOURCE.txt', 'Noon Grass\nhttps://polyhaven.com/a/noon_grass\nLicence: CC0\nTags: sunny\n');
  fs.mkdirSync(path.join(m, 'textures/rusty_metal'), { recursive: true }); // even a folder here does not make a texture "on this PC"
  put('textures/rusty_metal/rusty_metal_diff_1k.jpg', 'x');
  return m;
}
const filesCalls = (web) => web.seen.filter((x) => /\/files\/|dl\.polyhaven/.test(x.url)).map((x) => x.url);

test('mirror: models and hdris in it are marked on this PC, textures never are', async () => {
  const a = await hq(fakeWeb(), () => {}, makeMirror());
  await a.call('POST', '/api/catalog/refresh', {});
  const by = (q) => (a.call('GET', `/api/catalog?q=${q}`)).then((r) => r.json.results[0]);
  assert.equal((await by('rocket')).onThisPc, true);
  assert.equal((await by('field')).onThisPc, true);
  assert.equal((await by('steel')).onThisPc, false);
  const none = await hq(fakeWeb(), () => {}); // no mirror folder at all
  await none.call('POST', '/api/catalog/refresh', {});
  assert.equal((await none.call('GET', '/api/catalog?q=rocket')).json.results[0].onThisPc, false);
});

test('mirror: Get 1K copies from the mirror with no network, skips EXR, keeps the mirror source note', async () => {
  const web = fakeWeb();
  const a = await hq(web, () => {}, makeMirror());
  await a.call('POST', '/api/catalog/refresh', {});
  const before = web.seen.length;
  const r = await a.call('POST', '/api/catalog/fetch', { id: 'polyhaven:rocket_chair', res: '1k' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.from, 'this PC');
  assert.equal(web.seen.length, before, 'no request was made');
  const dir = path.join(a.root, 'assets/library/polyhaven/rocket_chair');
  assert.equal(fs.readFileSync(path.join(dir, 'rocket_chair_1k.fbx'), 'utf8'), 'mirror-fbx');
  assert.ok(fs.existsSync(path.join(dir, 'textures/chair_diff_1k.jpg')));
  assert.ok(!fs.existsSync(path.join(dir, 'textures/chair_nor_1k.exr')));
  assert.match(fs.readFileSync(path.join(dir, 'SOURCE.txt'), 'utf8'), /Authors: Test Author/);
  assert.equal((await a.call('GET', '/api/assets?search=Rocket')).json.assets[0].kind, 'model');
});

test('mirror: only 1K uses it; textures, other sizes and empty folders go to the network', async () => {
  const web = fakeWeb();
  const m = makeMirror();
  fs.mkdirSync(path.join(m, 'models/hollow'), { recursive: true }); // a folder a mirror is still filling
  const a = await hq(web, () => {}, m);
  await a.call('POST', '/api/catalog/refresh', {});
  assert.equal((await a.call('POST', '/api/catalog/fetch', { id: 'polyhaven:rocket_chair', res: '2k' })).status, 400 /* the fake web has no 2k files */);
  assert.ok(filesCalls(web).some((u) => u.includes('/files/rocket_chair')), '2k asks Poly Haven');
  const before = filesCalls(web).length;
  await a.call('POST', '/api/catalog/fetch', { id: 'polyhaven:rusty_metal', res: '1k' });
  assert.ok(filesCalls(web).length > before && filesCalls(web).some((u) => u.includes('/files/rusty_metal')), 'a texture is never copied from the mirror');
  await a.call('POST', '/api/catalog/fetch', { id: 'polyhaven:hollow', res: '1k' });
  assert.ok(filesCalls(web).some((u) => u.includes('/files/hollow')), 'an empty mirror folder falls back to Poly Haven');
});

test('mirror: an asset missing from the cached catalog is still copied, named from its SOURCE.txt', async () => {
  const web = fakeWeb();
  const a = await hq(web, () => {}, makeMirror()); // no refresh: the catalog cache is empty
  const r = await a.call('POST', '/api/catalog/fetch', { id: 'polyhaven:noon_grass', res: '1k' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.name, r.json.from, r.json.files], ['Noon Grass', 'this PC', 1]);
  assert.equal(filesCalls(web).length, 0);
  assert.equal(fs.readFileSync(path.join(a.root, 'assets/library/polyhaven/noon_grass/noon_grass_1k.hdr'), 'utf8'), 'mirror-hdr');
});
