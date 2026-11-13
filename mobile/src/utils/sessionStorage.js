import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_KEY = 'rallypair_session';
const DRAFT_KEY = 'rallypair_draft';
const SESSION_TTL = 60 * 60 * 1000; // matches the server's room lifetime

// Session: which room this phone was in, so it can be resumed after a restart.
export async function saveSession(session) {
  try {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, savedAt: Date.now() }));
  } catch {}
}

export async function loadSession() {
  try {
    const json = await AsyncStorage.getItem(SESSION_KEY);
    if (!json) return null;
    const s = JSON.parse(json);
    if (Date.now() - s.savedAt > SESSION_TTL) {
      await clearSession();
      return null;
    }
    return s; // { role, roomCode, token?, savedAt }
  } catch {
    return null;
  }
}

export async function clearSession() {
  try { await AsyncStorage.removeItem(SESSION_KEY); } catch {}
}

// Draft: the navigator's waypoints and roadbook. Kept independently of the room so the
// work survives closing the app or the room expiring.
export async function saveDraft(draft) {
  try {
    if (draft) await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else await AsyncStorage.removeItem(DRAFT_KEY);
  } catch {}
}

export async function loadDraft() {
  try {
    const json = await AsyncStorage.getItem(DRAFT_KEY);
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}
