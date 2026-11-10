// Settings fields drawn from the server's schema (GET /api/settings/schema): one row per field, saved on change.
import { h, store, api, act, notify, toast, selectEl } from './core.js';

let schema = null; // { sections: [{id,label}], fields: [...] }
let schemaErr = '';
let loading = false;
export function loadSchema(force) {
  if (loading || (schema && !force) || (schemaErr && !force)) return;
  loading = true;
  api('GET', '/api/settings/schema').then((s) => { schema = s; schemaErr = ''; }).catch((e) => { schemaErr = e.message; }).finally(() => { loading = false; notify(); });
}
export const schemaState = () => ({ schema, error: schemaErr });
export const retrySchema = () => { schemaErr = ''; loadSchema(true); };

const valueOf = (f) => (store.settings[f.key] !== undefined ? store.settings[f.key] : f.default);

async function save(key, value) {
  const r = await act(() => api('POST', '/api/settings', { key, value }));
  if (r !== undefined) store.settings = { ...store.settings, [key]: r && r.value !== undefined ? r.value : value };
  notify(); // on an error this also puts the control back to the saved value
}

function control(f) {
  const v = valueOf(f);
  const label = f.label;
  if (f.type === 'bool') {
    return h('div', { class: 'row gap' },
      h('span', { class: 'muted small set-state' }, v ? 'On' : 'Off'),
      h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(!!v), 'aria-label': label, onclick: () => save(f.key, !v) }, h('span', { class: 'knob' })));
  }
  if (f.type === 'enum') {
    const opts = (f.options || []).map((o) => ({ value: String(o.value), label: o.label }));
    return selectEl(opts, String(v), (s) => save(f.key, (f.options.find((o) => String(o.value) === s) || { value: s }).value), 'set-ctl');
  }
  if (f.type === 'int' || f.type === 'number') {
    return h('input', { class: 'input set-ctl num-in', type: 'number', inputmode: f.type === 'int' ? 'numeric' : 'decimal', step: f.type === 'int' ? 1 : 'any', 'aria-label': label,
      min: f.min, max: f.max, value: v, onchange: (e) => {
        const n = Number(e.target.value);
        if (e.target.value.trim() === '' || !Number.isFinite(n)) { toast(`${label} needs a number`, 'error'); notify(); return; }
        save(f.key, n);
      } });
  }
  return h('input', { class: 'input set-ctl', type: 'text', maxlength: 300, autocomplete: 'off', spellcheck: 'false', 'aria-label': label, value: v ?? '',
    placeholder: f.key.startsWith('knowledge') ? 'Default path' : f.key === 'notebookDoc' ? 'https://docs.google.com/document/d/...' : '',
    onchange: (e) => save(f.key, e.target.value.trim()) });
}

function range(f) {
  if (f.type !== 'int' && f.type !== 'number') return '';
  if (f.min == null && f.max == null) return '';
  return ` (${f.min ?? ''} to ${f.max ?? ''}${f.key === 'dailySpendCap' ? ' USD' : ''})`;
}

export function fieldRow(f) {
  return h('div', { class: 'set-row' },
    h('div', { class: 'set-text' }, h('strong', {}, f.label), h('p', { class: 'hint' }, (f.help || '') + range(f))),
    control(f));
}

/**
 * Sections in schema order. `custom` fields keep their own widgets: widgets[key]() returns a node or null.
 * `skip` lists keys the page draws itself (parallel agents and pause live in Run control).
 * Returns { nodes, shown } so the page can add any custom widget the schema forgot.
 */
export function schemaSections(widgets, skip) {
  const shown = new Set();
  const nodes = [];
  const known = new Set((schema.sections || []).map((s) => s.id));
  const loose = schema.fields.some((f) => !known.has(f.section));
  for (const s of [...(schema.sections || []), ...(loose ? [{ id: '', label: 'Other' }] : [])]) {
    const fields = schema.fields.filter((f) => (s.id ? f.section === s.id : !known.has(f.section)) && !skip.has(f.key));
    const flat = fields.filter((f) => f.type !== 'custom');
    const customs = fields.filter((f) => f.type === 'custom').map((f) => { shown.add(f.key); return widgets[f.key]?.(); }).filter(Boolean);
    if (flat.length) nodes.push(h('section', { class: 'card stack sm', 'aria-label': s.label }, h('h2', { class: 'section-title' }, s.label), flat.map(fieldRow)));
    nodes.push(...customs);
  }
  return { nodes, shown };
}
