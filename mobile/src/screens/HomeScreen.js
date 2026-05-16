import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, Platform, Linking } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { loadSession, clearSession } from '../utils/sessionStorage';

const EXPO_PROJECT_ID = '7921256e-7439-4a4e-b7bf-1f232d985d21';

function useLatestApkUrl() {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    fetch(`https://api.expo.dev/v2/projects/${EXPO_PROJECT_ID}/builds?platform=android&limit=1`)
      .then((r) => r.json())
      .then((data) => {
        const apkUrl = data?.data?.[0]?.artifacts?.applicationArchiveUrl;
        if (apkUrl) setUrl(apkUrl);
      })
      .catch(() => {});
  }, []);

  return url;
}

export default function HomeScreen({ navigation }) {
  const [session, setSession] = useState(null);
  const apkUrl = useLatestApkUrl();

  useEffect(() => {
    loadSession().then(setSession);
  }, []);

  const handleResume = () => {
    if (session.role === 'navigator') {
      navigation.navigate('Navigator', { resumeRoomCode: session.roomCode });
    } else {
      navigation.navigate('Driver', { resumeCode: session.roomCode });
    }
  };

  const handleDismissResume = async () => {
    await clearSession();
    setSession(null);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <Text style={styles.title}>RallyPair</Text>
      <Text style={styles.subtitle}>Wybierz swój tryb</Text>

      {session && (
        <View style={styles.resumeCard}>
          <View style={styles.resumeInfo}>
            <Text style={styles.resumeLabel}>Poprzednia sesja</Text>
            <Text style={styles.resumeRole}>
              {session.role === 'navigator' ? '🗺️ Nawigator' : '🚗 Kierowca'} · {session.roomCode}
            </Text>
          </View>
          <TouchableOpacity style={styles.resumeBtn} onPress={handleResume}>
            <Text style={styles.resumeBtnText}>Wznów</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dismissBtn} onPress={handleDismissResume}>
            <Text style={styles.dismissBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity
        style={[styles.btn, styles.btnNavigator]}
        onPress={() => navigation.navigate('Navigator')}
      >
        <Text style={styles.btnIcon}>🗺️</Text>
        <Text style={styles.btnLabel}>Nawigator</Text>
        <Text style={styles.btnHint}>Generujesz kod i wyznaczasz trasę</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.btn, styles.btnDriver]}
        onPress={() => navigation.navigate('Driver')}
      >
        <Text style={styles.btnIcon}>🚗</Text>
        <Text style={styles.btnLabel}>Kierowca</Text>
        <Text style={styles.btnHint}>Wpisujesz kod i widzisz mapę</Text>
      </TouchableOpacity>

      {Platform.OS === 'web' && apkUrl && (
        <TouchableOpacity
          style={styles.apkBtn}
          onPress={() => Linking.openURL(apkUrl)}
          activeOpacity={0.85}
        >
          <Svg width={22} height={22} viewBox="0 0 24 24" style={{ marginRight: 10 }}>
            <Path
              d="M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V8H6v10zM3.5 8C2.67 8 2 8.67 2 9.5v7c0 .83.67 1.5 1.5 1.5S5 17.33 5 16.5v-7C5 8.67 4.33 8 3.5 8zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-5.84l1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48A5.84 5.84 0 0 0 12 1.5c-.96 0-1.86.23-2.66.63L7.85.65c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71l1.31 1.31A5.977 5.977 0 0 0 6 7h12a5.96 5.96 0 0 0-2.47-4.84zM10 5H9V4h1v1zm5 0h-1V4h1v1z"
              fill="#a3e635"
            />
          </Svg>
          <Text style={styles.apkLabel}>Pobierz aplikację na Android</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#0f172a',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  title: { fontSize: 42, fontWeight: '800', color: '#f1f5f9', letterSpacing: 1, marginBottom: 6 },
  subtitle: { fontSize: 16, color: '#94a3b8', marginBottom: 24 },

  resumeCard: {
    width: '100%', flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1e293b', borderRadius: 12,
    padding: 14, marginBottom: 24,
    borderLeftWidth: 3, borderLeftColor: '#3b82f6',
  },
  resumeInfo: { flex: 1 },
  resumeLabel: { color: '#64748b', fontSize: 11, marginBottom: 2 },
  resumeRole: { color: '#f1f5f9', fontSize: 14, fontWeight: '600' },
  resumeBtn: {
    backgroundColor: '#2563eb', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 8, marginLeft: 10,
  },
  resumeBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  dismissBtn: { padding: 8, marginLeft: 4 },
  dismissBtnText: { color: '#475569', fontSize: 14 },

  btn: { width: '100%', borderRadius: 16, padding: 24, marginBottom: 16, alignItems: 'center' },
  btnNavigator: { backgroundColor: '#1e40af' },
  btnDriver: { backgroundColor: '#065f46' },
  btnIcon: { fontSize: 36, marginBottom: 8 },
  btnLabel: { fontSize: 22, fontWeight: '700', color: '#f1f5f9', marginBottom: 4 },
  btnHint: { fontSize: 13, color: '#cbd5e1', textAlign: 'center' },

  apkBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 8, width: '100%',
    backgroundColor: '#14532d',
    borderWidth: 1, borderColor: '#4ade80',
    borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20,
    shadowColor: '#4ade80', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2, shadowRadius: 6, elevation: 4,
  },
  apkLabel: { fontSize: 15, fontWeight: '700', color: '#a3e635' },
});
