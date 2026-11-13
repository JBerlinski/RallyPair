import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { io } from 'socket.io-client';
import { BACKEND_URL } from '../config';
import { socketStore } from '../socketStore';
import { saveSession } from '../utils/sessionStorage';
import { C } from '../theme';

export default function DriverPairingScreen({ navigation, route }) {
  const [code, setCode] = useState(route.params?.resumeCode ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pendingRef = useRef(null);

  // Abandon a half-open connection if the screen is left before pairing completes.
  useEffect(() => () => pendingRef.current?.disconnect(), []);

  const join = useCallback((value) => {
    if (loading || !/^\d{6}$/.test(value)) return;
    setLoading(true);
    setError('');

    const socket = io(BACKEND_URL, { transports: ['websocket'], reconnectionDelay: 1500, reconnectionDelayMax: 6000 });
    pendingRef.current = socket;

    const fail = (message) => {
      socket.disconnect();
      pendingRef.current = null;
      setLoading(false);
      setError(message);
    };

    socket.once('connect', () => {
      socket.emit('join_room', { roomCode: value }, (res) => {
        if (!res?.ok) { fail('Nie ma pokoju o takim kodzie. Sprawdź kod u nawigatora.'); return; }
        pendingRef.current = null;
        socketStore.setDriver(socket);
        saveSession({ role: 'driver', roomCode: value });
        setLoading(false);
        navigation.replace('DriverMap', { roomCode: value });
      });
    });
    socket.once('connect_error', () => fail('Nie można połączyć z serwerem. Sprawdź internet i spróbuj ponownie.'));
  }, [loading, navigation]);

  const onChange = (text) => {
    const digits = text.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    setError('');
    if (digits.length === 6) join(digits); // no need to press the button
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.subtitle}>Wpisz 6-cyfrowy kod, który widzi nawigator</Text>

      <TextInput
        style={styles.codeInput}
        value={code}
        onChangeText={onChange}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={6}
        placeholder="000000"
        placeholderTextColor="#2c313c"
        textAlign="center"
        autoFocus
        editable={!loading}
        accessibilityLabel="Kod pokoju"
      />

      {!!error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity
        style={[styles.btn, (loading || code.length !== 6) && styles.btnDisabled]}
        onPress={() => join(code)}
        disabled={loading || code.length !== 6}
      >
        {loading ? <ActivityIndicator color={C.accentInk} /> : <Text style={styles.btnText}>Dołącz</Text>}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 28 },
  subtitle: { color: C.dim, fontSize: 15, marginBottom: 28, textAlign: 'center' },
  codeInput: {
    backgroundColor: C.raised, color: C.text, fontSize: 40, fontWeight: '800', letterSpacing: 10,
    borderRadius: 16, width: '100%', maxWidth: 420, paddingVertical: 20, marginBottom: 16,
  },
  error: { color: C.red, fontSize: 14, textAlign: 'center', marginBottom: 16 },
  btn: {
    backgroundColor: C.accent, borderRadius: 14, minHeight: 54, width: '100%', maxWidth: 420,
    alignItems: 'center', justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.35 },
  btnText: { color: C.accentInk, fontSize: 17, fontWeight: '800' },
});
