// Parity render: drives the demo studio in headless Chrome over CDP and saves screenshots next to the reference PNGs.
// Not part of npm test (it needs Chrome). Usage: HQ_SHOT_DIR=<dir with app/ and phone/> HQ_SHOT_PORT=<port> node test/visual.mjs
//   --only=home,tasks            limit the default shots by name (explicit --shot entries always run)
//   --shot=desktop|phone:name:hash[:clickSelector]   extra shot, repeatable (hash without the leading #/)
//   --measure="sel1;sel2"        print size, padding and radius of the first match for each selector, per shot
// Writes only <dir>/app/hq-<name>.png (desktop 1280x800 at 1.5x) and <dir>/phone/hq-<name>.png (390x763 at 3x).
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = import.meta.dirname;
const CHROME = process.env.HQ_CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/opt/pw-browsers/chromium');
// Linux containers often run as root, where Chrome refuses to start without --no-sandbox.
const SANDBOX = process.platform === 'linux' ? ['--no-sandbox'] : [];
const OFFENDERS = Number((process.argv.find((a) => a.startsWith('--offenders=')) || '--offenders=5').split('=')[1]) || 5;
const DEVICES = {
  desktop: { dir: 'app', w: Number(process.env.HQ_SHOT_W) || 1280, h: 800, scale: 1.5, mobile: false, out: [Math.round((Number(process.env.HQ_SHOT_W) || 1280) * 1.5), 1200] }, // HQ_SHOT_W: narrower desktop check
  phone: { dir: 'phone', w: 390, h: 763, scale: 3, mobile: true, out: [1170, 2289] },
};
const DEFAULTS = [
  ...['home', 'lead', 'team', 'tasks', 'review', 'pitches', 'market', 'pro', 'games', 'library', 'settings', 'help'].map((n) => ({ device: 'desktop', name: n, hash: n })),
  ...['home', 'lead', 'tasks', 'review'].map((n) => ({ device: 'phone', name: n, hash: n })),
  { device: 'phone', name: 'more', hash: 'home', click: '#tab-more', optional: true },
];

const fail = (msg) => { console.error('visual: ' + msg); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const redact = (s) => String(s ?? '').replace(/[0-9a-f]{64}/gi, '<token>');

// ---- args and env ----
const args = process.argv.slice(2);
const flag = (name) => args.filter((a) => a.startsWith('--' + name + '=')).map((a) => a.slice(name.length + 3));
const only = new Set((flag('only')[0] || '').split(',').map((s) => s.trim()).filter(Boolean));
const measure = (flag('measure')[0] || '').split(';').map((s) => s.trim()).filter(Boolean);
const shotRoot = process.env.HQ_SHOT_DIR;
if (!shotRoot) fail('HQ_SHOT_DIR is required (a folder that holds app/ and phone/)');
const port = Number(process.env.HQ_SHOT_PORT || 4480);
if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('HQ_SHOT_PORT must be a port between 1024 and 65535');
if (port === 4317) fail('refusing port 4317: that is the live HQ');
if (!fs.existsSync(CHROME)) fail('Chrome not found at ' + CHROME);

const extra = flag('shot').map((spec) => {
  const [device, name, hash, ...rest] = spec.split(':');
  if (!DEVICES[device] || !/^[a-z0-9-]+$/.test(name || '') || hash === undefined) fail('bad --shot "' + spec + '" (want desktop|phone:name:hash[:clickSelector])');
  return { device, name, hash, click: rest.join(':') || undefined };
});
const shots = [...DEFAULTS.filter((s) => !only.size || only.has(s.name)).filter((s) => !extra.some((e) => e.device === s.device && e.name === s.name)), ...extra];
if (!shots.length) fail('no shots selected');
for (const d of Object.values(DEVICES)) fs.mkdirSync(path.join(shotRoot, d.dir), { recursive: true });

// ---- processes ----
const procs = [];
const temps = [];
function killTree(p) {
  if (!p || p.exitCode !== null || !p.pid) return;
  try { if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); else p.kill('SIGKILL'); } catch { /* already gone */ }
}
function cleanup() {
  procs.forEach(killTree);
  for (const t of temps) { try { fs.rmSync(t, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp folder; the OS cleans it */ } }
}
process.on('SIGINT', () => { cleanup(); process.exit(130); });

async function until(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting for ' + what);
    await sleep(100);
  }
}

// ---- CDP ----
class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Set();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id) { const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result); } } else this.listeners.forEach((f) => f(m));
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      setTimeout(() => { if (this.pending.delete(id)) rej(new Error('CDP timeout: ' + method)); }, 30000);
    });
  }
}

// ---- in-page scripts ----
const SELECTOR = `const sel = (e) => { const p = []; for (let n = e; n && n.nodeType === 1 && p.length < 4; n = n.parentElement) { let s = n.tagName.toLowerCase(); if (n.id) s += '#' + n.id; else if (n.classList.length) s += '.' + [...n.classList].slice(0, 2).join('.'); p.unshift(s); if (n.id) break; } return p.join(' > '); };
const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const c = getComputedStyle(e); return c.visibility !== 'hidden' && c.display !== 'none' && parseFloat(c.opacity) > 0; };`;
const AUDIT = (phone) => `(() => { ${SELECTOR}
  const small = []; const seen = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    const e = t.parentElement;
    if (!e || seen.has(e) || !t.nodeValue.trim() || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(e.tagName) || !vis(e)) continue;
    seen.add(e);
    let fs = parseFloat(getComputedStyle(e).fontSize);
    if (e instanceof SVGElement && e.getScreenCTM) { const m = e.getScreenCTM(); if (m) fs *= Math.hypot(m.a, m.b); }
    if (fs < 11.99) small.push(sel(e) + ' ' + fs.toFixed(1) + 'px');
  }
  const tap = [];
  if (${phone}) {
    const q = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link], [role=switch], [tabindex]:not([tabindex="-1"])';
    for (const e of document.querySelectorAll(q)) {
      if (e.disabled || getComputedStyle(e).display === 'inline') continue;
      const box = /^(checkbox|radio)$/.test(e.type || '') ? (e.closest('label') || e) : e;
      if (!vis(box)) continue;
      const r = box.getBoundingClientRect();
      if (r.width < 43.5 || r.height < 43.5) tap.push(sel(e) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
  }
  return { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, small, tap };
})()`;
const MEASURE = (s) => `(() => { const e = document.querySelector(${JSON.stringify(s)}); if (!e) return null; const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return { w: +r.width.toFixed(2), h: +r.height.toFixed(2), pad: c.padding, rad: c.borderRadius }; })()`;
const CLICK = (s) => `(() => { const e = document.querySelector(${JSON.stringify(s)}); if (!e) return false; e.click(); return true; })()`;

// ---- PNG header ----
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.toString('latin1', 1, 4) !== 'PNG') throw new Error('not a PNG: ' + file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

// ---- main ----
let failed = false;
try {
  const demoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-shot-demo-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-shot-chrome-'));
  temps.push(demoDir, profile);

  const demo = spawn(process.execPath, [path.join(here, 'demo.mjs')], { env: { ...process.env, HQ_PORT: String(port), HQ_DEMO_DIR: demoDir }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  procs.push(demo);
  let demoErr = '';
  demo.stderr.on('data', (d) => { demoErr += d; });
  const urlFile = path.join(demoDir, 'demo-url.txt');
  await until(() => { if (demo.exitCode !== null) throw new Error('demo exited: ' + redact(demoErr).slice(0, 400)); return fs.existsSync(urlFile); }, 45000, 'the demo studio');
  const signedIn = fs.readFileSync(urlFile, 'utf8').trim(); // holds the owner token: used, never printed
  const u = new URL(signedIn);
  if (u.hostname !== '127.0.0.1' || Number(u.port) !== port) throw new Error('demo is not on 127.0.0.1:' + port);
  const base = `http://127.0.0.1:${port}/`;

  const chrome = spawn(CHROME, ['--headless=new', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', ...SANDBOX, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  procs.push(chrome);
  const portFile = path.join(profile, 'DevToolsActivePort');
  await until(() => fs.existsSync(portFile) && fs.readFileSync(portFile, 'utf8').includes('\n'), 30000, 'Chrome');
  const [dbgPort, dbgPath] = fs.readFileSync(portFile, 'utf8').split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${dbgPort}${dbgPath}`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('could not connect to Chrome')); });
  const cdp = new Cdp(ws);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const call = (m, p) => cdp.send(m, p, sessionId);
  const evalJs = async (expression, awaitPromise = false) => {
    const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error('page script failed: ' + redact(r.exceptionDetails.text));
    return r.result.value;
  };

  let bad = [];
  let hosts = new Set();
  cdp.listeners.add((m) => {
    if (m.sessionId !== sessionId) return;
    const p = m.params;
    if (m.method === 'Runtime.consoleAPICalled' && p.type === 'error') bad.push('console.error: ' + redact(p.args.map((a) => a.value ?? a.description ?? '').join(' ')).slice(0, 160));
    else if (m.method === 'Runtime.exceptionThrown') bad.push('exception: ' + redact(p.exceptionDetails.exception?.description || p.exceptionDetails.text).slice(0, 160));
    else if (m.method === 'Log.entryAdded' && p.entry.level === 'error') bad.push('log: ' + redact(p.entry.text + ' ' + (p.entry.url || '')).slice(0, 160));
    else if (m.method === 'Network.requestWillBeSent') {
      try { const r = new URL(p.request.url); if (/^https?:$/.test(r.protocol) && r.hostname !== '127.0.0.1') hosts.add(r.hostname); } catch { /* not a URL */ }
    }
  });
  for (const d of ['Page', 'Runtime', 'Log', 'Network']) await call(d + '.enable');
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  const ready = async () => {
    await until(() => evalJs(`!!document.querySelector('#main .page, #main .messenger')`), 25000, 'the page to render');
    await evalJs('document.fonts.ready.then(() => true)', true);
    await sleep(700); // let the first fetches and the SSE connection settle
  };

  // sign in once; the token then lives in this profile's localStorage and the app strips it from the address bar
  const d0 = DEVICES.desktop;
  await call('Emulation.setDeviceMetricsOverride', { width: d0.w, height: d0.h, deviceScaleFactor: d0.scale, mobile: false });
  await call('Page.navigate', { url: signedIn });
  await ready();

  const sizes = [];
  for (const s of shots) {
    const dev = DEVICES[s.device];
    const label = `${s.device} ${s.name}`;
    bad = []; hosts = new Set();
    await call('Emulation.setDeviceMetricsOverride', { width: dev.w, height: dev.h, deviceScaleFactor: dev.scale, mobile: dev.mobile });
    await call('Page.navigate', { url: 'about:blank' });
    await call('Page.navigate', { url: `${base}#/${s.hash}` });
    try { await ready(); } catch (e) {
      failed = true;
      const seen = await evalJs(`(document.querySelector('#main')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 140)`).catch(() => '');
      console.log(`FAIL ${label}: ${e.message}${bad.length ? '; ' + bad[0] : ''}${seen ? '; main says "' + redact(seen) + '"' : ''}`);
      continue;
    }
    if (s.click) {
      const ok = await evalJs(CLICK(s.click));
      if (!ok) {
        if (s.optional) { console.log(`skip ${label}: ${s.click} is not in the page yet`); continue; }
        failed = true; console.log(`FAIL ${label}: click target ${s.click} not found`); continue;
      }
      await sleep(600);
    }
    const a = await evalJs(AUDIT(dev.mobile));
    const file = path.join(shotRoot, dev.dir, `hq-${s.name}.png`);
    const { data } = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    const [pw, ph] = pngSize(file);
    sizes.push(`${s.device}/${s.name} ${pw}x${ph}`);
    const problems = [];
    if (pw !== dev.out[0] || ph !== dev.out[1]) problems.push(`png ${pw}x${ph} (want ${dev.out.join('x')})`);
    if (bad.length) problems.push(`console ${bad.length}`);
    if (hosts.size) problems.push(`external hosts ${[...hosts].join(',')}`);
    if (a.scrollWidth > a.innerWidth) problems.push(`scrollWidth ${a.scrollWidth} > ${a.innerWidth}`);
    if (a.small.length) problems.push(`text<12px ${a.small.length}`);
    if (a.tap.length) problems.push(`tap<44px ${a.tap.length}`);
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${label} ${pw}x${ph}${problems.length ? ': ' + problems.join('; ') : ''}`);
    for (const [k, list] of [['console', bad], ['text<12px', a.small], ['tap<44px', a.tap]]) list.slice(0, OFFENDERS).forEach((x) => console.log(`       ${k}: ${x}`));
    if (problems.length) failed = true;
    for (const m of measure) {
      const r = await evalJs(MEASURE(m));
      console.log(`       measure ${m}: ${r ? `${r.w} x ${r.h}, padding ${r.pad}, radius ${r.rad}` : 'no match'}`);
    }
  }
  console.log('checked sizes: ' + sizes.join(', '));
  ws.close();
} catch (e) {
  failed = true;
  console.error('visual: ' + redact(e.message));
} finally {
  cleanup();
}
process.exit(failed ? 1 : 0);
