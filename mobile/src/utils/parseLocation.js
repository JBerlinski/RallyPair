// Parses user input into { lat, lng } or returns null

const COORD_RE = /(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)/;

// Google Maps short URL: maps.app.goo.gl or goo.gl/maps — needs resolve (not done here)
// Google Maps full URL: @lat,lng or q=lat,lng or ll=lat,lng
const GMAPS_AT_RE = /@(-?\d+\.?\d*),(-?\d+\.?\d*)/;
const GMAPS_Q_RE = /[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/;
const GMAPS_LL_RE = /[?&]ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/;

function tryCoords(text) {
  const clean = text.trim();

  let m = clean.match(GMAPS_AT_RE) || clean.match(GMAPS_Q_RE) || clean.match(GMAPS_LL_RE);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

  m = clean.match(COORD_RE);
  if (m) {
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng };
    }
  }

  return null;
}

async function geocodeNominatim(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'RallyPair/1.0' },
  });
  const data = await res.json();
  if (data.length === 0) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), displayName: data[0].display_name };
}

export async function parseLocation(input) {
  const text = input.trim();
  if (!text) return null;

  // 1. Try direct coords / URL coords
  const direct = tryCoords(text);
  if (direct) return direct;

  // 2. Geocode as address via Nominatim
  return await geocodeNominatim(text);
}
