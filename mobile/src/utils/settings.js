import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'rallypair_settings';

export const TILE_PROVIDERS = [
  { id: 'osm',          label: 'OpenStreetMap',   url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
  { id: 'humanitarian', label: 'Humanitarian',     url: 'https://tile-a.openstreetmap.fr/hot/{z}/{x}/{y}.png' },
  { id: 'topo',         label: 'OpenTopoMap',      url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png' },
  { id: 'dark',         label: 'CartoDB Dark',     url: 'https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png' },
];

const DEFAULTS = {
  tileProvider: 'osm',
  compassRotation: false,
  autoCenter: true,
  showRoute: true,
};

let _cache = null;

export async function loadSettings() {
  if (_cache) return _cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    _cache = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    _cache = { ...DEFAULTS };
  }
  return _cache;
}

export async function saveSettings(patch) {
  _cache = { ...(_cache ?? DEFAULTS), ...patch };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(_cache));
  } catch {}
}

export function getCachedSettings() {
  return _cache ?? { ...DEFAULTS };
}
