// Review viewer: the media on the left, the decision on the right. openViewer(asks, index).
// Answers keep their old strings: approve, changes:<note>, reject:<reason>. Keys A, C, R work only while it is open.
import { h, ic, store, roleLabel, avatar, mediaUrl, plain, gameName, ago, toast, subscribe } from './core.js';
import { answer, verdictOf, noteOf, needsDecision, pinModal } from './review.js';

export const isVideo = (p) => /\.(mp4|webm|mov)$/i.test(p || '');
// verdict -> [label, tone]. The label is always shown, so colour is never the only signal.
export const VERDICT = { approved: ['Approved', 'green'], rejected: ['Rejected', 'red'], changes: ['Changes asked', 'amber'], held: ['On hold', 'blue'], dismissed: ['Dismissed', 'grey'], answered: ['Answered', 'grey'] };

let current = null;
function smallPreview(path) {
  const url = mediaUrl(path);
  const fig = (label, w) => h('figure', { class: 'fig' }, h('img', { src: url, alt: label + ' preview', style: w ? `width:${w}px;max-width:100%` : 'max-width:100%;max-height:200px' }), h('figcaption', { class: 'muted small' }, label));
  return h('div', { class: 'small-prev' }, fig('150 px', 150), fig('512 px', 512), fig('Full size', 0));
}
export function closeViewer() { current?.close(); }

export function openViewer(asks, index = 0, onClose) {
  const ids = asks.filter((a) => a?.mediaPath).map((a) => a.id);
  if (!ids.length) return;
  closeViewer();
  let i = Math.min(Math.max(0, index), ids.length - 1);
  let sig = '';
  let small = ''; // ask id whose small-size preview is open
  const notes = {}; // per-ask draft, so prev and next keep what was typed
  const get = (n = i) => store.asks.find((a) => a.id === ids[n]) || asks.find((a) => a.id === ids[n]);
  const stage = h('div', { class: 'vw-stage' });
  const panel = h('aside', { class: 'vw-panel', 'aria-label': 'Your decision' });
  const count = h('span', { class: 'vw-count', 'aria-live': 'polite' });
  const dl = h('a', { class: 'vw-btn', download: '', href: '#', 'aria-label': 'Download' }, ic('download', 16), h('span', { class: 'vw-lbl' }, 'Download'));
  const media = h('div', { class: 'vw-media' });
  const tool = (label, fn, ...kids) => h('button', { type: 'button', class: 'vw-btn', 'aria-label': label, title: label, onclick: fn }, ...kids);
  const prev = h('button', { type: 'button', class: 'vw-nav prev', 'aria-label': 'Previous', onclick: () => show(i - 1) }, ic('back', 22));
  const next = h('button', { type: 'button', class: 'vw-nav next', 'aria-label': 'Next', onclick: () => show(i + 1) }, ic('chevron', 22));
  const root = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Review viewer' }, h('div', { class: 'vw-shell' }, media, panel));
  media.append(
    h('div', { class: 'vw-bar' }, count, h('span', { class: 'grow' }), dl,
      tool('Full screen', () => (document.fullscreenElement ? document.exitFullscreen() : media.requestFullscreen?.()), ic('expand', 16), h('span', { class: 'vw-lbl' }, 'Full screen')),
      tool('Close (Esc)', close, ic('x', 16))),
    stage, prev, next);

  const sigOf = (a) => [a.id, a.state, verdictOf(a), noteOf(a)].join('|');

  async function decide(kind) {
    const a = get();
    if (a.state !== 'open' || a.kind !== 'review') return;
    const t = (notes[a.id] || '').trim();
    if ((kind === 'changes' || kind === 'hold') && !t) { toast(kind === 'hold' ? 'Say why it is parked first' : 'Say what would make it right first', 'error'); panel.querySelector('textarea')?.focus(); return; }
    await answer(a, t ? `${kind}:${t}` : kind, { approve: 'Approved', changes: 'Sent to ' + roleLabel(a.role), hold: 'On hold', reject: 'Rejected' }[kind]);
    if (get().state === 'open') return; // the request failed; the toast says why
    delete notes[a.id];
    const n = ids.findIndex((_, k) => { const x = get((i + 1 + k) % ids.length); return x && x.id !== a.id && needsDecision(x) && x.kind === 'review'; });
    if (n >= 0) show((i + 1 + n) % ids.length); else paint();
  }

  function paint() {
    const a = get();
    const v = verdictOf(a);
    const who = roleLabel(a.role);
    const task = store.tasks.find((t) => t.id === a.taskId);
    const when = ago(a.createdAt);
    const meta = [isVideo(a.mediaPath) ? 'Video' : 'Image', task?.game ? gameName(task.game) : null, when === 'just now' ? when : when + ' ago'].filter(Boolean).join(' · ');
    const [vLabel, vTone] = VERDICT[v] || [];
    const live = a.state === 'open' && a.kind === 'review';
    sig = sigOf(a);
    const note = h('textarea', { class: 'textarea vw-note', rows: 5, placeholder: 'What would make it right?', 'aria-label': `Note for ${who}`, oninput: (e) => { notes[a.id] = e.target.value; } });
    note.value = notes[a.id] || '';
    const act = (kind, label, key, icon, cls) => h('button', { type: 'button', class: 'btn vw-act ' + cls, 'aria-keyshortcuts': key, onclick: () => decide(kind) }, ic(icon, 16), h('span', { class: 'grow' }, label), h('kbd', {}, key));
    panel.replaceChildren(...[
      h('div', { class: 'vw-who' }, avatar(a.role, 36), h('div', {}, h('div', { class: 'vw-made' }, 'Made by ', who), h('div', { class: 'muted small' }, meta))),
      h('div', { class: 'vw-ask' }, h('h2', {}, plain(a.title)), a.why ? h('p', { class: 'muted pre' }, a.why) : null),
      ...(live ? [
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, `Note for ${who} `, h('span', { class: 'faint' }, '(needed to ask for changes or hold; sent along with Approve)')), note),
        h('p', { class: 'vw-help' }, `Ask for changes sends your note to ${who} as a new task. Hold needs a note too and parks it.`),
        h('div', { class: 'vw-acts' }, act('approve', 'Approve', 'A', 'check', 'good'), act('changes', 'Ask for changes', 'C', 'pencil', ''), act('hold', 'Hold', 'H', 'pause', ''), act('reject', 'Reject', 'R', 'x', 'bad')),
      ] : [
        vLabel ? h('div', {}, h('span', { class: 'spill', 'data-tone': vTone }, vLabel)) : null,
        noteOf(a) ? h('p', { class: 'pre' }, noteOf(a)) : null,
        a.state === 'open' && a.options?.length ? h('div', { class: 'vw-acts' }, a.options.map((o) => h('button', { type: 'button', class: 'btn vw-act', onclick: async () => { await answer(a, o.id); if (get().state !== 'open') paint(); } }, h('span', { class: 'grow' }, o.label)))) : null,
        a.state === 'open' && !a.options?.length ? h('p', { class: 'muted' }, a.kind === 'reference' ? 'Reference only: nothing to decide here.' : 'This one is a question, not a review. Answer it in the list.') : null,
      ]),
      !isVideo(a.mediaPath) ? h('div', { class: 'row gap wrap' },
        h('button', { type: 'button', class: 'btn ghost sm', 'aria-expanded': String(small === a.id), onclick: () => { small = small === a.id ? '' : a.id; paint(); } }, ic('search', 14), 'How it reads small'),
        v === 'approved' ? h('button', { type: 'button', class: 'btn ghost sm', onclick: () => pinModal(a.mediaPath, a.title) }, ic('image', 14), 'Pin to Visual bar') : null) : null,
      small === a.id && !isVideo(a.mediaPath) ? smallPreview(a.mediaPath) : null,
    ].filter(Boolean));
  }

  function show(n) {
    i = (n + ids.length) % ids.length;
    const a = get();
    const url = mediaUrl(a.mediaPath);
    stage.replaceChildren(isVideo(a.mediaPath) ? h('video', { class: 'vw-img', src: url, controls: true, preload: 'metadata' }) : h('img', { class: 'vw-img', src: url, alt: plain(a.title) }));
    dl.href = url;
    dl.setAttribute('download', decodeURIComponent(url.split('?')[0].split('/').pop()) || 'media');
    count.textContent = `${i + 1} / ${ids.length}`;
    prev.hidden = next.hidden = ids.length < 2;
    paint();
  }

  function onKey(e) {
    const typing = /^(TEXTAREA|INPUT|SELECT)$/.test(document.activeElement?.tagName || '');
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (typing) document.activeElement.blur(); else close(); return; }
    if (e.key === 'Tab') {
      const f = [...root.querySelectorAll('button, a[href], textarea, video')].filter((el) => !el.hidden && !el.disabled);
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'a') decide('approve');
    else if (k === 'c') { const a = get(); if (a.state === 'open' && !(notes[a.id] || '').trim()) panel.querySelector('textarea')?.focus(); else decide('changes'); }
    else if (k === 'h') decide('hold');
    else if (k === 'r') decide('reject');
    else if (e.key === 'ArrowRight' && ids.length > 1) show(i + 1);
    else if (e.key === 'ArrowLeft' && ids.length > 1) show(i - 1);
    else return;
    e.preventDefault(); e.stopPropagation();
  }

  const prevFocus = document.activeElement;
  const unsub = subscribe(() => { const a = get(); if (a && sigOf(a) !== sig) paint(); });
  function close() {
    document.removeEventListener('keydown', onKey, true);
    unsub();
    root.remove();
    current = null;
    prevFocus?.focus?.({ preventScroll: true });
    onClose?.();
  }
  document.getElementById('overlay').append(root);
  document.addEventListener('keydown', onKey, true);
  current = { close };
  show(i);
  root.querySelector('button[aria-label="Close (Esc)"]').focus();
}
