import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert, StatusBar, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { io } from 'socket.io-client';
import * as Location from 'expo-location';
import { BACKEND_URL } from '../config';
import { socketStore } from '../socketStore';
import { parseLocation } from '../utils/parseLocation';
import { saveSession, clearSession } from '../utils/sessionStorage';
import { fetchRoute } from '../utils/osrm';
import { loadSettings, getCachedSettings, TILE_PROVIDERS } from '../utils/settings';
import LeafletMap from '../components/LeafletMap';

const STATUS = { CONNECTING: 'connecting', WAITING: 'waiting', PAIRED: 'paired' };

export default function NavigatorScreen({ navigation, route: navRoute }) {
  const resumeRoomCode = navRoute.params?.resumeRoomCode ?? null;

  const socketRef = useRef(null);
  const mapRef = useRef(null);
  const roomCodeRef = useRef(resumeRoomCode ?? '');
  const needsRejoinRef = useRef(false);
  const firstDriverPos = useRef(false);
  const settingsRef = useRef(getCachedSettings());

  const [status, setStatus] = useState(STATUS.CONNECTING);
  const [roomCode, setRoomCode] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [waypoints, setWaypoints] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [sending, setSending] = useState(false);
  const [driverConnected, setDriverConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  // Apply tile provider whenever screen is focused (picks up settings changes)
  useFocusEffect(useCallback(() => {
    loadSettings().then((s) => {
      settingsRef.current = s;
      const provider = TILE_PROVIDERS.find((p) => p.id === s.tileProvider);
      if (provider) mapRef.current?.setTileUrl(provider.url);
    });
  }, []));

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
        needsRejoinRef.current = false;
        setReconnecting(true);
        doRejoinOrCreate(socket, roomCodeRef.current);
      } else if (!roomCodeRef.current) {
        doCreateRoom(socket);
      } else {
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

    socket.on('connect_error', () => {});

    return () => {
      socket.disconnect();
      socketStore.clearNavigator();
      clearSession();
    };
  }, [doCreateRoom, doRejoinOrCreate]);

  // Live route drawing: fetch OSRM whenever waypoints have ≥2 points
  useEffect(() => {
    if (waypoints.length < 2) {
      mapRef.current?.updateRoute([]);
      return;
    }
    fetchRoute(waypoints).then((result) => {
      if (result) mapRef.current?.updateRoute(result.coordinates);
      else mapRef.current?.updateRoute([]);
    });
  }, [waypoints]);

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

  const handleRemoveWaypoint = useCallback((index) => {
    setWaypoints((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      mapRef.current?.updateWaypoints(updated);
      return updated;
    });
  }, []);

  const handleSendRoute = useCallback(async () => {
    if (waypoints.length === 0) return;
    setSending(true);
    socketRef.current?.emit('send_route', { waypoints });
    setTimeout(() => setSending(false), 800);
  }, [waypoints]);

  const handleCenter = useCallback(async () => {
    try {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      mapRef.current?.panTo(loc.coords.latitude, loc.coords.longitude, 15);
    } catch {}
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <LeafletMap ref={mapRef} style={StyleSheet.absoluteFill} />

      {/* Loading overlay */}
      {status === STATUS.CONNECTING && !reconnecting && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Łączenie z serwerem…</Text>
        </View>
      )}

      {/* Top bar: room badge + actions */}
      <View style={styles.topBar} pointerEvents="box-none">
        <View style={styles.roomBadge}>
          <View style={[styles.dot,
            driverConnected ? styles.dotGreen
            : reconnecting   ? styles.dotAmber
            : styles.dotGray,
          ]} />
          <Text style={styles.roomCodeText}>{roomCode || '——'}</Text>
        </View>
        <View style={styles.topActions} pointerEvents="box-none">
          <TouchableOpacity style={styles.iconBtn} onPress={handleCenter}>
            <Text style={styles.iconBtnText}>⊙</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.navigate('Settings')}>
            <Text style={styles.iconBtnText}>⚙</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Reconnect banner */}
      {reconnecting && (
        <View style={styles.reconnectBanner}>
          <ActivityIndicator size="small" color="#f59e0b" style={{ marginRight: 8 }} />
          <Text style={styles.reconnectText}>Przywracanie połączenia…</Text>
        </View>
      )}

      {/* Bottom sheet: waypoints list + input + send */}
      <View style={styles.bottomSheet}>
        {waypoints.length > 0 && (
          <View style={styles.waypointPanel}>
            <ScrollView
              style={{ maxHeight: 200 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {waypoints.map((wp, index) => (
                <View key={index} style={[styles.waypointRow, index > 0 && styles.waypointBorder]}>
                  <Text style={styles.waypointIndex}>{index + 1}</Text>
                  <Text style={styles.waypointLabel} numberOfLines={1}>{wp.label}</Text>
                  <TouchableOpacity
                    onPress={() => handleRemoveWaypoint(index)}
                    style={styles.removeBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.removeBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

      {/* Bottom input + send bar */}
      <View style={styles.bottomBar}>
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

        {waypoints.length > 0 && (
          <TouchableOpacity
            style={[styles.sendBtn, !driverConnected && styles.sendBtnDisabled]}
            onPress={handleSendRoute}
            disabled={!driverConnected || sending}
          >
            {sending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.sendBtnText}>
                  {driverConnected ? 'Wyślij trasę do kierowcy' : 'Czekam na kierowcę…'}
                </Text>}
          </TouchableOpacity>
        )}
      </View>
      </View>
    </View>
  );
}

const PANEL_BG = 'rgba(15,23,42,0.88)';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.7)',
    alignItems: 'center', justifyContent: 'center',
    zIndex: 50,
  },
  loadingText: { color: '#94a3b8', marginTop: 12, fontSize: 15 },

  // Top bar
  topBar: {
    position: 'absolute', top: 14, left: 14, right: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    zIndex: 10,
  },
  roomBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: PANEL_BG,
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 7 },
  dotGreen: { backgroundColor: '#22c55e' },
  dotAmber: { backgroundColor: '#f59e0b' },
  dotGray:  { backgroundColor: '#475569' },
  roomCodeText: { color: '#f1f5f9', fontSize: 15, fontWeight: '700', letterSpacing: 2 },
  topActions: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: PANEL_BG,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnText: { fontSize: 18, color: '#f1f5f9' },

  // Reconnect
  reconnectBanner: {
    position: 'absolute', top: 70, left: 14, right: 14,
    backgroundColor: '#78350f', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    zIndex: 10,
  },
  reconnectText: { color: '#fef3c7', fontSize: 13 },

  // Bottom sheet (wraps waypoints + input + send)
  bottomSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: PANEL_BG,
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    overflow: 'hidden', zIndex: 10,
  },
  waypointPanel: {
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  waypointRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10,
  },
  waypointBorder: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  waypointIndex: { color: '#3b82f6', fontWeight: '700', fontSize: 13, width: 20, marginRight: 10 },
  waypointLabel: { flex: 1, color: '#e2e8f0', fontSize: 13 },
  removeBtn: { paddingLeft: 8 },
  removeBtnText: { color: '#ef4444', fontSize: 14 },

  // Input + send section
  bottomBar: {
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 28 : 16,
  },
  inputRow: { flexDirection: 'row', gap: 8, marginBottom: 0 },
  input: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 10,
    color: '#f1f5f9', paddingHorizontal: 14, paddingVertical: 11, fontSize: 14,
  },
  addBtn: {
    backgroundColor: '#2563eb', borderRadius: 10,
    width: 46, alignItems: 'center', justifyContent: 'center',
  },
  addBtnText: { color: '#fff', fontSize: 26, fontWeight: '700', lineHeight: 30 },
  sendBtn: {
    backgroundColor: '#059669', borderRadius: 12,
    padding: 14, alignItems: 'center', marginTop: 10,
  },
  sendBtnDisabled: { backgroundColor: '#1e293b' },
  sendBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
