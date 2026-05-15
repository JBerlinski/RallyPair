import { OSRM_URL } from '../config';

// waypoints: [{ lat, lng }, ...]
export async function fetchRoute(waypoints) {
  if (waypoints.length < 2) {
    console.warn('[OSRM] Need ≥2 waypoints, got:', waypoints.length);
    return null;
  }

  const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(';');
  const url = `${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;
  console.log('[OSRM] Requesting:', url);

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.code !== 'Ok' || !data.routes.length) {
      console.warn('[OSRM] Bad response — code:', data.code, 'message:', data.message);
      return null;
    }

    const route = data.routes[0];
    const coordinates = route.geometry.coordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));

    const steps = route.legs.flatMap((leg) =>
      leg.steps.map((step) => ({
        instruction: step.maneuver.type,
        modifier: step.maneuver.modifier,
        name: step.name,
        ref: step.ref || null,
        distance: step.distance,
        duration: step.duration,
        location: {
          latitude: step.maneuver.location[1],
          longitude: step.maneuver.location[0],
        },
      }))
    );

    console.log('[OSRM] Route OK —', Math.round(route.distance / 1000), 'km,', steps.length, 'steps');
    return { coordinates, steps, distance: route.distance, duration: route.duration };
  } catch (err) {
    console.warn('[OSRM] Fetch error:', err.message);
    return null;
  }
}
