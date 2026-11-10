// Settings: one card per agent role. Turn a role off, add your own rules and skills. Engine and model stay in Agent models.
import { h, store, api, act, btn, field, notify, toast, avatar, roleLabel, rosterOrder, engineOf, engineLabel } from './core.js';

const drafts = {}; // roleId -> { enabled, rules (text), skills (text) }
const SKILL = /^[\w:-]{1,60}$/;

const saved = (r) => ({
  enabled: r.enabled !== false,
  rules: (r.override?.extraRules || []).join('\n'),
  skills: (r.override?.extraSkills || []).join(', '),
});
const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const words = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

function parse(d) {
  const extraRules = lines(d.rules);
  const extraSkills = words(d.skills);
  if (extraRules.length > 12) throw new Error('At most 12 extra rules per role');
  if (extraRules.some((x) => x.length > 200)) throw new Error('Each rule must be 200 characters or fewer');
  if (extraSkills.length > 8) throw new Error('At most 8 extra skills per role');
  const bad = extraSkills.find((x) => !SKILL.test(x));
  if (bad) throw new Error(`"${bad}" is not a skill name (letters, numbers, colon, dash, underscore)`);
  return { enabled: d.enabled, extraRules, extraSkills };
}

async function saveRole(r, d) {
  let body;
  try { body = parse(d); } catch (e) { toast(e.message, 'error'); return; }
  const merged = await act(() => api('POST', '/api/roles/' + encodeURIComponent(r.id), body), roleLabel(r.id) + ' saved');
  if (merged && typeof merged === 'object') {
    store.roles = store.roles.map((x) => (x.id === r.id ? { ...x, ...merged } : x));
    delete drafts[r.id];
    notify();
  }
}

function roleCard(r) {
  const base = saved(r);
  const d = (drafts[r.id] ||= { ...base });
  const dirty = JSON.stringify(d) !== JSON.stringify(base);
  const e = engineOf(r.id);
  return h('div', { class: 'role-edit', 'data-off': d.enabled ? null : 'true' },
    h('div', { class: 'row gap' },
      avatar(r.id, 36),
      h('div', { class: 'grow' }, h('strong', {}, r.label), h('p', { class: 'hint clip' }, r.job)),
      h('span', { class: 'muted small set-state' }, d.enabled ? 'On' : 'Off'),
      h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(d.enabled), 'aria-label': r.label + ' turned on',
        onclick: () => { d.enabled = !d.enabled; notify(); } }, h('span', { class: 'knob' }))),
    h('p', { class: 'hint' }, `Runs on ${engineLabel(e.engine)}${e.model ? ', ' + e.model : ''}. Change it in Agent models.`),
    h('div', { class: 'role-edit-grid' },
      field('Extra rules', (() => { const t = h('textarea', { class: 'textarea', rows: 3, 'aria-label': r.label + ' extra rules', placeholder: 'One rule per line', oninput: (ev) => { d.rules = ev.target.value; } }); t.value = d.rules; return t; })(),
        'Added to this role\'s rules in every brief. Up to 12, 200 characters each.'),
      field('Extra skills', h('input', { class: 'input', type: 'text', 'aria-label': r.label + ' extra skills', placeholder: 'plugin:skill-name, other-skill', value: d.skills, oninput: (ev) => { d.skills = ev.target.value; } }),
        'Comma separated, up to 8. Listed in the brief as skills you added.')),
    h('div', { class: 'row gap' },
      btn('Save', () => saveRole(r, d), { kind: 'primary', disabled: !dirty }),
      dirty ? btn('Discard', () => { delete drafts[r.id]; notify(); }, { kind: 'ghost' }) : null));
}

export function rolesEditor() {
  return h('section', { class: 'card stack', 'aria-label': 'Roles' },
    h('h2', { class: 'section-title' }, 'Roles'),
    h('p', { class: 'muted' }, 'Turn a role off to stop new tasks going to it. Your extra rules and skills are added to that role\'s brief; the built-in rules stay.'),
    h('div', { class: 'role-edit-list' }, rosterOrder(store.roles).map(roleCard)));
}
