// A roadbook is everything both phones need to show the same stage:
//   { id, waypoints: [{lat,lng,label}], coords: [[lat,lng]…], notes: [...], distance }
// It is built on the navigator's phone and sent to the driver as-is.

import { cumulative, sliceRoute } from './geo.js';
import { buildNotes, mergeManual, noteId } from './pacenotes.js';
import { noteSpecs, noteColor, specToSvg } from './paceIcons.js';
import { fetchRoute } from './osrm.js';

export async function buildRoadbook(waypoints, previous, options) {
  const route = await fetchRoute(waypoints, options);
  const cum = cumulative(route.coords);
  const stops = route.stops.map((s) => ({ d: s.d, label: waypoints[s.index]?.label || '' }));
  const auto = buildNotes({ coords: route.coords, cum, steps: route.steps, stops });
  return {
    id: noteId(),
    waypoints: waypoints.map(({ lat, lng, label }) => ({ lat, lng, label })),
    coords: route.coords,
    notes: mergeManual(auto, previous?.notes, route.coords, cum),
    distance: cum[cum.length - 1],
  };
}

// What the Leaflet page needs to draw the notes: coloured corner sections + icon markers.
export function mapNotesPayload(roadbook, cum, { markers = true } = {}) {
  const segs = [];
  const marks = [];
  for (const n of roadbook.notes) {
    if (n.kind === 'corner' && n.end > n.d) {
      segs.push({ c: noteColor(n), p: sliceRoute(roadbook.coords, cum, n.d, n.end) });
    }
    if (markers) marks.push({ id: n.id, lat: n.lat, lng: n.lng, svg: specToSvg(noteSpecs(n)[0], 26) });
  }
  return [segs, marks];
}

export function countCorners(notes) {
  return notes.reduce((c, n) => c + (n.kind === 'corner' ? 1 : 0), 0);
}
