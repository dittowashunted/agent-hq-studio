// Settings: Readiness. What the agents need on this computer (tools, knowledge, each role's skills) and what is missing.
import { h, api, btn, ic, notify, avatar, fmtTime } from './core.js';

let data = null;
let err = '';
let busy = false;

export async function loadReadiness(force) {
  if (busy || (!force && (data || err))) return;
  busy = true;
  err = '';
  notify();
  try { data = await api('GET', '/api/readiness'); } catch (e) { err = e.message; }
  busy = false;
  notify();
}

const count = (v) => (Array.isArray(v) ? v.length : Number(v) || 0);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const num = (n) => Number(n || 0).toLocaleString();
const status = (ok, yes, no) => h('span', { class: 'spill', 'data-tone': ok ? 'green' : 'amber' }, ok ? yes : no);
const TOOLS = [['python', 'Python'], ['claude', 'Claude CLI'], ['rojo', 'Rojo']];

function overall(d) {
  const miss = d.missing || [];
  return h('div', { class: 'ready-line', 'data-ok': String(!!d.ok), role: 'status' },
    ic(d.ok ? 'shieldCheck' : 'alert', 18),
    h('div', { class: 'grow' },
      h('strong', {}, d.ok ? 'Ready. Everything the agents need was found.' : `Not ready: ${plural(miss.length, 'thing')} missing.`),
      miss.length ? h('ul', { class: 'ready-miss' }, miss.map((m) => h('li', {}, m))) : null,
      d.at ? h('p', { class: 'hint' }, 'Checked ' + fmtTime(d.at)) : null));
}

function tools(d) {
  return h('div', { class: 'ready-tools' }, TOOLS.map(([id, label]) => {
    const t = d.tools?.[id] || {};
    return h('div', { class: 'ready-tool' }, h('strong', {}, label), status(!!t.found, 'Found', 'Missing'), t.path ? h('code', { class: 'mono muted clip', title: t.path }, t.path) : null);
  }));
}

function knowledge(d) {
  const list = d.knowledge || [];
  const notes = list.reduce((n, k) => n + (k.notes || 0), 0);
  const words = list.reduce((n, k) => n + (k.words || 0), 0);
  return h('div', { class: 'stack sm' },
    h('h3', { class: 'ready-h' }, 'Knowledge'),
    h('p', { class: 'hint' }, `${num(notes)} notes, ${num(words)} words across ${plural(list.filter((k) => k.found).length, 'source')}.`),
    h('div', { class: 'ready-rows' }, list.map((k) => h('div', { class: 'ready-row' },
      h('strong', { class: 'grow clip' }, k.label || k.id),
      h('span', { class: 'muted small num' }, k.found ? `${num(k.notes)} notes · ${num(k.words)} words` : ''),
      status(!!k.found, 'Found', 'Not found')))));
}

function roles(d) {
  const list = d.roles || [];
  return h('div', { class: 'stack sm' },
    h('h3', { class: 'ready-h' }, 'Roles'),
    h('div', { class: 'ready-rows' }, list.map((r) => {
      const skills = r.skills || [];
      const miss = r.missing || skills.filter((s) => !s.found).map((s) => s.name);
      return h('div', { class: 'ready-row ready-role' },
        h('div', { class: 'row gap grow' }, avatar(r.id, 28),
          h('div', { class: 'grow' }, h('strong', {}, r.label || r.id),
            h('p', { class: 'hint' }, `${plural(count(r.rules), 'rule')} · ${plural(count(r.chapters), 'chapter')} · ${plural(skills.length, 'skill')}${r.enabled === false ? ' · turned off' : ''}`))),
        miss.length
          ? h('p', { class: 'ready-gap' }, ic('alert', 14), h('span', {}, 'Missing skills: ' + miss.join(', ')))
          : status(true, 'All skills found', ''));
    })));
}

function quarantined(d) {
  const q = d.quarantined || [];
  return h('details', { class: 'ready-q' },
    h('summary', {}, `Held back notes: ${q.length}`),
    q.length
      ? h('ul', { class: 'ready-miss' }, q.map((n) => h('li', {}, h('code', { class: 'mono' }, `${n.source}: ${n.path}`), ' · rule ' + n.rule)))
      : h('p', { class: 'hint' }, 'No note was held back.'),
    h('p', { class: 'hint' }, 'Low-trust notes that try to give agents orders are never read. Only the path and the rule are shown here.'));
}

export function readinessPanel() {
  loadReadiness(false);
  return h('section', { class: 'card stack', 'aria-label': 'Readiness' },
    h('div', { class: 'row gap between wrap' },
      h('h2', { class: 'section-title' }, 'Readiness'),
      btn(busy ? 'Checking...' : 'Check again', () => loadReadiness(true), { icon: 'refresh', disabled: busy })),
    err ? h('p', { class: 'pg-warn', role: 'alert' }, 'Could not check: ' + err) : null,
    !data && !err ? h('p', { class: 'muted' }, 'Checking this computer...') : null,
    data ? [overall(data), tools(data), knowledge(data), roles(data), quarantined(data)] : null);
}
