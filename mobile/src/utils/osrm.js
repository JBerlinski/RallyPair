import { OSRM_URL } from '../config.js';

const round5 = (n) => Math.round(n * 1e5) / 1e5;

// waypoints: [{ lat, lng }, ...] (at least two).
// Resolves to { coords: [[lat, lng]…], steps, stops, distance, duration } or throws.
//   steps — maneuvers with their distance along the route
//   stops — distance along the route of every intermediate waypoint
export async function fetchRoute(waypoints, { signal } = {}) {
  if (waypoints.length < 2) throw new Error('Potrzebne są co najmniej dwa punkty');

  const path = waypoints.map((w) => `${w.lng},${w.lat}`).join(';');
  const url = `${OSRM_URL}/route/v1/driving/${path}?overview=full&geometries=geojson&steps=true&continue_straight=false`;

  // The public OSRM server occasionally drops or rate-limits a request — try twice.
  let data = null;
  for (let attempt = 0; attempt < 2 && !data; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      const res = await fetch(url, { signal });
      data = await res.json();
    } catch (err) {
      if (signal?.aborted) throw err;
    }
  }
  if (!data || data.code !== 'Ok' || !data.routes?.length) {
    throw new Error(data?.code === 'NoRoute' ? 'Nie da się wyznaczyć trasy między tymi punktami' : 'Serwer tras nie odpowiedział');
  }

  const route = data.routes[0];
  const coords = [];
  for (const [lng, lat] of route.geometry.coordinates) {
    const p = [round5(lat), round5(lng)];
    const last = coords[coords.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) coords.push(p);
  }

  const steps = [];
  const stops = [];
  let d = 0;
  route.legs.forEach((leg, legIndex) => {
    if (legIndex > 0) stops.push({ d, index: legIndex });
    for (const step of leg.steps) {
      steps.push({
        d,
        length: step.distance,
        type: step.maneuver.type,
        modifier: step.maneuver.modifier || null,
        exit: step.maneuver.exit || null,
      });
      d += step.distance;
    }
  });

  return { coords, steps, stops, distance: route.distance, duration: route.duration };
}
