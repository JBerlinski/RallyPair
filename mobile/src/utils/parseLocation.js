// Turns what the navigator typed into map places: [{ lat, lng, label }].
// Understands plain coordinates, Google Maps links and free-text addresses.

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';
// The whole input must be a coordinate pair — "Długa 10, 00-950" is an address, not coords.
const COORD_RE = new RegExp(`^\\s*${NUM}\\s*[,;\\s]\\s*${NUM}\\s*$`);
const URL_PATTERNS = [
  new RegExp(`!3d${NUM}!4d${NUM}`),          // exact pin in a Google Maps place link
  new RegExp(`[?&](?:q|query|ll|destination)=${NUM}(?:,|%2C)${NUM}`),
  new RegExp(`@${NUM},${NUM}`),              // map viewport centre
];

const valid = (lat, lng) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
const coordLabel = (lat, lng) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

export function parseCoords(text) {
  const clean = text.trim();
  const patterns = /^https?:\/\//i.test(clean) ? URL_PATTERNS : [COORD_RE];
  for (const re of patterns) {
    const m = clean.match(re);
    if (!m) continue;
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (valid(lat, lng)) return { lat, lng, label: coordLabel(lat, lng) };
  }
  return null;
}

// "Krupówki, Zakopane, powiat tatrzański, …" → "Krupówki, Zakopane"
function shortName(displayName) {
  return displayName.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3).join(', ');
}

export async function searchPlaces(input, { signal } = {}) {
  const text = input.trim();
  if (!text) return [];
  const direct = parseCoords(text);
  if (direct) return [direct];
  if (/^https?:\/\//i.test(text)) return []; // a link we cannot read (e.g. shortened)

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=pl&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, { signal });
  const data = await res.json();
  const seen = new Set();
  return (Array.isArray(data) ? data : [])
    .map((r) => ({ lat: parseFloat(r.lat), lng: parseFloat(r.lon), label: shortName(r.display_name) }))
    .filter((r) => !seen.has(r.label) && seen.add(r.label));
}

export async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&lat=${lat}&lon=${lng}&accept-language=pl`;
    const res = await fetch(url);
    const data = await res.json();
    return data.display_name ? shortName(data.display_name) : coordLabel(lat, lng);
  } catch {
    return coordLabel(lat, lng);
  }
}
