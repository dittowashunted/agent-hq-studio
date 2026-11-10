// Pro, Thumbnail tester: your icon or thumbnail next to today's trending game icons, at the slot you pick, as it would look on PC or phone.
// Icons are loaded from Roblox's own image URLs at view time; nothing is copied into HQ.
import { h, store, empty, field, selectEl, notify, mediaUrl, roleLabel } from './core.js';
import { gameIcon, K } from './rising.js';
import { purposeOf } from './review.js';
import { isVideo } from './viewer.js';

const st = { img: '', slot: 3, mode: 'pc' };
const SLOTS = 12;

// Rising games first, then every game on the latest charts; ones with an icon come first.
function trending(m) {
  const rows = m?.history?.rows || {};
  const seen = new Set();
  const out = [];
  const add = (id, name, url, playing) => { if (id == null || seen.has(String(id))) return; seen.add(String(id)); out.push({ id, name, url, playing }); };
  for (const r of m?.history?.rising || []) add(r.universeId, r.name, r.iconUrl, r.playing);
  for (const s of m?.latest?.sorts || []) for (const g of s.games || []) add(g.universeId, g.name, rows[g.universeId]?.iconUrl || g.iconUrl, g.playing);
  return [...out.filter((g) => /^https:/i.test(g.url || '')), ...out.filter((g) => !/^https:/i.test(g.url || ''))].slice(0, SLOTS);
}
const mine = () => store.asks.filter((a) => a.mediaPath && !isVideo(a.mediaPath) && purposeOf(a) === 'packaging').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

function tile(g, size, pc) {
  return h('li', { class: 'tt-tile' + (g.mine ? ' mine' : '') },
    g.mine ? h('img', { class: 'mk-icon tt-own', src: g.url, alt: 'Your image', width: size, height: size, style: `width:${size}px;height:${size}px` }) : gameIcon(g.url, g.name, size),
    h('span', { class: 'tt-name clip', title: g.name }, g.name),
    pc ? h('span', { class: 'tt-pl muted small' }, g.mine ? 'Your image' : g.playing != null ? K(g.playing) + ' playing' : '') : null,
    !pc && g.mine ? h('span', { class: 'tt-pl muted small' }, 'Yours') : null);
}

export function thumbtestStep(market) {
  if (market === undefined) return empty('Loading the charts');
  const games = trending(market);
  const images = mine();
  if (!images.some((a) => a.mediaPath === st.img)) st.img = images[0]?.mediaPath || '';
  const pc = st.mode === 'pc';
  const row = games.slice(0, SLOTS);
  const slot = Math.min(Math.max(1, st.slot), Math.max(1, row.length + 1));
  const own = st.img ? { id: 'mine', mine: true, name: 'Your game', url: mediaUrl(st.img) } : null;
  const list = own ? [...row.slice(0, slot - 1), own, ...row.slice(slot - 1)].slice(0, SLOTS) : row;
  const size = pc ? 120 : 84;
  return h('div', { class: 'stack' },
    h('div', { class: 'tt-controls' },
      field('Your image', images.length ? selectEl(images.map((a) => ({ value: a.mediaPath, label: `${a.title}${a.role ? ' · ' + roleLabel(a.role) : ''}` })), st.img, (v) => { st.img = v; notify(); }) : h('span', { class: 'muted small' }, 'None yet')),
      field('Slot', selectEl(Array.from({ length: Math.max(1, row.length + 1) }, (_, i) => ({ value: String(i + 1), label: `Slot ${i + 1}` })), String(slot), (v) => { st.slot = Number(v); notify(); }), 'Where your image sits among the charts.'),
      h('div', { class: 'field tt-seg' }, h('span', { class: 'field-label' }, 'Show as'),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Show as' }, [['pc', 'PC'], ['phone', 'Phone']].map(([id, l]) => h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(st.mode === id), onclick: () => { st.mode = id; notify(); } }, l))))),
    !images.length
      ? empty('No packaging images yet. Ask the Thumbnails role for icon options, approve one in Review, then come back and pick it here.')
      : !games.length
        ? empty('No chart data yet. Open Rising right now and refresh the charts, then come back.')
        : h('div', { class: 'tt-stage', 'data-mode': st.mode }, h('ul', { class: 'tt-grid', 'aria-label': `Trending games with your image in slot ${slot}` }, list.map((g) => tile(g, size, pc)))),
    h('p', { class: 'pg-note' }, 'Icons come from Roblox when you open this page and are not saved. A wide image is cropped to a square, the way Roblox crops an icon.'));
}
