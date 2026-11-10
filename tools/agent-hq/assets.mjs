// Asset library: a committed index (tools/agent-hq/assets.json) merged with the files under assets/.
// Pure file access, no dependencies. addAsset throws an Error with .status = 400 on invalid input.
import fs from 'node:fs';
import path from 'node:path';

export const KINDS = ['model', 'icon', 'sound', 'image', 'thumbnail'];

const EXT_KIND = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.svg': 'icon',
  '.rbxm': 'model', '.rbxmx': 'model', '.fbx': 'model', '.obj': 'model',
  '.mp3': 'sound', '.ogg': 'sound', '.wav': 'sound',
};

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const indexFile = (root) => path.join(root, 'tools/agent-hq/assets.json');
const posix = (p) => p.split(path.sep).join('/');

function readIndex(root) {
  try {
    const j = JSON.parse(fs.readFileSync(indexFile(root), 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

// Images under assets/icons/ are icons; everything else goes by extension.
function fileKind(f) {
  const kind = EXT_KIND[path.extname(f).toLowerCase()];
  return kind === 'image' && /(^|\/)assets\/icons\//.test(f) ? 'icon' : kind;
}

// Folder names under assets/ (pack, colour, artist) become search tags, so "kenney" or "lorc" finds a pack.
function packTags(f) {
  return f.split('/').slice(1, -1).filter((s) => s && s !== 'assets');
}

function scanFiles(dir, root, depth = 0, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 4) scanFiles(full, root, depth + 1, out); }
    else if (EXT_KIND[path.extname(e.name).toLowerCase()]) out.push(posix(path.relative(root, full)));
  }
  return out;
}

/** Index entries plus unindexed files under assets/. Counts are over everything, ignoring the filters. */
export function listAssets(root, { search, kind, scope } = {}) {
  const index = readIndex(root);
  const indexed = new Set(index.map((a) => a.file));
  const all = [
    ...index.map((a) => ({ ...a, tags: a.tags ?? [], robloxId: a.robloxId ?? null, indexed: true, missing: !fs.existsSync(path.join(root, a.file)) })),
    ...scanFiles(path.join(root, 'assets'), root)
      .filter((f) => !indexed.has(f))
      .map((f) => ({
        id: `file:${f}`, name: path.basename(f), kind: fileKind(f), scope: 'studio',
        tags: ['unindexed', ...packTags(f)], file: f, robloxId: null, indexed: false, missing: false,
      })),
  ];
  const counts = { all: all.length, model: 0, icon: 0, sound: 0, image: 0, thumbnail: 0 };
  for (const a of all) if (a.kind in counts) counts[a.kind]++;

  const q = (search ?? '').trim().toLowerCase();
  const assets = all.filter((a) =>
    (!kind || kind === 'all' || a.kind === kind) &&
    (!scope || scope === 'all' || a.scope === scope) &&
    (!q || [a.name, a.file, ...a.tags].some((s) => String(s).toLowerCase().includes(q))));
  return { assets, counts, onRoblox: all.filter((a) => a.robloxId).length };
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'asset';

/** Validates and appends (or updates by file) an index entry; returns the stored asset. */
export function addAsset(root, input) {
  const a = input ?? {};
  const name = typeof a.name === 'string' ? a.name.trim() : '';
  if (!name || name.length > 120) throw bad('name is required (max 120 characters)');
  if (!KINDS.includes(a.kind)) throw bad(`kind must be one of ${KINDS.join(', ')}`);
  const scope = a.scope ?? 'studio';
  if (scope !== 'studio' && !/^game:[a-z0-9-]{1,40}$/.test(scope)) throw bad('scope must be "studio" or "game:<slug>"');
  const tags = a.tags ?? [];
  if (!Array.isArray(tags) || tags.length > 10 || tags.some((t) => typeof t !== 'string' || !t.trim() || t.length > 40)) {
    throw bad('tags must be up to 10 short strings');
  }
  const file = typeof a.file === 'string' ? a.file.replace(/\\/g, '/') : '';
  if (!file.startsWith('assets/') || file.split('/').includes('..') || path.isAbsolute(file)) throw bad('file must be a path under assets/');
  if (!fs.existsSync(path.join(root, file)) || !fs.statSync(path.join(root, file)).isFile()) throw bad('file does not exist');
  const robloxId = a.robloxId == null || a.robloxId === '' ? null : String(a.robloxId);
  if (robloxId !== null && !/^\d{1,20}$/.test(robloxId)) throw bad('robloxId must be digits');

  const index = readIndex(root);
  const existing = index.find((x) => x.file === file);
  const entry = { id: existing?.id ?? uniqueId(index, slug(name)), name, kind: a.kind, scope, tags: tags.map((t) => t.trim()), file, robloxId };
  if (existing) Object.assign(existing, entry); else index.push(entry);

  fs.mkdirSync(path.dirname(indexFile(root)), { recursive: true });
  const tmp = `${indexFile(root)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2) + '\n');
  fs.renameSync(tmp, indexFile(root));
  return entry;
}

function uniqueId(index, base) {
  let id = base;
  for (let n = 2; index.some((x) => x.id === id); n++) id = `${base}-${n}`;
  return id;
}

/** Markdown catalogue of reusable game systems (tools/agent-hq/systems.md). */
export function readSystems(root) {
  for (const f of [path.join(root, 'tools/agent-hq/systems.md'), path.join(import.meta.dirname, 'systems.md')]) {
    try { return fs.readFileSync(f, 'utf8'); } catch { /* try next */ }
  }
  return '';
}
