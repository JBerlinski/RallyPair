// Best-effort lookup of road features along the route (bridges, tunnels, level crossings)
// from OpenStreetMap. Purely an enhancement: any failure resolves to an empty list.

import { snapToRoute } from './geo.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const MAX_BBOX_DEG2 = 0.3;

// Turns raw Overpass elements into [{ tag, d }] for features that lie ON the route.
export function matchFeatures(elements, coords, cum) {
  const found = [];
  for (const el of elements || []) {
    if (el.type === 'node' && el.tags?.railway === 'level_crossing') {
      const s = snapToRoute(coords, cum, [el.lat, el.lon]);
      if (s.off <= 10) found.push({ tag: 'rail', d: s.d });
    } else if (el.type === 'way' && Array.isArray(el.geometry)) {
      const tag = el.tags?.tunnel && el.tags.tunnel !== 'no' ? 'tunnel' : 'bridge';
      // A road crossing ours touches the route at one point at most; ours shares ≥2 vertices.
      const hits = el.geometry
        .map((g) => snapToRoute(coords, cum, [g.lat, g.lon]))
        .filter((s) => s.off <= 8);
      if (hits.length >= 2) found.push({ tag, d: Math.min(...hits.map((h) => h.d)) });
    }
  }
  found.sort((a, b) => a.d - b.d);
  return found.filter((f, i) => !found.slice(0, i).some((g) => g.tag === f.tag && f.d - g.d < 40));
}

export async function fetchRoadFeatures(coords, cum) {
  let s = 90, w = 180, n = -90, e = -180;
  for (const [lat, lng] of coords) {
    if (lat < s) s = lat;
    if (lat > n) n = lat;
    if (lng < w) w = lng;
    if (lng > e) e = lng;
  }
  if ((n - s) * (e - w) > MAX_BBOX_DEG2) return [];
  const bbox = `${s - 0.0005},${w - 0.0005},${n + 0.0005},${e + 0.0005}`;
  const query = `[out:json][timeout:12];(`
    + `way[highway][bridge][bridge!=no](${bbox});`
    + `way[highway][tunnel][tunnel!=no][tunnel!=culvert](${bbox});`
    + `node[railway=level_crossing](${bbox});`
    + `);out geom;`;

  for (const url of ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 14000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: ctrl.signal,
      });
      if (!res.ok) continue;
      const data = await res.json();
      return matchFeatures(data.elements, coords, cum);
    } catch {
      // try the next mirror
    } finally {
      clearTimeout(timer);
    }
  }
  return [];
}
