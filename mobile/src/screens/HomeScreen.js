import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, Platform, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { loadSession, clearSession } from '../utils/sessionStorage';
import { arrowSpec } from '../utils/paceIcons';
import { Tile } from '../components/PaceTiles';
import Icon from '../components/Icon';
import { C } from '../theme';

const EXPO_PROJECT_ID = '7921256e-7439-4a4e-b7bf-1f232d985d21';
const LOGO = [['3', 'L'], ['hp', 'R'], ['5', 'L'], ['sq', 'R']];

function useLatestApkUrl() {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    fetch(`https://api.expo.dev/v2/projects/${EXPO_PROJECT_ID}/builds?platform=android&limit=1`)
      .then((r) => r.json())
      .then((data) => setUrl(data?.data?.[0]?.artifacts?.applicationArchiveUrl || null))
      .catch(() => {});
  }, []);
  return url;
}

export default function HomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState(null);
  const apkUrl = useLatestApkUrl();

  // Re-check every time we come back here — leaving a session clears it.
  useFocusEffect(useCallback(() => { loadSession().then(setSession); }, []));

  const resume = () => {
    if (session.role === 'navigator') navigation.navigate('Navigator');
    else navigation.navigate('Driver', { resumeCode: session.roomCode });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <StatusBar barStyle="light-content" />

      <View style={styles.hero}>
        <View style={styles.logoRow}>
          {LOGO.map(([g, d]) => <Tile key={g} spec={arrowSpec(g, d)} size={46} />)}
        </View>
        <Text style={styles.title}>RallyPair</Text>
        <Text style={styles.subtitle}>Pilot i kierowca na jednej trasie</Text>
      </View>

      {session && (
        <View style={styles.resume}>
          <View style={styles.flex}>
            <Text style={styles.resumeLabel}>Poprzednia sesja · {session.roomCode}</Text>
            <Text style={styles.resumeRole}>{session.role === 'navigator' ? 'Nawigator' : 'Kierowca'}</Text>
          </View>
          <TouchableOpacity style={styles.resumeBtn} onPress={resume}>
            <Text style={styles.resumeBtnText}>Wznów</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.dismiss}
            onPress={() => clearSession().then(() => setSession(null))}
            accessibilityLabel="Zapomnij poprzednią sesję"
          >
            <Icon name="close" size={18} color={C.faint} />
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('Navigator')} activeOpacity={0.8}>
        <View style={[styles.cardIcon, { backgroundColor: C.accent }]}><Icon name="route" size={28} color={C.accentInk} /></View>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>Nawigator</Text>
          <Text style={styles.cardHint}>Wyznaczasz trasę i poprawiasz notatki</Text>
        </View>
        <Icon name="chevRight" color={C.faint} />
      </TouchableOpacity>

      <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('Driver')} activeOpacity={0.8}>
        <View style={[styles.cardIcon, { backgroundColor: C.text }]}><Icon name="car" size={28} color={C.accentInk} /></View>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>Kierowca</Text>
          <Text style={styles.cardHint}>Wpisujesz kod i widzisz zakręty przed sobą</Text>
        </View>
        <Icon name="chevRight" color={C.faint} />
      </TouchableOpacity>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.link} onPress={() => navigation.navigate('Settings')}>
          <Icon name="settings" size={18} color={C.dim} />
          <Text style={styles.linkText}>Ustawienia</Text>
        </TouchableOpacity>
        {Platform.OS === 'web' && apkUrl && (
          <TouchableOpacity style={styles.link} onPress={() => Linking.openURL(apkUrl)}>
            <Text style={styles.linkText}>Pobierz aplikację na Androida</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 20, justifyContent: 'center' },
  flex: { flex: 1 },
  hero: { alignItems: 'center', marginBottom: 32 },
  logoRow: { flexDirection: 'row', gap: 6, marginBottom: 18 },
  title: { fontSize: 40, fontWeight: '900', color: C.text, letterSpacing: 0.5 },
  subtitle: { fontSize: 15, color: C.dim, marginTop: 4 },

  resume: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.raised, borderRadius: 14,
    paddingLeft: 16, paddingVertical: 10, marginBottom: 14, borderWidth: 1, borderColor: C.accent,
  },
  resumeLabel: { color: C.dim, fontSize: 12 },
  resumeRole: { color: C.text, fontSize: 15, fontWeight: '700', marginTop: 1 },
  resumeBtn: { backgroundColor: C.accent, borderRadius: 10, paddingHorizontal: 16, height: 40, justifyContent: 'center' },
  resumeBtnText: { color: C.accentInk, fontSize: 14, fontWeight: '800' },
  dismiss: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.raised,
    borderRadius: 18, padding: 18, marginBottom: 12,
  },
  cardIcon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 20, fontWeight: '800', color: C.text },
  cardHint: { fontSize: 13, color: C.dim, marginTop: 2 },

  footer: { alignItems: 'center', marginTop: 18, gap: 4 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12 },
  linkText: { color: C.dim, fontSize: 14, fontWeight: '600' },
});
