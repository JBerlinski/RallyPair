import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, StatusBar, ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import LeafletMap from '../components/LeafletMap';
import { socketStore } from '../socketStore';
import { clearSession } from '../utils/sessionStorage';
import { fetchRoute } from '../utils/osrm';
import { loadSettings, getCachedSettings, TILE_PROVIDERS } from '../utils/settings';

const POSITION_INTERVAL_MS = 3000;

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180;
  const f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getThreshold(ref) {
  if (!ref) return 150;
  if (/^A\d/i.test(ref)) return 500;
  if (/^S\d/i.test(ref)) return 500;
  if (/^DK\d/i.test(ref)) return 300;
  return 150;
}

function maneuverIcon(instruction, modifier) {
  const m = modifier || '';
  switch (instruction) {
    case 'turn':
      if (m.includes('sharp left'))  return '↰';
      if (m.includes('sharp right')) return '↱';
      if (m.includes('slight left')) return '↖';
      if (m.includes('slight right'))return '↗';
      if (m.includes('uturn'))       return '↩';
      if (m.includes('left'))        return '←';
      if (m.includes('right'))       return '→';
      return '↑';
    case 'continue':  return '↑';
    case 'depart':    return '▶';
    case 'arrive':    return '⊙';
    case 'roundabout':
    case 'rotary':    return '↻';
    case 'fork':
      if (m.includes('left'))  return '↰';
      if (m.includes('right')) return '↱';
      return '↑';
    case 'merge':
    case 'on ramp':
    case 'off ramp':
    case 'end of road':
      if (m.includes('left'))  return '←';
      if (m.includes('right')) return '→';
      return '↑';
    default: return '↑';
  }
}

function fmtDist(m) {
  if (m >= 950) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 10) * 10} m`;
}

export default function DriverMapScreen({ navigation, route }) {
  const { roomCode } = route.params;
  const socket = socketStore.getDriver();
  const mapRef = useRef(null);
  const locationSubRef = useRef(null);
  const lastSentRef = useRef(0);
  const lastPositionRef = useRef(null);
  const routeCoordsRef = useRef([]);
  const stepsRef = useRef([]);
  const stepIdxRef = useRef(0);
  const needsRejoinRef = useRef(false);
  const settingsRef = useRef(getCachedSettings());

  const [connected, setConnected] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Czekam na trasę od nawigatora…');
  const [currentStep, setCurrentStep] = useState(null);
  const [distToStep, setDistToStep] = useState(null);

  // Load settings and apply tile provider once map is ready
  useEffect(() => {
    loadSettings().then((s) => {
      settingsRef.current = s;
      const provider = TILE_PROVIDERS.find((p) => p.id === s.tileProvider);
      if (provider && provider.id !== 'osm') {
        // Small delay so the map iframe/webview has initialised
        setTimeout(() => mapRef.current?.setTileUrl(provider.url), 1500);
      }
    });
  }, []);

  // GPS tracking
  useEffect(() => {
    let active = true;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { console.warn('[GPS] Permission denied'); return; }
      if (!active) return;

      locationSubRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: POSITION_INTERVAL_MS, distanceInterval: 5 },
        (loc) => {
          if (!active) return;
          const { latitude, longitude, heading } = loc.coords;
          const hdg = (heading != null && heading >= 0) ? heading : null;

          mapRef.current?.updateDriver(latitude, longitude, hdg);

          const cfg = settingsRef.current;
          if (cfg.compassRotation && hdg != null) mapRef.current?.setBearing(hdg);
          if (cfg.autoCenter) mapRef.current?.panTo(latitude, longitude);

          lastPositionRef.current = { lat: latitude, lng: longitude };

          // Advance route steps
          const steps = stepsRef.current;
          if (steps.length > 0) {
            const idx = stepIdxRef.current;
            if (idx < steps.length) {
              const step = steps[idx];
              const dist = haversine(latitude, longitude, step.location.latitude, step.location.longitude);
              setDistToStep(dist);
              const threshold = getThreshold(step.ref);
              if (dist < threshold && idx + 1 < steps.length) {
                stepIdxRef.current = idx + 1;
                setCurrentStep(steps[idx + 1]);
                setDistToStep(null);
              } else {
                setCurrentStep(step);
              }
            }
          }

          const now = Date.now();
          if (now - lastSentRef.current < POSITION_INTERVAL_MS) return;
          lastSentRef.current = now;
          socket?.emit('send_position', { lat: latitude, lng: longitude });
        },
      );
    })();
    return () => {
      active = false;
      locationSubRef.current?.remove();
    };
  }, [socket]);

  // Socket listeners + reconnect
  useEffect(() => {
    if (!socket) { setStatusMsg('Brak połączenia z serwerem.'); return; }

    const onRouteUpdate = async (payload) => {
      const { waypoints: wps } = payload;
      if (!wps?.length) return;

      setStatusMsg('Wyznaczam trasę…');
      mapRef.current?.updateWaypoints(wps);

      const origin = lastPositionRef.current;
      const pts = origin ? [origin, ...wps] : wps;
      const result = await fetchRoute(pts);

      if (!result) {
        setStatusMsg(origin
          ? 'Nie udało się wyznaczyć trasy — sprawdź połączenie.'
          : 'Oczekuję na sygnał GPS przed wyznaczeniem trasy…');
        return;
      }

      routeCoordsRef.current = result.coordinates;
      stepsRef.current = result.steps;
      stepIdxRef.current = 0;
      setCurrentStep(result.steps[0] ?? null);
      setDistToStep(null);
      setStatusMsg('');
      mapRef.current?.updateRoute(result.coordinates);
      mapRef.current?.fitRoute(result.coordinates);

      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
      Alert.alert('Nowa trasa', `Cel: ${wps[wps.length - 1].label || 'zaktualizowany'}`);
    };

    const onRoomClosed = () => {
      setConnected(false);
      clearSession();
      Alert.alert('Rozłączono', 'Nawigator zakończył sesję.');
    };

    const onNavigatorReconnecting = () =>
      setStatusMsg('Nawigator się rozłączył, próba ponownego połączenia…');

    const onNavigatorRejoined = () => {
      setStatusMsg('Nawigator ponownie połączony.');
      setTimeout(() => setStatusMsg(''), 2000);
    };

    const onDisconnect = () => {
      needsRejoinRef.current = true;
      setConnected(false);
      setReconnecting(true);
    };

    const onConnect = () => {
      setConnected(true);
      if (needsRejoinRef.current) {
        needsRejoinRef.current = false;
        socket.emit('rejoin_driver', { roomCode }, (res) => {
          setReconnecting(false);
          if (!res?.ok) {
            clearSession();
            Alert.alert('Sesja wygasła', 'Pokój nie istnieje. Wróć do menu.');
            setStatusMsg('Sesja wygasła.');
          } else {
            setStatusMsg('');
          }
        });
      } else {
        setReconnecting(false);
      }
    };

    socket.on('route_update', onRouteUpdate);
    socket.on('room_closed', onRoomClosed);
    socket.on('navigator_reconnecting', onNavigatorReconnecting);
    socket.on('navigator_rejoined', onNavigatorRejoined);
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);

    return () => {
      socket.off('route_update', onRouteUpdate);
      socket.off('room_closed', onRoomClosed);
      socket.off('navigator_reconnecting', onNavigatorReconnecting);
      socket.off('navigator_rejoined', onNavigatorRejoined);
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
      socket.disconnect();
      socketStore.clearDriver();
    };
  }, [socket, roomCode]);

  const handleCenter = useCallback(() => {
    if (lastPositionRef.current) {
      const { lat, lng } = lastPositionRef.current;
      mapRef.current?.panTo(lat, lng, 16);
    }
  }, []);

  const handleSettings = useCallback(() => navigation.navigate('Settings'), [navigation]);

  const arrived = currentStep?.instruction === 'arrive';

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <LeafletMap ref={mapRef} style={StyleSheet.absoluteFill} />

      {/* Maneuver island — top, full width */}
      {currentStep && !reconnecting && (
        <View style={styles.maneuverIsland}>
          <Text style={styles.maneuverIcon}>
            {arrived ? '🏁' : maneuverIcon(currentStep.instruction, currentStep.modifier)}
          </Text>
          <View style={styles.maneuverBody}>
            <Text style={styles.maneuverName} numberOfLines={1}>
              {arrived
                ? 'Dotarłeś do celu'
                : (currentStep.name || currentStep.modifier || currentStep.instruction)}
            </Text>
          </View>
          {!arrived && (
            <Text style={styles.maneuverDist}>
              {distToStep != null ? fmtDist(distToStep) : fmtDist(currentStep.distance)}
            </Text>
          )}
        </View>
      )}

      {/* Status message (no route yet) */}
      {statusMsg !== '' && !reconnecting && (
        <View style={[styles.maneuverIsland, styles.statusIsland]}>
          <Text style={styles.statusText}>{statusMsg}</Text>
        </View>
      )}

      {/* Reconnect banner */}
      {reconnecting && (
        <View style={styles.reconnectBanner}>
          <ActivityIndicator size="small" color="#f59e0b" style={{ marginRight: 8 }} />
          <Text style={styles.reconnectText}>Przywracanie połączenia…</Text>
        </View>
      )}

      {/* Room badge — bottom-left */}
      <View style={styles.roomBadge}>
        {reconnecting
          ? <ActivityIndicator size="small" color="#f59e0b" />
          : <View style={[styles.dot, connected ? styles.dotGreen : styles.dotRed]} />}
        <Text style={styles.roomCode}>{roomCode}</Text>
      </View>

      {/* FABs — bottom-right column */}
      <View style={styles.fabCol}>
        <TouchableOpacity style={styles.fab} onPress={handleCenter}>
          <Text style={styles.fabIcon}>⊙</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.fab} onPress={handleSettings}>
          <Text style={styles.fabIcon}>⚙</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  maneuverIsland: {
    position: 'absolute', top: 14, left: 14, right: 14,
    backgroundColor: 'rgba(15,23,42,0.93)',
    borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45, shadowRadius: 8, elevation: 10,
  },
  statusIsland: { backgroundColor: 'rgba(15,23,42,0.82)' },
  maneuverIcon: { fontSize: 28, marginRight: 12 },
  maneuverBody: { flex: 1 },
  maneuverName: { color: '#f1f5f9', fontSize: 14, fontWeight: '600' },
  maneuverDist: { color: '#3b82f6', fontSize: 17, fontWeight: '800', marginLeft: 10 },
  statusText: { color: '#94a3b8', fontSize: 14, flex: 1, textAlign: 'center' },

  reconnectBanner: {
    position: 'absolute', top: 84, left: 12, right: 12,
    backgroundColor: '#78350f', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  reconnectText: { color: '#fef3c7', fontSize: 13 },

  roomBadge: {
    position: 'absolute', bottom: 28, left: 16,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(15,23,42,0.82)',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 7 },
  dotGreen: { backgroundColor: '#22c55e' },
  dotRed: { backgroundColor: '#ef4444' },
  roomCode: { color: '#94a3b8', fontSize: 13, fontWeight: '600', letterSpacing: 1 },

  fabCol: {
    position: 'absolute', bottom: 28, right: 16,
    gap: 12,
  },
  fab: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(15,23,42,0.9)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4, shadowRadius: 4, elevation: 6,
  },
  fabIcon: { fontSize: 22, color: '#f1f5f9' },
});
