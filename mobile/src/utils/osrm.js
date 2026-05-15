import { OSRM_URL } from '../config';

// waypoints: [{ lat, lng }, ...]
export async function fetchRoute(waypoints) {
  if (waypoints.length < 2) return null;

  const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(';');
  const url = `${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.code !== 'Ok' || !data.routes.length) return null;

  const route = data.routes[0];
  const coordinates = route.geometry.coordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));

  const steps = route.legs.flatMap((leg) =>
    leg.steps.map((step) => ({
      instruction: step.maneuver.type,
      modifier: step.maneuver.modifier,
      name: step.name,
      distance: step.distance,
      duration: step.duration,
      location: {
        latitude: step.maneuver.location[1],
        longitude: step.maneuver.location[0],
      },
    }))
  );

  return {
    coordinates,
    steps,
    distance: route.distance,
    duration: route.duration,
  };
}
