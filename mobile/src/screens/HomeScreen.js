import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { loadSession, clearSession } from '../utils/sessionStorage';

export default function HomeScreen({ navigation }) {
  const [session, setSession] = useState(null);

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
});
