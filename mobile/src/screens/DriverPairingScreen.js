import React, { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, StatusBar,
} from 'react-native';
import { io } from 'socket.io-client';
import { BACKEND_URL } from '../config';

export default function DriverPairingScreen({ navigation }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const socketRef = useRef(null);

  const handleJoin = () => {
    const trimmed = code.trim();
    if (trimmed.length !== 6 || !/^\d{6}$/.test(trimmed)) {
      Alert.alert('Błędny kod', 'Kod pokoju to 6 cyfr.');
      return;
    }
    setLoading(true);

    const socket = io(BACKEND_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join_room', { roomCode: trimmed }, (res) => {
        if (res.ok) {
          setLoading(false);
          navigation.replace('DriverMap', { roomCode: trimmed, socket });
        } else {
          socket.disconnect();
          setLoading(false);
          Alert.alert('Błąd', res.error || 'Nie można dołączyć do pokoju.');
        }
      });
    });

    socket.on('connect_error', () => {
      setLoading(false);
      socket.disconnect();
      Alert.alert('Błąd połączenia', 'Nie można połączyć z serwerem.');
    });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <Text style={styles.title}>Dołącz jako kierowca</Text>
      <Text style={styles.subtitle}>Wpisz 6-cyfrowy kod od nawigatora</Text>

      <TextInput
        style={styles.codeInput}
        value={code}
        onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="numeric"
        maxLength={6}
        placeholder="000000"
        placeholderTextColor="#334155"
        textAlign="center"
      />

      <TouchableOpacity
        style={[styles.btn, (loading || code.length !== 6) && styles.btnDisabled]}
        onPress={handleJoin}
        disabled={loading || code.length !== 6}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.btnText}>Dołącz</Text>
        }
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#0f172a',
    alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  title: { color: '#f1f5f9', fontSize: 28, fontWeight: '700', marginBottom: 8 },
  subtitle: { color: '#64748b', fontSize: 14, marginBottom: 40, textAlign: 'center' },
  codeInput: {
    backgroundColor: '#1e293b', color: '#f1f5f9',
    fontSize: 40, fontWeight: '800', letterSpacing: 12,
    borderRadius: 14, width: '100%', paddingVertical: 20,
    marginBottom: 24,
  },
  btn: {
    backgroundColor: '#059669', borderRadius: 12,
    paddingVertical: 16, width: '100%', alignItems: 'center',
  },
  btnDisabled: { backgroundColor: '#1e293b' },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
