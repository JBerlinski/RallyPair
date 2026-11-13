import test from 'node:test';
import assert from 'node:assert/strict';
import { cumulative, snapToRoute, sliceRoute, pointAt, bearingAt, angDiff } from '../src/utils/geo.js';
import {
  detectCorners, buildNotes, withGaps, callState, mergeManual, applyFeatures, gapLabel,
} from '../src/utils/pacenotes.js';
import { matchFeatures } from '../src/utils/overpass.js';
import { parseCoords } from '../src/utils/parseLocation.js';
import { noteSpecs, specToSvg, arrowSpec } from '../src/utils/paceIcons.js';

// Builds a route from straights and arcs: [['s', metres] | ['a', radius, degrees(+right)]]
function makeRoute(parts, step = 4) {
  const lat0 = 50;
  const ky = 111320;
  const kx = ky * Math.cos((lat0 * Math.PI) / 180);
  let x = 0, y = 0, h = 0; // h: heading in rad, 0 = north
  const pts = [[x, y]];
  const advance = (len, dh) => {
    const n = Math.max(1, Math.round(len / step));
    for (let i = 0; i < n; i++) {
      h += dh / n / 2;
      x += Math.sin(h) * (len / n);
      y += Math.cos(h) * (len / n);
      h += dh / n / 2;
      pts.push([x, y]);
    }
  };
  for (const p of parts) {
    if (p[0] === 's') advance(p[1], 0);
    else advance((Math.abs(p[2]) * Math.PI / 180) * p[1], (p[2] * Math.PI) / 180);
  }
  return pts.map(([px, py]) => [lat0 + py / ky, 19 + px / kx]);
}

test('geo: snapping, slicing and bearings', () => {
  const coords = makeRoute([['s', 500]]);
  const cum = cumulative(coords);
  assert.ok(Math.abs(cum[cum.length - 1] - 500) < 2);
  const p = pointAt(coords, cum, 250);
  const snap = snapToRoute(coords, cum, [p[0], p[1] + 0.0002]);
  assert.ok(Math.abs(snap.d - 250) < 2);
  assert.ok(snap.off > 10 && snap.off < 20);
  assert.ok(Math.abs(angDiff(0, bearingAt(coords, cum, 100))) < 1);
  const part = sliceRoute(coords, cum, 100, 200);
  assert.ok(Math.abs(cumulative(part).pop() - 100) < 1);
});

test('geo: snapping prefers forward progress on an out-and-back route', () => {
  const out = makeRoute([['s', 300]]);
  const coords = [...out, ...out.slice(0, -1).reverse()];
  const cum = cumulative(coords);
  const p = pointAt(coords, cum, 450); // on the way back
  assert.ok(Math.abs(snapToRoute(coords, cum, p, 440).d - 450) < 3);
  assert.ok(Math.abs(snapToRoute(coords, cum, p, 140).d - 150) < 3);
});

test('detects direction and severity of corners', () => {
  const coords = makeRoute([
    ['s', 200], ['a', 250, 30], ['s', 150], ['a', 80, -60], ['s', 150],
    ['a', 28, 90], ['s', 120], ['a', 12, -180], ['s', 200],
  ]);
  const corners = detectCorners(coords, cumulative(coords));
  assert.deepEqual(corners.map((c) => c.dir), ['R', 'L', 'R', 'L']);
  assert.deepEqual(corners.map((c) => c.grade), ['6', '4', '2', 'hp']);
  assert.ok(Math.abs(corners[0].d - 200) < 25);
});

test('a sharp junction turn is a square, a straight has no corners', () => {
  const straight = makeRoute([['s', 800]]);
  assert.equal(detectCorners(straight, cumulative(straight)).length, 0);
  const junction = makeRoute([['s', 200], ['a', 2, 90], ['s', 200]]);
  const [c] = detectCorners(junction, cumulative(junction));
  assert.equal(c.grade, 'sq');
  assert.equal(c.dir, 'R');
});

test('detects tightening and opening corners', () => {
  const tight = makeRoute([['s', 150], ['a', 120, 40], ['a', 35, 60], ['s', 150]]);
  assert.ok(detectCorners(tight, cumulative(tight))[0].mods.includes('tightens'));
  const open = makeRoute([['s', 150], ['a', 35, -60], ['a', 120, -40], ['s', 150]]);
  assert.ok(detectCorners(open, cumulative(open))[0].mods.includes('opens'));
});

test('buildNotes: links, gaps, roundabouts, stops and finish', () => {
  const coords = makeRoute([['s', 150], ['a', 60, 70], ['s', 10], ['a', 60, -70], ['s', 400], ['a', 15, 300], ['s', 200]]);
  const cum = cumulative(coords);
  const total = cum[cum.length - 1];
  const rbStart = 150 + 2 * (70 * Math.PI / 180) * 60 + 10 + 400;
  const notes = withGaps(buildNotes({
    coords, cum,
    steps: [{ d: rbStart, length: 80, type: 'roundabout', modifier: 'right', exit: 3 }],
    stops: [{ d: 500, label: 'Serwis' }],
  }));
  const corners = notes.filter((n) => n.kind === 'corner');
  assert.equal(corners.length, 2, 'roundabout geometry is not reported as corners');
  assert.equal(corners[1].link, true);
  assert.equal(gapLabel(notes[0].gap), '150');
  assert.ok(notes.some((n) => n.tags.includes('roundabout') && n.exit === 3));
  assert.ok(notes.some((n) => n.tags.includes('stop') && n.text === 'Serwis'));
  assert.ok(notes[notes.length - 1].tags.includes('finish'));
  assert.ok(Math.abs(notes[notes.length - 1].d - total) < 1);
  for (let i = 1; i < notes.length; i++) assert.ok(notes[i].d >= notes[i - 1].d);
});

test('callState walks through the notes', () => {
  const notes = [
    { kind: 'corner', d: 100, end: 160 },
    { kind: 'corner', d: 170, end: 200 },
    { kind: 'info', d: 500, end: 500 },
  ];
  assert.deepEqual(callState(notes, 0), { index: 0, distTo: 100 });
  assert.equal(callState(notes, 119).index, 0);
  assert.equal(callState(notes, 125).index, 1);
  assert.equal(callState(notes, 300).index, 2);
  assert.equal(callState(notes, 520), null);
});

test('manual edits survive a route recalculation', () => {
  const coords = makeRoute([['s', 200], ['a', 60, 80], ['s', 300]]);
  const cum = cumulative(coords);
  const auto = buildNotes({ coords, cum });
  const edited = auto.map((n) => (n.kind === 'corner' ? { ...n, grade: '2', auto: false } : n));
  const extraAt = pointAt(coords, cum, 450);
  edited.push({ id: 'x', kind: 'info', d: 450, end: 450, lat: extraAt[0], lng: extraAt[1], tags: ['jump'], mods: [], text: '', auto: false });
  const far = { id: 'y', kind: 'info', d: 10, end: 10, lat: 51, lng: 19, tags: ['caution'], mods: [], text: '', auto: false };

  const merged = mergeManual(buildNotes({ coords, cum }), [...edited, far], coords, cum);
  const corners = merged.filter((n) => n.kind === 'corner');
  assert.equal(corners.length, 1);
  assert.equal(corners[0].grade, '2');
  assert.ok(merged.some((n) => n.id === 'x'));
  assert.ok(!merged.some((n) => n.id === 'y'), 'notes far from the new route are dropped');
  assert.equal(merged.filter((n) => n.tags.includes('finish')).length, 1);
});

test('road features: only those on the route, attached to corners', () => {
  const coords = makeRoute([['s', 200], ['a', 60, 80], ['s', 300]]);
  const cum = cumulative(coords);
  const on = (d) => { const p = pointAt(coords, cum, d); return { lat: p[0], lon: p[1] }; };
  const crossing = on(100);
  const features = matchFeatures([
    { type: 'way', tags: { bridge: 'yes' }, geometry: [on(215), on(235)] },
    { type: 'way', tags: { bridge: 'yes' }, geometry: [{ lat: crossing.lat, lon: crossing.lon - 0.0004 }, { lat: crossing.lat, lon: crossing.lon + 0.0004 }] },
    { type: 'node', tags: { railway: 'level_crossing' }, ...on(420) },
  ], coords, cum);
  assert.deepEqual(features.map((f) => f.tag), ['bridge', 'rail']);
  const notes = applyFeatures(buildNotes({ coords, cum }), features, coords, cum);
  assert.ok(notes.find((n) => n.kind === 'corner').tags.includes('bridge'));
  assert.ok(notes.some((n) => n.kind === 'info' && n.tags.includes('rail')));
});

test('parseCoords: coordinates and map links, but not addresses', () => {
  assert.deepEqual(parseCoords('49.2992, 19.9496').lat, 49.2992);
  assert.equal(parseCoords('49.2992 19.9496').lng, 19.9496);
  assert.equal(parseCoords('Marszałkowska 10, 00-950 Warszawa'), null);
  assert.equal(parseCoords('https://www.google.com/maps/place/X/@49.1,19.1,15z/data=!3d49.2992!4d19.9496').lat, 49.2992);
  assert.equal(parseCoords('https://www.google.com/maps/@49.1,19.2,15z').lng, 19.2);
  assert.equal(parseCoords('https://maps.google.com/?q=49.3,19.9').lat, 49.3);
  assert.equal(parseCoords('120, 500'), null);
});

test('every note renders to icons', () => {
  const svg = specToSvg(arrowSpec('hp', 'L'), 26);
  assert.ok(svg.startsWith('<svg') && !svg.includes('NaN'));
  assert.equal(noteSpecs({ kind: 'corner', grade: '3', dir: 'R', tags: ['bridge'], mods: ['tightens'] }).length, 3);
  assert.equal(noteSpecs({ kind: 'info', tags: [], mods: [] }).length, 1);
});
