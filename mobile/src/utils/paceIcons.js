// Rally-style pacenote icons, described as plain data so the same drawing can be rendered
// by react-native-svg (screens) and as an SVG string (Leaflet map markers).
//
// A tile spec: { bg, ink, items }, drawn in a 48×48 box. Items:
//   ['p', d, strokeWidth]   stroked path (strokeWidth 0 = filled)
//   ['c', cx, cy, r]        filled circle
//   ['t', x, y, size, text, anchor]

import { GRADE_INFO, gapLabel } from './pacenotes.js';

const RAD = Math.PI / 180;
const INK = '#141414';
const f = (n) => Math.round(n * 10) / 10;

// How each grade bends: turn angle, arc radius, straight run-in, start x, straight run-out.
const ARROWS = {
  6:  { th: 22,    r: 60,  s: 4,  x: 26, tail: 0 },
  5:  { th: 38,    r: 36,  s: 4,  x: 25, tail: 0 },
  4:  { th: 52,    r: 26,  s: 6,  x: 24, tail: 0 },
  3:  { th: 68,    r: 19,  s: 8,  x: 22, tail: 0 },
  2:  { th: 82,    r: 14,  s: 12, x: 22, tail: 0 },
  1:  { th: 90,    r: 9,   s: 16, x: 22, tail: 3 },
  sq: { th: 90,    r: 1.5, s: 23, x: 24, tail: 8 },
  hp: { th: 179.9, r: 7,   s: 18, x: 26, tail: 4 },
};

export function arrowSpec(grade, dir) {
  const a = ARROWS[grade] || ARROWS[4];
  const info = GRADE_INFO[grade] || GRADE_INFO[4];
  const th = a.th * RAD;
  const mx = (x) => f(dir === 'L' ? 48 - x : x);

  const y0 = 40;
  const ay = y0 - a.s;
  const ex = a.x + a.r * (1 - Math.cos(th));
  const ey = ay - a.r * Math.sin(th);
  const tx = Math.sin(th);
  const ty = -Math.cos(th);
  const bx = ex + tx * a.tail;
  const by = ey + ty * a.tail;
  const tip = [bx + tx * 9.5, by + ty * 9.5];
  const l = [bx - ty * 7, by + tx * 7];
  const r = [bx + ty * 7, by - tx * 7];

  const shaft = `M${mx(a.x)},${y0} L${mx(a.x)},${f(ay)} A${a.r},${a.r} 0 0 ${dir === 'L' ? 0 : 1} ${mx(ex)},${f(ey)} L${mx(bx)},${f(by)}`;
  const head = `M${mx(tip[0])},${f(tip[1])} L${mx(l[0])},${f(l[1])} L${mx(r[0])},${f(r[1])} Z`;

  return {
    bg: info.color,
    ink: INK,
    items: [
      ['p', shaft, 4.6],
      ['p', head, 0],
      ['c', mx(a.x), y0, 4.2],
      ['t', info.label.length > 1 ? 2.5 : 4, 44.5, info.label.length > 1 ? 11 : 16, info.label, 'start'],
    ],
  };
}

const YELLOW = '#f2e635';
const ORANGE = '#f5a623';
const RED = '#ef3b36';
const GREY = '#e2e5ea';
const BLUE = '#5fb0f5';

const TAG_SPECS = {
  caution:  { bg: RED,    items: [['p', 'M24,9 L24,28', 6.5], ['c', 24, 38, 3.8]] },
  brake:    { bg: RED,    items: [['p', 'M11,11 L24,22 L37,11', 5], ['p', 'M11,26 L24,37 L37,26', 5]] },
  jump:     { bg: ORANGE, items: [['p', 'M5,40 L27,40 L27,27 Z', 0], ['p', 'M29,23 L40,11', 4.5], ['p', 'M31,10 L41,10 L41,20', 4.5]] },
  crest:    { bg: YELLOW, items: [['p', 'M5,35 Q24,5 43,35', 5.5]] },
  bridge:   { bg: GREY,   items: [['p', 'M5,22 L43,22', 4.5], ['p', 'M8,38 Q24,16 40,38', 4], ['p', 'M14,22 L14,30 M24,22 L24,27 M34,22 L34,30', 3]] },
  narrow:   { bg: ORANGE, items: [['p', 'M11,42 L11,30 L19,19 L19,6', 4.5], ['p', 'M37,42 L37,30 L29,19 L29,6', 4.5]] },
  bumps:    { bg: ORANGE, items: [['p', 'M4,31 Q10,15 16,31 Q22,15 28,31 Q34,15 40,31 L44,31', 4.5]] },
  slippery: { bg: BLUE,   items: [['p', 'M24,6 C17,18 12,24 12,31 A12,12 0 0 0 36,31 C36,24 31,18 24,6 Z', 0]] },
  gravel:   { bg: '#d9b98c', items: [['c', 13, 15, 4], ['c', 29, 12, 3], ['c', 37, 24, 4], ['c', 21, 26, 3.4], ['c', 11, 35, 3], ['c', 30, 37, 4.4]] },
  rail:     { bg: GREY,   items: [['p', 'M16,5 L16,43 M32,5 L32,43', 4], ['p', 'M9,13 L39,13 M9,24 L39,24 M9,35 L39,35', 3.4]] },
  junction: { bg: GREY,   items: [['p', 'M24,5 L24,43 M5,24 L43,24', 8]] },
  tunnel:   { bg: '#aeb4be', items: [['p', 'M9,42 L9,25 A15,15 0 0 1 39,25 L39,42 Z', 0]] },
  water:    { bg: BLUE,   items: [['p', 'M5,19 Q11,11 17,19 T29,19 T41,19', 4.5], ['p', 'M5,33 Q11,25 17,33 T29,33 T41,33', 4.5]] },
  roundabout: { bg: BLUE, items: [['p', 'M36,24 A12,12 0 1 1 30,13.6', 4.6], ['p', 'M27,6 L37,12 L28,19 Z', 0]] },
  stop:     { bg: BLUE,   items: [['p', 'M24,43 C15,30 11,25 11,18 A13,13 0 0 1 37,18 C37,25 33,30 24,43 Z M24,13 A5,5 0 1 0 24,23 A5,5 0 1 0 24,13 Z', 0]] },
  finish:   { bg: '#f4f4f5', items: [['p', 'M8,8 H18 V18 H8 Z M28,8 H38 V18 H28 Z M18,18 H28 V28 H18 Z M8,28 H18 V38 H8 Z M28,28 H38 V38 H28 Z', 0], ['p', 'M8,8 H38 V38 H8 Z', 2]] },
};

const MOD_SPECS = {
  tightens: { bg: GREY, items: [['p', 'M12,9 L36,24 L12,39', 6]] },
  opens:    { bg: GREY, items: [['p', 'M36,9 L12,24 L36,39', 6]] },
  long:     { bg: GREY, items: [['p', 'M7,24 L41,24', 4.6], ['p', 'M15,15 L6,24 L15,33 M33,15 L42,24 L33,33', 4.6]] },
  cut:      { bg: '#8fdc4a', items: [['t', 24, 29, 14, 'TNIJ', 'middle']] },
  dontcut:  { bg: RED,  items: [['t', 24, 22, 13, 'NIE', 'middle'], ['t', 24, 37, 13, 'TNIJ', 'middle']] },
};

export function tagSpec(tag, note) {
  const s = TAG_SPECS[tag];
  if (!s) return null;
  if (tag === 'roundabout' && note?.exit) {
    return { ink: INK, ...s, items: [...s.items, ['t', 23.5, 28.5, 12, String(note.exit), 'middle']] };
  }
  return { ink: INK, ...s };
}

export function modSpec(mod) {
  const s = MOD_SPECS[mod];
  return s ? { ink: INK, ...s } : null;
}

// Distance figure ("150") on a dark tile.
export function distSpec(text) {
  const size = text.length > 3 ? 14 : text.length > 2 ? 18 : 22;
  return { bg: '#1c1f26', ink: '#f4f4f5', items: [['t', 24, 24 + size * 0.36, size, text, 'middle']] };
}

// All tiles for one note, most important first.
export function noteSpecs(note) {
  const out = [];
  if (note.kind === 'corner') out.push(arrowSpec(note.grade, note.dir));
  for (const t of note.tags || []) { const s = tagSpec(t, note); if (s) out.push(s); }
  for (const m of note.mods || []) { const s = modSpec(m); if (s) out.push(s); }
  if (!out.length) out.push(tagSpec('caution'));
  return out;
}

export function gapSpec(note) {
  const label = note.link ? null : gapLabel(note.gap ?? 0);
  return label ? distSpec(label) : null;
}

export function noteColor(note) {
  if (note.kind === 'corner') return (GRADE_INFO[note.grade] || GRADE_INFO[4]).color;
  const first = (note.tags || []).map((t) => TAG_SPECS[t]).find(Boolean);
  return first ? first.bg : RED;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function specToSvg(spec, size) {
  const body = spec.items.map((it) => {
    if (it[0] === 'p') {
      return it[2] > 0
        ? `<path d="${it[1]}" fill="none" stroke="${spec.ink}" stroke-width="${it[2]}" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<path d="${it[1]}" fill="${spec.ink}" fill-rule="evenodd"/>`;
    }
    if (it[0] === 'c') return `<circle cx="${it[1]}" cy="${it[2]}" r="${it[3]}" fill="${spec.ink}"/>`;
    return `<text x="${it[1]}" y="${it[2]}" font-size="${it[3]}" font-weight="800" font-family="system-ui,sans-serif" text-anchor="${it[5]}" fill="${spec.ink}">${esc(it[4])}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48">`
    + `<rect x="1" y="1" width="46" height="46" rx="7" fill="${spec.bg}" stroke="rgba(0,0,0,0.55)" stroke-width="2"/>${body}</svg>`;
}
