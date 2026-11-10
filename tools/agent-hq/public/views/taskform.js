// New-task form (agent picker, auto-suggested role, screenshot paste) and the shared attachment chips.
import { h, ic, store, api, act, field, selectEl, btn, avatar, roleById, plain, toast, ENGINES, scope, multiGame, suggestRole, uploadImage, imageFiles, mediaUrl } from './core.js';

// Attachment chips. `paths` is a plain array owned by the caller so drafts survive re-renders.
export function attachments(paths, onChange) {
  const node = h('div', { class: 'attach-chips' });
  function paint() {
    node.replaceChildren(...paths.map((p, i) => h('span', { class: 'attach-chip' },
      h('img', { src: mediaUrl(p), alt: 'Attached screenshot ' + (i + 1) }),
      h('span', { class: 'clip' }, 'Screenshot ' + (i + 1)),
      h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Remove screenshot ' + (i + 1), onclick: () => { paths.splice(i, 1); paint(); onChange && onChange(); } }, ic('x', 12)))));
    node.hidden = !paths.length;
  }
  async function add(files) {
    for (const f of files) {
      try {
        const p = await uploadImage(f);
        paths.push(p);
        paint();
        onChange && onChange();
      } catch (e) { toast(e.message, 'error'); }
    }
  }
  paint();
  return { node, add, paint };
}

const drafts = {};

export function taskForm({ key, role, onDone }) {
  const d = (drafts[key] ||= { role: '', picked: false, title: '', body: '', game: store.games.length === 1 ? store.games[0].slug : '', attach: [], needsStudio: null, engine: '' });
  if (role) { d.role = role; d.picked = true; }
  if (scope()) d.game = scope(); // a game picked in the switcher goes with the task
  const studioDefault = () => d.needsStudio ?? !!roleById(d.role)?.needsStudio;

  const picks = new Map();
  const grid = h('div', { class: 'role-pick', role: 'radiogroup', 'aria-label': 'Agent' }, store.roles.map((r) => {
    const b = h('button', { type: 'button', class: 'pick', role: 'radio', 'aria-checked': 'false', onclick: () => { d.role = r.id; d.picked = true; d.needsStudio = null; sync(); } },
      avatar(r.id, 28), h('span', { class: 'pick-text' }, h('strong', {}, r.label), h('span', { class: 'muted clamp' }, r.job)));
    picks.set(r.id, b);
    return b;
  }));
  const hint = h('p', { class: 'hint' });
  const studio = h('input', { type: 'checkbox', onchange: (e) => { d.needsStudio = e.target.checked; } });
  function sync() {
    for (const [id, b] of picks) b.setAttribute('aria-checked', String(id === d.role));
    studio.checked = studioDefault();
    hint.textContent = !d.role ? 'Pick an agent, or just start typing and one is suggested.'
      : d.picked ? '' : `Suggested from your text: ${roleById(d.role)?.label}. Click another agent to change it.`;
  }
  function suggest() {
    if (d.picked) return;
    const s = suggestRole(d.title + ' ' + d.body);
    if (s && s !== d.role) { d.role = s; d.needsStudio = null; sync(); }
  }

  const chips = attachments(d.attach);
  const title = h('input', { class: 'input', type: 'text', maxlength: 200, value: d.title, placeholder: 'Short title (optional)', oninput: (e) => { d.title = e.target.value; suggest(); } });
  const body = h('textarea', { class: 'textarea', rows: 5, maxlength: 20000, placeholder: 'What should they do? Paste a screenshot with Ctrl+V.',
    oninput: (e) => { d.body = e.target.value; suggest(); },
    onpaste: (e) => { const f = imageFiles(e.clipboardData); if (f.length) { e.preventDefault(); chips.add(f); } } });
  body.value = d.body;
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, hidden: true, onchange: (e) => { chips.add([...e.target.files]); e.target.value = ''; } });

  const form = h('form', { class: 'form taskform',
    ondragover: (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); },
    ondrop: (e) => { const f = imageFiles(e.dataTransfer); if (f.length) { e.preventDefault(); chips.add(f); } },
    onsubmit: async (e) => {
      e.preventDefault();
      if (!d.role) { toast('Pick an agent first', 'error'); return; }
      const t = d.title.trim() || plain(d.body.split('\n').find((l) => l.trim()) || '').slice(0, 100);
      if (!t) { toast('Add a title or some details', 'error'); body.focus(); return; }
      const payload = { title: t, body: d.body, role: d.role, needsStudio: studio.checked };
      if (d.game) payload.game = d.game;
      if (d.engine) payload.engine = d.engine;
      if (d.attach.length) payload.attachPaths = [...d.attach];
      const task = await act(() => api('POST', '/api/tasks', payload), 'Task queued');
      if (task && task !== true) {
        drafts[key] = null;
        if (!store.tasks.some((x) => x.id === task.id)) store.tasks.unshift(task);
        onDone && onDone(task);
      }
    } },
  field('Who should do it?', grid),
  hint,
  h('div', { class: 'row gap wrap' },
    field('Title', title),
    scope() || store.games.length < 2 ? null : field('Game', selectEl([{ value: '', label: 'No game' }, ...store.games.map((g) => ({ value: g.slug, label: g.name }))], d.game, (v) => { d.game = v; }))),
  field('Details', body),
  chips.node,
  h('div', { class: 'row gap wrap' }, btn('Attach image', () => file.click(), { kind: 'sm', icon: 'clip' }), file,
    h('span', { class: 'hint' }, 'PNG, JPEG or WebP up to 5 MB. Paste or drop works too.')),
  h('details', { class: 'advanced' }, h('summary', {}, 'Advanced'),
    h('div', { class: 'stack sm' },
      field('Engine', selectEl([{ value: '', label: 'Role default' }, ...ENGINES], d.engine, (v) => { d.engine = v; })),
      h('label', { class: 'check' }, studio, h('span', {}, 'Needs Studio (takes a Studio lane while it runs)')))),
  h('div', { class: 'row end' }, h('button', { type: 'submit', class: 'btn primary' }, ic('plus', 14), 'Queue it')));
  sync();
  return form;
}
