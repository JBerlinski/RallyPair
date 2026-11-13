import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'rallypair_settings';

// `filter` is a CSS filter applied to the tiles: the dark style is the standard
// OpenStreetMap map inverted, so it needs no API key and has full zoom range.
export const TILE_PROVIDERS = [
  {
    id: 'dark', label: 'Ciemna',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    filter: 'invert(1) hue-rotate(180deg) brightness(0.8) contrast(0.95) saturate(0.3)',
  },
  {
    id: 'darkgray', label: 'Ciemna uproszczona',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    maxNativeZoom: 16,
  },
  { id: 'osm',  label: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
  { id: 'topo', label: 'Topograficzna', url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', maxNativeZoom: 17 },
];

const DEFAULTS = {
  tileProvider: 'dark',
  headingUp: true,     // driver: map rotates with the direction of travel
  tilt: false,         // driver: perspective view
  keepAwake: true,     // keep the screen on while a session is open
  driverMarkers: true, // driver: note icons on the map
};

let cache = null;

export async function loadSettings() {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    cache = { ...DEFAULTS };
  }
  if (!TILE_PROVIDERS.some((p) => p.id === cache.tileProvider)) cache.tileProvider = DEFAULTS.tileProvider;
  return cache;
}

export async function saveSettings(patch) {
  cache = { ...(cache ?? DEFAULTS), ...patch };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(cache));
  } catch {}
}

export function getCachedSettings() {
  return cache ?? { ...DEFAULTS };
}

// Arguments for the map's setTiles(url, options).
export function tileArgs(settings) {
  const p = TILE_PROVIDERS.find((t) => t.id === settings.tileProvider) || TILE_PROVIDERS[0];
  return [p.url, { filter: p.filter || '', maxNativeZoom: p.maxNativeZoom || 19 }];
}
