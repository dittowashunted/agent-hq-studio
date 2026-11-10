// Asset catalog: one search over free art sources. Poly Haven comes from its public API, the LihFolk Asset Pack from
// its local CSV catalogues, and downloaded packs such as Kenney's from folders under assets/packs/.
// Nothing here is committed: each install builds its own index. Kenney's site forbids automated access, so its packs
// are only indexed after the owner downloads them.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = 'https://api.polyhaven.com';
const USER_AGENT = 'AgentHQ-Studio/1.0'; // Poly Haven's API terms require a unique name
const THUMB = (id) => `https://cdn.polyhaven.com/asset_img/thumbs/${encodeURIComponent(id)}.png?width=256`;
const PH_TYPES = { 0: 'hdri', 1: 'texture', 2: 'model' };
const DOWNLOAD_HOSTS = new Set(['dl.polyhaven.org']);
const FILE_OK = /\.(fbx|jpe?g|png|hdr)$/i;
const MAX_BYTES = 300 * 1024 * 1024;
const REFRESH_MS = 7 * 86400000;
const PACK_SCAN_MS = 60000;
const PACK_FILES = /\.(png|jpe?g|svg|fbx|obj|glb|gltf|wav|ogg|mp3)$/i;
const PACK_KIND = [[/\.(wav|ogg|mp3)$/i, 'sound'], [/\.(fbx|obj|glb|gltf)$/i, 'model'], [/./, 'image']];

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

function parseCsv(text) {
  const rows = text.split(/\r?\n/).filter(Boolean).map((line) => {
    const out = [];
    let cur = '';
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  });
  const [head = [], ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ''])));
}

function walk(dir, depth = 0, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 6) walk(full, depth + 1, out); } else out.push(full);
  }
  return out;
}

// LihFolk's licence allows use in your games but not redistribution, so entries point at the local copy only.
function readLihfolk(dir) {
  const LICENCE = 'LihFolk Asset Pack licence: free in your own games, never redistribute';
  const read = (rel) => { try { return parseCsv(fs.readFileSync(path.join(dir, rel), 'utf8')); } catch { return []; } };
  const entry = (id, type, name, tags, description, file, extra = {}) => ({
    id: `lihfolk:${id}`, source: 'lihfolk', type, name, tags, description, licence: LICENCE, file: file ? path.join(dir, file) : null, ...extra,
  });
  const split = (s) => s.split(/[;\s]+/).filter(Boolean);
  return [
    ...read('Models/Kits/CATALOG.csv').map((r) => entry(`${r.kit}/${r.asset}`, 'model', `${r.asset} (${r.kit})`, split(r.tags),
      `${r.type} from the ${r.kit} kit, ${r.tris} triangles, ${r.dims_studs} studs, quality ${r.score}.`, r.path, { triangles: Number(r.tris) || null })),
    ...read('Materials/CATALOG.csv').map((r) => entry(`material/${r.id}`, 'material', r.id, split(r.tags),
      `${r.family} material, ${r.theme}, based on Roblox ${r.roblox_base_material}.`, r.path)),
    ...read('Skies/CATALOG.csv').map((r) => entry(`sky/${r.id}`, 'sky', r.id, split(r.tags), `${r.family} sky, ${r.theme}.`, r.path)),
    ...read('Animations/CATALOG.csv').map((r) => entry(`animation/${r.name}`, 'animation', r.name, [r.category.toLowerCase()],
      `${r.category} animation, ${r.frames} frames at ${r.fps} fps${r.loop === 'True' ? ', looping' : ''}.`, r.rbxmx)),
    ...read('VFX/CATALOG.csv').map((r) => entry(`vfx/${r.variant}`, 'vfx', r.variant, [r.preset.toLowerCase()], `${r.preset} effect preset.`, r.strip)),
  ];
}

// One entry per pack folder, with each file's name searchable. The licence is read from the pack, never assumed.
function readPacks(root) {
  const base = path.join(root, 'assets', 'packs');
  let packs = [];
  try { packs = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { return []; }
  return packs.map((p) => {
    const dir = path.join(base, p.name);
    const all = walk(dir);
    const files = all.filter((f) => PACK_FILES.test(f));
    const licenceFile = all.find((f) => /licen[sc]e/i.test(path.basename(f)));
    let licence = 'Unknown: check before use';
    try { if (licenceFile && /CC0|Creative Commons Zero|public domain/i.test(fs.readFileSync(licenceFile, 'utf8'))) licence = 'CC0'; } catch { /* stays unknown */ }
    const counts = {};
    for (const f of files) {
      const kind = PACK_KIND.find(([re]) => re.test(f))[1];
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    const words = [...new Set(files.flatMap((f) => path.basename(f).replace(/\.\w+$/, '').toLowerCase().split(/[^a-z]+/)).filter((w) => w.length > 2))];
    const summary = Object.entries(counts).map(([k, n]) => `${n} ${k} files`).join(', ') || 'no usable files';
    return {
      id: `pack:${p.name}`, source: 'pack', type: 'pack', name: p.name.replace(/[-_]+/g, ' '), tags: words.slice(0, 200),
      description: `Downloaded pack with ${summary}.`, licence, file: dir,
    };
  });
}

function lihfolkDir(override) {
  const dir = override || path.join(os.homedir(), 'Documents', 'LihFolk-V2-Assets', 'LihFolk Asset Pack');
  return fs.existsSync(path.join(dir, 'INDEX.md')) ? dir : null;
}

// A local Poly Haven mirror (CC0): <mirror>/models/<id>/ and <mirror>/hdris/<id>/, each with the 1K files and a SOURCE.txt.
// There are no textures in it, so a texture is never "on this PC" and is always fetched from the network.
const MIRROR_DIRS = { model: 'models', hdri: 'hdris' };

function mirrorDir(override) {
  const dir = override || process.env.HQ_POLYHAVEN_LOCAL || path.join(os.homedir(), 'Documents', 'PolyHaven-1K');
  try { return fs.statSync(dir).isDirectory() ? dir : null; } catch { return null; }
}

/** The importable files (FILE_OK) under a mirror folder, as forward-slash relative paths. Links are not followed. */
function mirrorFiles(dir, rel = '') {
  let ents = [];
  try { ents = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return []; }
  return ents.flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return mirrorFiles(dir, r);
    return e.isFile() && FILE_OK.test(e.name) ? [r] : [];
  });
}

export function createAssetCatalog({ root, stateDir, fetchImpl = globalThis.fetch, addAsset, lihfolkPath, polyhavenLocal }) {
  const cacheFile = path.join(stateDir, 'catalog', 'polyhaven.json');
  let base = null; // Poly Haven and LihFolk, built once per refresh
  let packs = [];
  let packsAt = 0;
  let localAt = 0; // which Poly Haven assets are in the mirror, rescanned each minute because a mirror can still be filling
  let local = new Set();

  // The mirror folder of one asset, or null. `type` may be unknown (asset not in the cached catalog): then every folder type is tried.
  function mirrorFolder(slug, type) {
    const m = mirrorDir(polyhavenLocal);
    if (!m) return null;
    for (const [t, sub] of Object.entries(MIRROR_DIRS)) {
      const dir = path.join(m, sub, slug);
      if ((!type || t === type) && fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return { dir, type: t };
    }
    return null;
  }
  function onThisPc(e) {
    if (Date.now() - localAt > PACK_SCAN_MS) {
      local = new Set();
      const m = mirrorDir(polyhavenLocal);
      for (const [t, sub] of Object.entries(MIRROR_DIRS)) {
        if (!m) break;
        try { for (const d of fs.readdirSync(path.join(m, sub), { withFileTypes: true })) if (d.isDirectory()) local.add(`${t}:${d.name}`); } catch { /* no such folder */ }
      }
      localAt = Date.now();
    }
    return local.has(`${e.type}:${e.id.slice('polyhaven:'.length)}`);
  }

  const get = (url) => fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
  const cached = () => { try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { return { at: 0, assets: {} }; } };

  function polyhaven() {
    return Object.entries(cached().assets).map(([id, a]) => ({
      id: `polyhaven:${id}`, source: 'polyhaven', type: PH_TYPES[a.type] ?? 'asset', name: a.name, tags: [...(a.tags ?? []), ...(a.categories ?? [])],
      description: a.description ?? '', licence: 'CC0', preview: THUMB(id), url: `https://polyhaven.com/a/${id}`, triangles: a.polycount ?? null,
      dimensionsMm: a.dimensions ?? null,
    }));
  }

  // Lowercase search text is kept beside each entry, so a search never rebuilds anything. HQ can run on a PC with
  // little free memory: rebuilding the index per search ran one out of memory in testing.
  const indexed = (e) => ({ e, name: e.name.toLowerCase(), tags: e.tags.join(' ').toLowerCase(), text: e.description.toLowerCase() });

  function rows() {
    if (!base) {
      const lf = lihfolkDir(lihfolkPath);
      base = [...polyhaven(), ...(lf ? readLihfolk(lf) : [])].map(indexed);
    }
    if (Date.now() - packsAt > PACK_SCAN_MS) { // a pack dropped into assets/packs shows up within a minute
      packs = readPacks(root).map(indexed);
      packsAt = Date.now();
    }
    return packs.length ? [...base, ...packs] : base;
  }
  const all = () => rows().map((r) => r.e);

  async function refresh() {
    const r = await get(`${API}/assets`);
    if (!r.ok) throw bad(`Poly Haven answered ${r.status}`, 502);
    const assets = await r.json();
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    const keep = Object.fromEntries(Object.entries(assets).map(([id, a]) => [id, {
      name: a.name, type: a.type, tags: a.tags, categories: a.categories, description: a.description, polycount: a.polycount, dimensions: a.dimensions,
    }]));
    fs.writeFileSync(cacheFile, JSON.stringify({ at: Date.now(), assets: keep }));
    base = null;
    return info();
  }

  const refreshIfOld = () => (Date.now() - cached().at > REFRESH_MS ? refresh().catch(() => {}) : Promise.resolve());

  function info() {
    const list = all();
    const count = (key) => list.reduce((o, e) => { o[e[key]] = (o[e[key]] ?? 0) + 1; return o; }, {});
    return { total: list.length, sources: count('source'), types: count('type'), refreshedAt: cached().at || null };
  }

  function search({ q = '', type, source, limit = 40 } = {}) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = [];
    for (const { e, name, tags, text } of rows()) {
      if ((type && e.type !== type) || (source && e.source !== source)) continue;
      let score = 0;
      for (const w of words) {
        const hit = (name.includes(w) ? 5 : 0) + (tags.includes(w) ? 3 : 0) + (text.includes(w) ? 1 : 0);
        if (!hit) { score = -1; break; }
        score += hit;
      }
      if (score >= 0) scored.push([score, e]);
    }
    scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name));
    const page = scored.slice(0, Math.min(limit, 100)).map(([, e]) => (e.source === 'polyhaven' ? { ...e, onThisPc: onThisPc(e) } : e));
    return { ...info(), found: scored.length, results: page };
  }

  // The files to get for one asset at one size. Roblox can't import EXR, so normals come as JPG.
  function plan(type, files, res) {
    const take = (node) => (node?.url ? [{ url: node.url, size: node.size, md5: node.md5 }] : []);
    const named = (node, name) => take(node).map((f) => ({ ...f, name }));
    const jpg = (key) => {
      const node = files[key]?.[res];
      const pick = node?.jpg ?? node?.png;
      return pick ? named(pick, path.basename(new URL(pick.url).pathname)) : [];
    };
    if (type === 'hdri') return named(files.hdri?.[res]?.hdr, `${res}.hdr`);
    const maps = ['Diffuse', 'diff', 'nor_gl', 'Rough', 'rough', 'arm', 'AO', 'Metal'].flatMap(jpg);
    if (type === 'texture') return maps;
    const model = files.fbx?.[res]?.fbx;
    if (!model) return [];
    const inc = Object.entries(model.include ?? {}).filter(([n]) => FILE_OK.test(n)).map(([n, f]) => ({ ...f, name: n }));
    const have = new Set(inc.map((f) => path.basename(f.name)));
    return [...named(model, path.basename(new URL(model.url).pathname)), ...inc,
      ...maps.filter((f) => !have.has(f.name)).map((f) => ({ ...f, name: `textures/${f.name}` }))];
  }

  async function filesFor(id) {
    const m = /^polyhaven:([\w-]{1,80})$/.exec(id);
    if (!m) throw bad('only Poly Haven assets can be fetched');
    const r = await get(`${API}/files/${m[1]}`);
    if (!r.ok) throw bad(`Poly Haven answered ${r.status}`, 502);
    const entry = all().find((e) => e.id === id);
    if (!entry) throw bad('asset is not in the catalog', 404);
    return { slug: m[1], entry, files: await r.json() };
  }

  async function sizes(id) {
    const { entry, files } = await filesFor(id);
    return ['1k', '2k', '4k'].map((res) => {
      const list = plan(entry.type, files, res);
      return { res, files: list.length, bytes: list.reduce((n, f) => n + (f.size ?? 0), 0) };
    }).filter((s) => s.files);
  }

  // Reads the mirror's SOURCE.txt (name, link, tags) for an asset that is not in the cached catalog.
  function entryFromSource(slug, mirror) {
    let lines = [];
    try { lines = fs.readFileSync(path.join(mirror.dir, 'SOURCE.txt'), 'utf8').split(/\r?\n/); } catch { /* no notes file */ }
    const tags = (lines.find((l) => l.startsWith('Tags:')) ?? '').slice(5).split(',').map((t) => t.trim()).filter(Boolean);
    return { id: `polyhaven:${slug}`, type: mirror.type, name: (lines[0] || slug).slice(0, 120), url: `https://polyhaven.com/a/${slug}`, tags };
  }

  // Saves one asset under assets/library/polyhaven/ and adds it to the asset index. A 1K asset that is in the local mirror is copied
  // from it with no network; anything else is downloaded, with host, type and checksum checks.
  async function fetchAsset(id, res = '1k', scope = 'studio') {
    if (!['1k', '2k', '4k'].includes(res)) throw bad('res must be 1k, 2k or 4k');
    const slug = /^polyhaven:([\w-]{1,80})$/.exec(id)?.[1];
    if (!slug) throw bad('only Poly Haven assets can be fetched');
    const known = all().find((e) => e.id === id);
    const mirror = res === '1k' ? mirrorFolder(slug, known?.type) : null;
    const mirrored = mirror ? mirrorFiles(mirror.dir) : []; // an empty folder (a mirror still filling) falls back to the network
    const folder = path.join(root, 'assets', 'library', 'polyhaven', slug);
    const saved = [];
    let entry;
    let from = 'Poly Haven';
    if (mirrored.length) {
      from = 'this PC';
      entry = known ?? entryFromSource(slug, mirror);
      if (mirrored.reduce((n, rel) => n + fs.statSync(path.join(mirror.dir, rel)).size, 0) > MAX_BYTES) throw bad('that is over the 300 MB limit');
      for (const rel of mirrored) {
        const to = path.join(folder, rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(path.join(mirror.dir, rel), to);
        saved.push(to);
      }
      try { fs.copyFileSync(path.join(mirror.dir, 'SOURCE.txt'), path.join(folder, 'SOURCE.txt')); } catch { /* written below */ }
    } else {
      const got = await filesFor(id);
      entry = got.entry;
      const list = plan(entry.type, got.files, res);
      if (!list.length) throw bad(`no ${res} files for this asset`);
      if (list.reduce((n, f) => n + (f.size ?? 0), 0) > MAX_BYTES) throw bad('that is over the 300 MB limit, pick a smaller size');
      for (const f of list) {
        if (!DOWNLOAD_HOSTS.has(new URL(f.url).hostname)) throw bad('unexpected download host', 502);
        const rel = path.normalize(f.name);
        if (rel.startsWith('..') || path.isAbsolute(rel) || !FILE_OK.test(rel)) throw bad('unexpected file name', 502);
        const r = await get(f.url);
        if (!r.ok) throw bad(`download failed: ${r.status}`, 502);
        const buf = Buffer.from(await r.arrayBuffer());
        if (f.md5 && crypto.createHash('md5').update(buf).digest('hex') !== f.md5) throw bad('a download failed its checksum', 502);
        const to = path.join(folder, rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.writeFileSync(to, buf);
        saved.push(to);
      }
    }
    if (!fs.existsSync(path.join(folder, 'SOURCE.txt'))) fs.writeFileSync(path.join(folder, 'SOURCE.txt'), `${entry.name}\nFrom Poly Haven: ${entry.url}\nLicence: CC0\n`);
    const main = saved.find((f) => /\.fbx$/i.test(f)) ?? saved.find((f) => /\.(jpe?g|png)$/i.test(f)) ?? saved[0];
    const file = path.relative(root, main).split(path.sep).join('/');
    if (/\.(fbx|jpe?g|png)$/i.test(main)) {
      addAsset(root, { name: entry.name, kind: /\.fbx$/i.test(main) ? 'model' : 'image', scope, tags: ['polyhaven', 'cc0', ...entry.tags].slice(0, 10).map((t) => t.slice(0, 40)), file });
    }
    return { name: entry.name, folder: path.relative(root, folder).split(path.sep).join('/'), files: saved.length, main: file, licence: 'CC0', from };
  }

  return { search, info, refresh, refreshIfOld, sizes, fetchAsset };
}

export function mountCatalog(route, catalog, { str, bad: badReq, isObj, agentTask, HttpError }) {
  const run = async (fn) => {
    try { return await fn(); } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(e.status ?? 502, e.message);
    }
  };
  const ID = /^[\w:/ .()-]{1,160}$/;
  route('GET', /^\/api\/catalog$/, ({ query }) => catalog.search({
    q: (query.get('q') ?? '').slice(0, 100), type: query.get('type') || undefined, source: query.get('source') || undefined,
    limit: Number(query.get('limit')) || 40,
  }));
  route('GET', /^\/api\/catalog\/sizes$/, ({ query }) => {
    const id = query.get('id') ?? '';
    if (!ID.test(id)) throw badReq('bad id');
    return run(() => catalog.sizes(id));
  });
  route('POST', /^\/api\/catalog\/refresh$/, () => run(() => catalog.refresh()));
  route('POST', /^\/api\/catalog\/fetch$/, ({ body, who, headers }) => {
    if (!isObj(body)) throw badReq('body must be an object');
    if (who === 'agent') agentTask(body, ['librarian'], headers); // the same gate as adding assets
    const id = str(body.id, 'id', { max: 160, required: true });
    return run(() => catalog.fetchAsset(id, str(body.res, 'res', { max: 4 }) || '1k', str(body.scope, 'scope', { max: 50 }) || 'studio'));
  });
}

export const CATALOG_OWNER_ONLY = [['POST', /^\/api\/catalog\/refresh$/]];
