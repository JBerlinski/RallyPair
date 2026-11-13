// Pacenote engine: turns route geometry into rally-style notes and decides which
// note is "called" for a given position. Pure functions only — no React Native imports.
//
// A note:
//   { id, kind: 'corner' | 'info', d, end, lat, lng,
//     dir: 'L' | 'R', grade,            (corners)
//     mods: [..], tags: [..], text, exit, auto }
// d / end are metres along the route (where the note starts / stops applying).

import { angDiff, bearing, pointAt, snapToRoute } from './geo.js';

// Hardest → easiest. '6' is nearly flat out, 'sq' a square 90°, 'hp' a hairpin.
export const GRADES = ['hp', 'sq', '1', '2', '3', '4', '5', '6'];

export const GRADE_INFO = {
  hp:  { label: 'Hp', name: 'Nawrót',       color: '#c81e2c' },
  sq:  { label: 'Sq', name: '90°',          color: '#e52b2b' },
  1:   { label: '1',  name: 'Bardzo ostry', color: '#ef3b36' },
  2:   { label: '2',  name: 'Ostry',        color: '#ee6a2c' },
  3:   { label: '3',  name: 'Ciasny',       color: '#f5a623' },
  4:   { label: '4',  name: 'Średni',       color: '#f2e635' },
  5:   { label: '5',  name: 'Łatwy',        color: '#8fdc4a' },
  6:   { label: '6',  name: 'Szybki',       color: '#3fcf3a' },
};

export const MODS = {
  tightens: 'Zacieśnia',
  opens:    'Otwiera',
  long:     'Długi',
  cut:      'Tnij',
  dontcut:  'Nie tnij',
};

export const TAGS = {
  caution:    'Uwaga!',
  brake:      'Hamuj',
  jump:       'Hopa',
  crest:      'Szczyt',
  bridge:     'Most',
  narrow:     'Zwężenie',
  bumps:      'Nierówno',
  slippery:   'Ślisko',
  gravel:     'Szuter',
  rail:       'Tory',
  junction:   'Skrzyżowanie',
  tunnel:     'Tunel',
  water:      'Woda',
  roundabout: 'Rondo',
  stop:       'Przystanek',
  finish:     'Meta',
};

// Tags the navigator can toggle by hand (the rest are structural).
export const HAZARD_TAGS = [
  'caution', 'brake', 'jump', 'crest', 'bridge', 'narrow', 'bumps',
  'slippery', 'gravel', 'rail', 'junction', 'tunnel', 'water', 'roundabout', 'stop',
];

const RAD = Math.PI / 180;
const STEP = 5;          // resampling interval
const CHORD = 2;         // heading is measured over ±CHORD samples (20 m chord)
const MIN_KAPPA = 1 / 350; // anything straighter than a 350 m radius is not a corner
const LINK_GAP = 30;     // corners closer than this are called as "into"

let seq = 0;
export function noteId() {
  seq += 1;
  return `n${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function gradeFor(radius, angle, length) {
  if (angle >= 135 && radius < 35) return 'hp';
  if (angle >= 70 && angle <= 115 && radius < 18 && length < 50) return 'sq';
  if (radius < 20) return '1';
  if (radius < 35) return '2';
  if (radius < 60) return '3';
  if (radius < 100) return '4';
  if (radius < 170) return '5';
  return '6';
}

const easier = (g) => GRADES[Math.min(GRADES.length - 1, GRADES.indexOf(g) + 1)];

// Finds corners from geometry alone.
export function detectCorners(coords, cum) {
  const total = cum[cum.length - 1];
  const n = Math.floor(total / STEP) + 1;
  if (n < 2 * CHORD + 3) return [];

  const pts = new Array(n);
  for (let i = 0; i < n; i++) pts[i] = pointAt(coords, cum, i * STEP);

  const head = new Array(n);
  for (let i = 0; i < n; i++) head[i] = bearing(pts[Math.max(0, i - CHORD)], pts[Math.min(n - 1, i + CHORD)]);

  // Curvature in rad/m, positive = right. Lightly smoothed.
  const raw = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) raw[i] = (angDiff(head[i - 1], head[i + 1]) * RAD) / (2 * STEP);
  const kappa = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) kappa[i] = (raw[i - 1] + 2 * raw[i] + raw[i + 1]) / 4;

  // Runs of consistent turning direction; tiny straight gaps inside a run are bridged.
  const runs = [];
  let cur = null;
  for (let i = 0; i < n; i++) {
    const s = kappa[i] > MIN_KAPPA ? 1 : kappa[i] < -MIN_KAPPA ? -1 : 0;
    if (s === 0) continue;
    if (cur && cur.s === s && i - cur.b <= 3) cur.b = i;
    else { cur = { s, a: i, b: i }; runs.push(cur); }
  }

  const corners = [];
  for (const run of runs) {
    let sum = 0;
    let kmax = 0;
    for (let i = run.a; i <= run.b; i++) { sum += kappa[i]; kmax = Math.max(kmax, Math.abs(kappa[i])); }
    const angle = Math.abs(sum * STEP) / RAD;
    const length = (run.b - run.a + 1) * STEP;
    if (angle < 10 || kmax === 0) continue;

    let grade = gradeFor(1 / kmax, angle, length);
    if (angle < 18 && grade === '6') continue;           // flat-out kink: noise
    if (angle < 24 && grade !== 'hp' && grade !== 'sq') grade = easier(grade);

    const mods = [];
    if (length >= 40) {
      const third = Math.max(2, Math.round((run.b - run.a + 1) * 0.35));
      let first = 0;
      let last = 0;
      for (let i = 0; i < third; i++) { first += Math.abs(kappa[run.a + i]); last += Math.abs(kappa[run.b - i]); }
      if (last > first * 1.8) mods.push('tightens');
      else if (first > last * 1.8) mods.push('opens');
    }
    if (grade !== 'hp' && ((length >= 100 && angle >= 60) || (length >= 60 && angle >= 110))) mods.push('long');

    // The 20 m chord smears each corner by ~half a chord on both sides.
    const d = Math.max(0, run.a * STEP + STEP);
    const end = Math.max(d + STEP, Math.min(total, run.b * STEP - STEP));
    const p = pointAt(coords, cum, d);
    corners.push({
      id: noteId(), kind: 'corner', d, end, lat: p[0], lng: p[1],
      dir: run.s > 0 ? 'R' : 'L', grade, mods, tags: [], text: '', auto: true,
    });
  }
  return corners;
}

function infoNote(coords, cum, d, extra) {
  const p = pointAt(coords, cum, d);
  return {
    id: noteId(), kind: 'info', d, end: d, lat: p[0], lng: p[1],
    mods: [], tags: [], text: '', auto: true, ...extra,
  };
}

// Full automatic roadbook for a route.
//   steps:  OSRM maneuvers as [{ d, type, modifier, exit, length }]
//   stops:  intermediate waypoints as [{ d, label }]
export function buildNotes({ coords, cum, steps = [], stops = [] }) {
  const total = cum[cum.length - 1];
  let notes = detectCorners(coords, cum);

  // Roundabouts: geometry inside one is meaningless as corners — replace with a single note.
  for (const s of steps) {
    if (s.type !== 'roundabout' && s.type !== 'rotary') continue;
    const end = Math.min(total, s.d + Math.max(10, s.length || 0));
    notes = notes.filter((nt) => nt.end < s.d - 15 || nt.d > end + 10);
    notes.push(infoNote(coords, cum, Math.max(0, s.d - 5), { end, tags: ['roundabout'], exit: s.exit || null }));
  }

  // Turns at junctions: mark the matching corner so the driver knows it is not just a bend.
  for (const s of steps) {
    if (!['turn', 'end of road', 'fork', 'roundabout turn'].includes(s.type)) continue;
    if (!s.modifier || s.modifier === 'straight' || s.modifier.startsWith('slight')) continue;
    const hit = notes.find((nt) => nt.kind === 'corner' && s.d >= nt.d - 25 && s.d <= nt.end + 25);
    if (hit && !hit.tags.includes('junction')) hit.tags.push('junction');
  }

  for (const st of stops) {
    if (st.d > 20 && st.d < total - 20) notes.push(infoNote(coords, cum, st.d, { tags: ['stop'], text: st.label || '' }));
  }
  notes.push(infoNote(coords, cum, total, { tags: ['finish'] }));

  return sortNotes(notes);
}

export function sortNotes(notes) {
  return [...notes].sort((a, b) => a.d - b.d);
}

// Carries the navigator's manual work over to a recalculated route: every hand-made or
// hand-edited note that still lies on the new route is kept, and replaces the automatic
// notes it overlaps.
export function mergeManual(autoNotes, oldNotes, coords, cum) {
  const kept = [];
  for (const nt of oldNotes || []) {
    if (nt.auto || nt.tags?.includes('finish')) continue;
    const snap = snapToRoute(coords, cum, [nt.lat, nt.lng]);
    if (snap.off > 30) continue;
    const len = Math.max(0, nt.end - nt.d);
    kept.push({ ...nt, d: snap.d, end: snap.d + len });
  }
  if (!kept.length) return autoNotes;
  const corners = kept.filter((k) => k.kind === 'corner');
  const rest = autoNotes.filter((a) =>
    a.kind !== 'corner' || !corners.some((k) => a.d <= k.end + 20 && a.end >= k.d - 20));
  return sortNotes([...rest, ...kept]);
}

// Attaches road features (bridges, level crossings…) found near the route.
//   features: [{ tag, d }]
export function applyFeatures(notes, features, coords, cum) {
  const out = notes.map((n) => ({ ...n, tags: [...n.tags] }));
  for (const f of features) {
    const corner = out.find((n) => n.kind === 'corner' && f.d >= n.d - 20 && f.d <= n.end + 20);
    if (corner) {
      if (!corner.tags.includes(f.tag)) corner.tags.push(f.tag);
    } else if (f.tag === 'rail' || f.tag === 'tunnel') {
      if (!out.some((n) => n.tags.includes(f.tag) && Math.abs(n.d - f.d) < 60)) {
        out.push(infoNote(coords, cum, f.d, { tags: [f.tag] }));
      }
    }
  }
  return sortNotes(out);
}

// ── Reading notes ────────────────────────────────────────────────────────────

// Distance figure called before a note, rally style: 40, 70, 150, 300…
export function gapLabel(gap) {
  if (gap < LINK_GAP) return null;
  if (gap < 100) return String(Math.round(gap / 10) * 10);
  if (gap < 1000) return String(Math.round(gap / 50) * 50);
  return `${(gap / 1000).toFixed(1)}k`;
}

// Adds `gap` (straight before the note) and `link` (flows straight out of the previous one).
export function withGaps(notes) {
  let prevEnd = 0;
  return notes.map((n, i) => {
    const gap = Math.max(0, n.d - prevEnd);
    prevEnd = Math.max(prevEnd, n.end);
    return { ...n, gap, link: i > 0 && gap < LINK_GAP };
  });
}

// Plain-text description, used for list captions and accessibility.
export function noteText(note) {
  const parts = [];
  if (note.kind === 'corner') {
    const g = GRADE_INFO[note.grade] || GRADE_INFO[4];
    parts.push(`${note.dir === 'L' ? 'Lewy' : 'Prawy'} ${g.label}`);
  }
  for (const m of note.mods || []) if (MODS[m]) parts.push(MODS[m].toLowerCase());
  for (const t of note.tags || []) {
    if (!TAGS[t]) continue;
    parts.push(t === 'roundabout' && note.exit ? `${TAGS[t]}, ${note.exit}. zjazd` : TAGS[t]);
  }
  if (note.text) parts.push(note.text);
  return parts.join(' · ') || 'Notatka';
}

// Which note is being called at `progress` metres along the route.
// Returns { index, distTo } or null when every note is behind the car.
export function callState(notes, progress) {
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const pass = n.kind === 'corner' ? n.d + Math.min(20, (n.end - n.d) / 2) : n.d + 8;
    if (progress < pass) return { index: i, distTo: Math.max(0, n.d - progress) };
  }
  return null;
}
