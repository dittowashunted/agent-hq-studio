// Small shared UI bits and dependency-free SVG/CSS charts for the Games, Market and Pitches pages.
import { h } from './core.js';

export const num = (n) => (n == null || Number.isNaN(Number(n)) ? 'n/a' : Number(n).toLocaleString());
export const chip = (text, tone) => h('span', { class: 'pg-chip', 'data-tone': tone || null }, text);
export function tile(label, value, sub, tone) {
  const none = value == null || value === '';
  return h('div', { class: 'pg-tile', 'data-tone': tone || null },
    h('span', { class: 'k' }, label),
    h('span', { class: 'v' + (none ? ' dim' : '') }, none ? 'not measured' : value),
    sub ? h('span', { class: 't' }, sub) : null);
}
export function segmented(items, current, onPick, counts = {}) {
  return h('div', { class: 'pg-seg', role: 'tablist' }, items.map(([id, label]) => h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(id === current), onclick: () => onPick(id),
  }, label, counts[id] != null ? h('span', { class: 'pg-count' }, counts[id]) : null)));
}

const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  kids.forEach((k) => k && e.append(k));
  return e;
};
const svText = (attrs, text) => { const t = sv('text', attrs); t.textContent = text; return t; };
export const compact = (n) => (Math.abs(n) >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n * 10) / 10));
const shortDate = (x) => new Date(x).toLocaleDateString([], { month: 'short', day: 'numeric' });
const shortHour = (x) => new Date(x).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric' });

const W = 560; const H = 170; const L = 56; const R = 64; const T = 12; const B = 22;

function frame(title, note) {
  return h('div', { class: 'pg-chart' }, h('h4', {}, title), note ? h('p', { class: 'pg-note' }, note) : null);
}
export function emptyChart(title, text) { return h('div', { class: 'pg-chart' }, h('h4', {}, title), h('p', { class: 'pg-note' }, text || 'No data yet.')); }

function legend(names) {
  return names.length > 1 ? h('div', { class: 'pg-legend' }, names.map((n, i) => h('span', {}, h('i', { class: 's' + (i % 5) }), n))) : null;
}

function scale(values, { target = null, zero = false } = {}) {
  let lo = Math.min(...values, target ?? Infinity); let hi = Math.max(...values, target ?? -Infinity);
  if (zero) lo = Math.min(lo, 0);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.1; if (!zero) lo = Math.max(0, lo - pad); hi += pad;
  return [lo, hi];
}

// One or more series over shared x values (Date, number or ISO string). series = [{name, values:[number|null]}]
export function multiLine(title, xs, series, { unit = '', target = null, hours = false, note = '', area = false } = {}) {
  const wrap = frame(title);
  const live = series.filter((s) => (s.values || []).some((v) => v != null && Number.isFinite(v)));
  const n = xs.length;
  if (!live.length || n < 2) {
    wrap.append(h('p', { class: 'pg-note' }, note || (n === 1 ? 'One reading so far. A line needs two or more.' : 'No data yet.')));
    return wrap;
  }
  const px = xs.map((x) => +new Date(x));
  const x0 = Math.min(...px); const x1 = Math.max(...px);
  const all = live.flatMap((s) => s.values.filter((v) => v != null && Number.isFinite(v)));
  const [lo, hi] = scale(all, { target });
  const fmt = (v) => (hi - lo < 2000 && Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : compact(v)) + unit;
  const X = (x) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R);
  const Y = (y) => T + (1 - (y - lo) / (hi - lo)) * (H - T - B);
  const svgEl = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${title}: ${live.map((s) => `${s.name || 'value'} latest ${fmt(s.values.filter((v) => v != null).at(-1))}`).join(', ')}` });
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3; const y = Y(v);
    svgEl.append(sv('line', { class: 'grid', x1: L, x2: W - R, y1: y, y2: y }), svText({ class: 'axis', x: L - 6, y: y + 3, 'text-anchor': 'end' }, fmt(v)));
  }
  if (target != null) svgEl.append(sv('line', { class: 'tgt', x1: L, x2: W - R, y1: Y(target), y2: Y(target) }));
  live.forEach((s, si) => {
    const pts = s.values.map((v, i) => (v == null || !Number.isFinite(v) ? null : [X(px[i]), Y(v)])).filter(Boolean);
    if (area && si === 0) svgEl.append(sv('path', { class: 'area', d: `M${pts[0][0].toFixed(1)} ${H - B} ` + pts.map((p) => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') + ` L${pts.at(-1)[0].toFixed(1)} ${H - B} Z` }));
    svgEl.append(sv('path', { class: 'line s' + (si % 5), d: pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') }));
    const last = pts.at(-1);
    svgEl.append(sv('circle', { class: 'dot s' + (si % 5), cx: last[0], cy: last[1], r: 3.2 }));
    if (si === 0 || live.length < 3) svgEl.append(svText({ class: 'lbl', x: last[0] + 6, y: last[1] + 4 }, fmt(s.values.filter((v) => v != null).at(-1))));
  });
  const ds = hours ? shortHour : shortDate;
  svgEl.append(svText({ class: 'axis', x: X(x0), y: H - 6, 'text-anchor': 'start' }, ds(x0)), svText({ class: 'axis', x: X(x1), y: H - 6, 'text-anchor': 'end' }, ds(x1)));
  wrap.append(svgEl, legend(live.map((s) => s.name)));
  return wrap;
}

// Single series line: points = [{x, y}]
export function lineChart(title, points, { unit = '', target = null, area = false } = {}) {
  const pts = points.filter((p) => p.y != null && Number.isFinite(p.y));
  if (pts.length < 2) return emptyChart(title, pts.length ? `One reading so far (${compact(pts[0].y)}${unit}). A line needs two or more refreshes.` : 'No readings yet.');
  return multiLine(title, pts.map((p) => p.x), [{ name: '', values: pts.map((p) => p.y) }], { unit, target, area });
}

// Columns over labels, optionally stacked. series = [{name, values}]
export function columnChart(title, labels, series, { stacked = true, unit = '', hours = false, note = '' } = {}) {
  const wrap = frame(title);
  const n = labels.length;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (Number(s.values?.[i]) || 0), 0));
  if (!n || !totals.some((t) => t > 0)) { wrap.append(h('p', { class: 'pg-note' }, note || 'No data yet.')); return wrap; }
  const maxv = stacked ? Math.max(...totals) : Math.max(...series.flatMap((s) => s.values.map((v) => Number(v) || 0)));
  const hi = maxv * 1.08 || 1;
  const Y = (v) => T + (1 - v / hi) * (H - T - B);
  const slot = (W - L - 10) / n; const bw = Math.max(2, Math.min(28, slot * 0.7));
  const svgEl = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${title}, ${n} bars` });
  for (let i = 0; i <= 3; i++) {
    const v = (hi * i) / 3; const y = Y(v);
    svgEl.append(sv('line', { class: 'grid', x1: L, x2: W - 10, y1: y, y2: y }), svText({ class: 'axis', x: L - 6, y: y + 3, 'text-anchor': 'end' }, compact(v) + unit));
  }
  labels.forEach((lb, i) => {
    const cx = L + slot * i + slot / 2;
    let acc = 0;
    series.forEach((s, si) => {
      const v = Number(s.values?.[i]) || 0;
      if (!v) return;
      const k = stacked ? bw : bw / series.length;
      const x = stacked ? cx - bw / 2 : cx - bw / 2 + si * k;
      const y0 = stacked ? Y(acc + v) : Y(v);
      const hgt = stacked ? Y(acc) - Y(acc + v) : Y(0) - Y(v);
      svgEl.append(sv('rect', { class: 'bar s' + (si % 5), x, y: y0, width: k - (stacked ? 0 : 1), height: Math.max(1, hgt), rx: 1.5 }, (() => { const t = sv('title'); t.textContent = `${hours ? shortHour(lb) : shortDate(lb)}: ${s.name} ${compact(v)}${unit}`; return t; })()));
      if (stacked) acc += v;
    });
  });
  const ds = hours ? shortHour : shortDate;
  svgEl.append(svText({ class: 'axis', x: L + slot / 2, y: H - 6, 'text-anchor': 'start' }, ds(labels[0])), svText({ class: 'axis', x: L + slot * (n - 0.5), y: H - 6, 'text-anchor': 'end' }, ds(labels[n - 1])));
  wrap.append(svgEl, legend(series.filter((s) => s.values?.some((v) => v)).map((s) => s.name)));
  return wrap;
}

// Horizontal bars as plain CSS: rows = [{label, value, text?}]
export function hbars(title, rows, { unit = '', note = '', max = null } = {}) {
  const wrap = frame(title);
  const list = (rows || []).filter((r) => r.value != null && Number.isFinite(r.value));
  if (!list.length) { wrap.append(h('p', { class: 'pg-note' }, note || 'No data yet.')); return wrap; }
  const top = max ?? Math.max(...list.map((r) => r.value), 1);
  wrap.append(h('div', { class: 'pg-hbars' }, list.map((r) => h('div', { class: 'pg-hbar' },
    h('span', { class: 'lab', title: r.label }, r.label),
    h('span', { class: 'track' }, h('span', { class: 'fill', style: `width:${Math.max(1, (r.value / top) * 100).toFixed(1)}%` })),
    h('span', { class: 'val' }, r.text ?? (compact(r.value) + unit))))));
  return wrap;
}

// Tiny trend line for table cells and cards. values = [number], two or more, oldest first. Returns null with fewer.
export function sparkline(values, { w = 72, h: hh = 22 } = {}) {
  const v = (values || []).map(Number).filter(Number.isFinite);
  if (v.length < 2) return null;
  const lo = Math.min(...v); const hi = Math.max(...v);
  const X = (i) => 2 + (i / (v.length - 1)) * (w - 4);
  const Y = (n) => (hi === lo ? hh / 2 : 2 + (1 - (n - lo) / (hi - lo)) * (hh - 4));
  const d = v.map((n, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(n).toFixed(1)}`).join(' ');
  const dir = v.at(-1) > v[0] ? 'up' : v.at(-1) < v[0] ? 'down' : 'flat';
  return sv('svg', { class: 'mk-spark', 'data-dir': dir, viewBox: `0 0 ${w} ${hh}`, width: w, height: hh, role: 'img', 'aria-label': `Trend over ${v.length} readings, from ${compact(v[0])} to ${compact(v.at(-1))}` },
    sv('path', { class: 'fill', d: `${d} L${X(v.length - 1).toFixed(1)} ${hh} L${X(0).toFixed(1)} ${hh} Z` }),
    sv('path', { class: 'ln', d }),
    sv('circle', { class: 'end', cx: X(v.length - 1).toFixed(1), cy: Y(v.at(-1)).toFixed(1), r: 2.2 }));
}

// Score bands (owner decision D1): red below 4, amber 4 to 6.9, green 7 and above. The number is always shown beside the colour.
export const scoreTone = (n) => (n < 4 ? 'low' : n < 7 ? 'mid' : 'high');

// 0 to 10 ring with the number in the middle.
export function scoreRing(score, { size = 76 } = {}) {
  const n = Math.max(0, Math.min(10, Number(score) || 0));
  const r = 32; const c = 2 * Math.PI * r;
  return sv('svg', { class: 'mk-ring', 'data-tone': scoreTone(n), viewBox: '0 0 76 76', width: size, height: size, role: 'img', 'aria-label': `Score ${n.toFixed(1)} out of 10` },
    sv('circle', { class: 'track', cx: 38, cy: 38, r }),
    sv('circle', { class: 'arc', cx: 38, cy: 38, r, 'stroke-dasharray': `${((n / 10) * c).toFixed(1)} ${c.toFixed(1)}`, transform: 'rotate(-90 38 38)' }),
    svText({ class: 'num', x: 38, y: 42, 'text-anchor': 'middle' }, n.toFixed(1)),
    svText({ class: 'of', x: 38, y: 57, 'text-anchor': 'middle' }, '/10'));
}
