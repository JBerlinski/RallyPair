import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, StatusBar,
} from 'react-native';
import { io } from 'socket.io-client';
import { BACKEND_URL } from '../config';
import { socketStore } from '../socketStore';
import { parseLocation } from '../utils/parseLocation';
import { saveSession, clearSession } from '../utils/sessionStorage';
import { fetchRoute } from '../utils/osrm';
import { getCachedSettings, loadSettings } from '../utils/settings';
import LeafletMap from '../components/LeafletMap';

const STATUS = { CONNECTING: 'connecting', WAITING: 'waiting', PAIRED: 'paired' };

export default function NavigatorScreen({ navigation, route: navRoute }) {
  // Ensure settings cache is warm
  useEffect(() => { loadSettings(); }, []);
  const resumeRoomCode = navRoute.params?.resumeRoomCode ?? null;

  const socketRef = useRef(null);
  const mapRef = useRef(null);
  const roomCodeRef = useRef(resumeRoomCode ?? '');
  const needsRejoinRef = useRef(false);
  const firstDriverPos = useRef(false);

  const [status, setStatus] = useState(STATUS.CONNECTING);
  const [roomCode, setRoomCode] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [waypoints, setWaypoints] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [sending, setSending] = useState(false);
  const [driverConnected, setDriverConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const applyRoomCode = useCallback((code, hasDriver = false) => {
    roomCodeRef.current = code;
    setRoomCode(code);
    setDriverConnected(hasDriver);
    setStatus(hasDriver ? STATUS.PAIRED : STATUS.WAITING);
    saveSession('navigator', code);
  }, []);

  const doCreateRoom = useCallback((socket) => {
    socket.emit('create_room', (res) => {
      if (res.ok) {
        applyRoomCode(res.roomCode, false);
      } else {
        Alert.alert('Błąd', 'Nie udało się utworzyć pokoju');
        navigation.goBack();
      }
    });
  }, [applyRoomCode, navigation]);

  const doRejoinOrCreate = useCallback((socket, code) => {
    socket.emit('rejoin_navigator', { roomCode: code }, (res) => {
      if (res.ok) {
        applyRoomCode(res.roomCode, res.hasDriver);
        setReconnecting(false);
      } else {
        // Room expired — create fresh room
        doCreateRoom(socket);
        setReconnecting(false);
      }
    });
  }, [applyRoomCode, doCreateRoom]);

  useEffect(() => {
    const socket = io(BACKEND_URL, {
      transports: ['websocket'],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });
    socketRef.current = socket;
    socketStore.setNavigator(socket);

    socket.on('connect', () => {
      if (needsRejoinRef.current && roomCodeRef.current) {
        // Reconnected after drop — try to rejoin
        needsRejoinRef.current = false;
        setReconnecting(true);
        doRejoinOrCreate(socket, roomCodeRef.current);
      } else if (!roomCodeRef.current) {
        // First connect — no saved session, create new room
        doCreateRoom(socket);
      } else {
        // First connect with resume code
        doRejoinOrCreate(socket, roomCodeRef.current);
      }
    });

    socket.on('disconnect', () => {
      needsRejoinRef.current = true;
      setReconnecting(true);
    });

    socket.on('driver_joined', () => {
      setDriverConnected(true);
      setStatus(STATUS.PAIRED);
      firstDriverPos.current = false;
    });

    socket.on('driver_disconnected', () => {
      setDriverConnected(false);
      firstDriverPos.current = false;
      setStatus(STATUS.WAITING);
    });

    socket.on('position_update', (payload) => {
      if (payload?.lat == null || payload?.lng == null) return;
      mapRef.current?.updateDriver(payload.lat, payload.lng);
      if (!firstDriverPos.current) {
        mapRef.current?.panTo(payload.lat, payload.lng, 14);
        firstDriverPos.current = true;
      }
    });

    socket.on('connect_error', () => {
      // socket.io will keep retrying — no alert needed
    });

    return () => {
      socket.disconnect();
      socketStore.clearNavigator();
      clearSession();
    };
  }, [doCreateRoom, doRejoinOrCreate]);

  const handleAddWaypoint = useCallback(async () => {
    if (!locationInput.trim()) return;
    setParsing(true);
    try {
      const coords = await parseLocation(locationInput);
      if (!coords) {
        Alert.alert('Nie znaleziono', 'Nie udało się rozpoznać lokalizacji.');
        return;
      }
      const label = coords.displayName || locationInput.trim();
      const newWp = { ...coords, label };
      setWaypoints((prev) => {
        const updated = [...prev, newWp];
        mapRef.current?.updateWaypoints(updated);
        return updated;
      });
      setLocationInput('');
    } catch {
      Alert.alert('Błąd', 'Wystąpił błąd podczas parsowania lokalizacji.');
    } finally {
      setParsing(false);
    }
  }, [locationInput]);

  const handleRemoveWaypoint = (index) => {
    setWaypoints((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      mapRef.current?.updateWaypoints(updated);
      return updated;
    });
  };

  const handleSendRoute = useCallback(async () => {
    if (waypoints.length === 0) {
      Alert.alert('Brak punktów', 'Dodaj co najmniej jeden punkt docelowy.');
      return;
    }
    setSending(true);
    socketRef.current?.emit('send_route', { waypoints });

    // Show route line on navigator map if setting enabled
    const cfg = getCachedSettings();
    if (cfg.showRoute && waypoints.length >= 2) {
      const result = await fetchRoute(waypoints);
      if (result) mapRef.current?.updateRoute(result.coordinates);
    }

    setTimeout(() => setSending(false), 800);
  }, [waypoints]);

  if (status === STATUS.CONNECTING && !reconnecting) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.statusText}>Łączenie z serwerem…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="light-content" />

      <View style={styles.upper}>
        {reconnecting && (
          <View style={styles.reconnectBanner}>
            <ActivityIndicator size="small" color="#f59e0b" style={{ marginRight: 8 }} />
            <Text style={styles.reconnectText}>Przywracanie połączenia…</Text>
          </View>
        )}

        <View style={styles.codeBox}>
          <Text style={styles.codeLabel}>Kod pokoju</Text>
          <Text style={styles.codeText}>{roomCode || '——'}</Text>
          <Text style={styles.codeHint}>
            {reconnecting
              ? 'Łączenie…'
              : status === STATUS.WAITING
                ? 'Czekam na kierowcę…'
                : '✅ Kierowca połączony'}
          </Text>
        </View>

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Adres, koordynaty lub link Google Maps"
            placeholderTextColor="#64748b"
            value={locationInput}
            onChangeText={setLocationInput}
            onSubmitEditing={handleAddWaypoint}
            returnKeyType="done"
            multiline={false}
          />
          <TouchableOpacity style={styles.addBtn} onPress={handleAddWaypoint} disabled={parsing}>
            {parsing
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.addBtnText}>+</Text>}
          </TouchableOpacity>
        </View>

        <FlatList
          data={waypoints}
          keyExtractor={(_, i) => i.toString()}
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item, index }) => (
            <View style={styles.waypointRow}>
              <Text style={styles.waypointIndex}>{index + 1}</Text>
              <Text style={styles.waypointLabel} numberOfLines={2}>{item.label}</Text>
              <TouchableOpacity onPress={() => handleRemoveWaypoint(index)} style={styles.removeBtn}>
                <Text style={styles.removeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>Brak punktów — dodaj cel lub przystanek</Text>
          }
        />

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.sendBtn, (!driverConnected || waypoints.length === 0) && styles.sendBtnDisabled]}
            onPress={handleSendRoute}
            disabled={!driverConnected || waypoints.length === 0 || sending}
          >
            {sending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.sendBtnText}>
                  {driverConnected ? 'Wyślij trasę do kierowcy' : 'Czekam na kierowcę…'}
                </Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.settingsBtn} onPress={() => navigation.navigate('Settings')}>
            <Text style={styles.settingsBtnText}>⚙</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.mapContainer}>
        {!driverConnected && (
          <View style={styles.mapOverlay} pointerEvents="none">
            <Text style={styles.mapOverlayText}>Mapa aktywna po dołączeniu kierowcy</Text>
          </View>
        )}
        <LeafletMap ref={mapRef} style={styles.map} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  centered: { flex: 1, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center' },
  statusText: { color: '#94a3b8', marginTop: 12, fontSize: 15 },

  reconnectBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#78350f', borderRadius: 8,
    padding: 10, marginBottom: 10,
  },
  reconnectText: { color: '#fef3c7', fontSize: 13 },

  upper: { flex: 1, padding: 16 },

  codeBox: {
    backgroundColor: '#1e293b', borderRadius: 12, padding: 12,
    alignItems: 'center', marginBottom: 12, marginTop: 4,
  },
  codeLabel: { color: '#94a3b8', fontSize: 11, marginBottom: 2 },
  codeText: { color: '#f1f5f9', fontSize: 40, fontWeight: '800', letterSpacing: 8 },
  codeHint: { color: '#64748b', fontSize: 12, marginTop: 4 },

  inputRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  input: {
    flex: 1, backgroundColor: '#1e293b', borderRadius: 10,
    color: '#f1f5f9', paddingHorizontal: 14, paddingVertical: 11, fontSize: 14,
  },
  addBtn: {
    backgroundColor: '#2563eb', borderRadius: 10,
    width: 48, alignItems: 'center', justifyContent: 'center',
  },
  addBtnText: { color: '#fff', fontSize: 24, fontWeight: '700' },

  list: { flex: 1 },
  waypointRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1e293b', borderRadius: 10,
    padding: 10, marginBottom: 6,
  },
  waypointIndex: { color: '#3b82f6', fontWeight: '700', fontSize: 15, width: 22, textAlign: 'center', marginRight: 8 },
  waypointLabel: { flex: 1, color: '#e2e8f0', fontSize: 13 },
  removeBtn: { padding: 6 },
  removeBtnText: { color: '#ef4444', fontSize: 15 },
  emptyText: { color: '#334155', textAlign: 'center', marginTop: 16, fontSize: 13 },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  sendBtn: { flex: 1, backgroundColor: '#059669', borderRadius: 12, padding: 14, alignItems: 'center' },
  sendBtnDisabled: { backgroundColor: '#1e293b' },
  sendBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  settingsBtn: {
    width: 50, backgroundColor: '#1e293b', borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  settingsBtnText: { fontSize: 20, color: '#94a3b8' },

  mapContainer: { height: 220 },
  map: { flex: 1 },
  mapOverlay: {
    ...StyleSheet.absoluteFillObject, zIndex: 10,
    backgroundColor: 'rgba(15,23,42,0.75)',
    alignItems: 'center', justifyContent: 'center',
  },
  mapOverlayText: { color: '#475569', fontSize: 13 },
});
