import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'rallypair_session';
const TTL = 30 * 60 * 1000; // 30 minutes

export async function saveSession(role, roomCode) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ role, roomCode, savedAt: Date.now() }));
  } catch {}
}

export async function loadSession() {
  try {
    const json = await AsyncStorage.getItem(KEY);
    if (!json) return null;
    const s = JSON.parse(json);
    if (Date.now() - s.savedAt > TTL) {
      await clearSession();
      return null;
    }
    return s; // { role, roomCode, savedAt }
  } catch {
    return null;
  }
}

export async function clearSession() {
  try { await AsyncStorage.removeItem(KEY); } catch {}
}
