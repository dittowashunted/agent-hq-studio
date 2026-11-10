// A small popover menu: a "..." button that opens a list of actions. It closes on Escape, an outside click or a choice,
// and the arrow keys move between items. Used by the chat header and the Review filter row.
import { h, ic } from './core.js';

const dots = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>';

/** items: [{ text, icon, run, kind }] (null entries are skipped). note: an optional node shown above the items. */
export function popMenu({ label, items, note = null }) {
  const wrap = h('div', { class: 'menu-wrap' });
  const pop = h('div', { class: 'menu', role: 'menu', 'aria-label': label, hidden: true });
  const trig = h('button', { type: 'button', class: 'icon-btn more-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': label, title: label, html: dots });
  const rows = () => [...pop.querySelectorAll('[role="menuitem"]')];
  const away = (ev) => { if (!wrap.contains(ev.target)) close(); };
  const key = (ev) => {
    if (ev.key === 'Escape') { close(); trig.focus(); return; }
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const list = rows(); const at = list.indexOf(document.activeElement);
    list[(at + (ev.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
  };
  function close() {
    pop.hidden = true; trig.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key);
  }
  pop.append(note, ...items.filter(Boolean).map((it) => h('button', { type: 'button', role: 'menuitem', class: 'menu-item' + (it.kind ? ' ' + it.kind : ''), onclick: () => { close(); it.run(); } },
    it.icon ? ic(it.icon, 15) : null, h('span', { class: 'clip' }, it.text))));
  trig.addEventListener('click', () => {
    if (!pop.hidden) { close(); return; }
    pop.hidden = false; trig.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', away); document.addEventListener('keydown', key);
    rows()[0]?.focus();
  });
  wrap.append(trig, pop);
  return wrap;
}
