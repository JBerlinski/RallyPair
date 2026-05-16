import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  StatusBar, ActivityIndicator, Animated,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import LeafletMap from '../components/LeafletMap';
import ManeuverIcon from '../components/ManeuverIcon';
import NorthCompass from '../components/NorthCompass';
import { socketStore } from '../socketStore';
import { clearSession } from '../utils/sessionStorage';
import { fetchRoute } from '../utils/osrm';
import { loadSettings, getCachedSettings, TILE_PROVIDERS } from '../utils/settings';

const POSITION_INTERVAL_MS = 3000;
const NAV_ZOOM = 17;

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
  const currentHeadingRef = useRef(null);
  const routeCoordsRef = useRef([]);
  const stepsRef = useRef([]);
  const stepIdxRef = useRef(0);
  const needsRejoinRef = useRef(false);
  const settingsRef = useRef(getCachedSettings());

  // headingLock: when true the map rotates with GPS heading and perspective tilt is on.
  // When false the map stays north-up (user manually broke out of tracking).
  const headingLockRef = useRef(true);

  const [connected, setConnected] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Czekam na trasę od nawigatora…');
  const [currentStep, setCurrentStep] = useState(null);
  const [distToStep, setDistToStep] = useState(null);
  const [navMode, setNavMode] = useState(null); // null | 'follow' | 'overview'
  const [bearing, setBearing] = useState(0);
  const [headingLock, setHeadingLock] = useState(true); // for compass visual

  // Toast
  const toastAnim = useRef(new Animated.Value(0)).current;
  const [toastMsg, setToastMsg] = useState('');
  const toastTimerRef = useRef(null);

  const showToast = useCallback((msg) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg(msg);
    toastAnim.setValue(0);
    Animated.timing(toastAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    toastTimerRef.current = setTimeout(() => {
      Animated.timing(toastAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    }, 1500);
  }, [toastAnim]);

  const applyBearing = useCallback((deg) => {
    mapRef.current?.setBearing(deg);
    setBearing(deg);
  }, []);

  // Compass tap: toggle heading-lock mode
  const handleCompassPress = useCallback(() => {
    const newLock = !headingLockRef.current;
    headingLockRef.current = newLock;
    setHeadingLock(newLock);

    if (newLock) {
      // Re-engage tracking: snap to current heading immediately
      if (currentHeadingRef.current != null) applyBearing(currentHeadingRef.current);
      // Re-enable tilt only if a route is active (navMode === 'follow')
      setNavMode((mode) => {
        if (mode === 'follow') mapRef.current?.setNavTilt(true);
        return mode;
      });
    } else {
      // Break out to north-up, flat view
      applyBearing(0);
      mapRef.current?.setNavTilt(false);
    }
  }, [applyBearing]);

  // Tile + settings refresh on every focus
  useFocusEffect(useCallback(() => {
    loadSettings().then((s) => {
      settingsRef.current = s;
      const provider = TILE_PROVIDERS.find((p) => p.id === s.tileProvider);
      if (provider) mapRef.current?.setTileUrl(provider.url);
    });
  }, []));

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
          currentHeadingRef.current = hdg;
          lastPositionRef.current = { lat: latitude, lng: longitude };

          setNavMode((mode) => {
            if (mode === 'follow') {
              mapRef.current?.panTo(latitude, longitude, NAV_ZOOM);
              if (headingLockRef.current && hdg != null) {
                mapRef.current?.setBearing(hdg);
                setBearing(hdg);
              }
            } else if (mode !== 'overview') {
              // null mode: respect per-setting behaviour
              const cfg = settingsRef.current;
              if (cfg.autoCenter) mapRef.current?.panTo(latitude, longitude);
              if (cfg.compassRotation && hdg != null) {
                mapRef.current?.setBearing(hdg);
                setBearing(hdg);
              }
            }
            return mode;
          });

          // Advance route steps
          const steps = stepsRef.current;
          if (steps.length > 0) {
            const idx = stepIdxRef.current;
            if (idx < steps.length) {
              const step = steps[idx];
              const dist = haversine(latitude, longitude, step.location.latitude, step.location.longitude);
              setDistToStep(dist);
              if (dist < getThreshold(step.ref) && idx + 1 < steps.length) {
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

  // Socket listeners
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

      if (origin) {
        mapRef.current?.panTo(origin.lat, origin.lng, NAV_ZOOM);
        if (currentHeadingRef.current != null) applyBearing(currentHeadingRef.current);
      } else {
        mapRef.current?.fitRoute(result.coordinates);
      }

      // Enter follow mode + tilt if heading lock is on
      setNavMode('follow');
      if (headingLockRef.current) mapRef.current?.setNavTilt(true);

      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
      showToast(`Nowa trasa → ${wps[wps.length - 1].label || 'cel zaktualizowany'}`);
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
  }, [socket, roomCode, applyBearing, showToast]);

  // Toggle full-route overview ↔ navigation follow
  const handleNavToggle = useCallback(() => {
    setNavMode((prev) => {
      if (prev === 'overview') {
        // Return to follow + restore tilt/bearing if heading-locked
        const pos = lastPositionRef.current;
        if (pos) {
          mapRef.current?.panTo(pos.lat, pos.lng, NAV_ZOOM);
          if (headingLockRef.current && currentHeadingRef.current != null) {
            mapRef.current?.setBearing(currentHeadingRef.current);
            setBearing(currentHeadingRef.current);
          }
        }
        if (headingLockRef.current) mapRef.current?.setNavTilt(true);
        return 'follow';
      } else {
        // Full route view: north-up, flat
        if (routeCoordsRef.current.length > 0) {
          mapRef.current?.fitRoute(routeCoordsRef.current);
          mapRef.current?.setBearing(0);
          setBearing(0);
        }
        mapRef.current?.setNavTilt(false);
        return 'overview';
      }
    });
  }, []);

  const handleSettings = useCallback(() => navigation.navigate('Settings'), [navigation]);

  const arrived = currentStep?.instruction === 'arrive';

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <LeafletMap ref={mapRef} style={StyleSheet.absoluteFill} />

      {/* Maneuver island — tall, column layout for quick at-a-glance reading */}
      {currentStep && !reconnecting && (
        <View style={styles.maneuverIsland}>
          <ManeuverIcon
            instruction={currentStep.instruction}
            modifier={currentStep.modifier}
            bearingBefore={currentStep.bearingBefore}
            bearingAfter={currentStep.bearingAfter}
            size={80}
          />
          <Text style={styles.maneuverName} numberOfLines={2}>
            {arrived
              ? 'Dotarłeś do celu'
              : (currentStep.name || currentStep.modifier || currentStep.instruction)}
          </Text>
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

      {/* Compass — top-right, shows active tracking state */}
      <NorthCompass
        bearing={bearing}
        headingLock={headingLock}
        onPress={handleCompassPress}
        style={styles.compass}
      />

      {/* Toast — slides in from top, auto-dismisses */}
      <Animated.View
        style={[styles.toast, {
          opacity: toastAnim,
          transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [-60, 0] }) }],
        }]}
        pointerEvents="none"
      >
        <Text style={styles.toastText}>{toastMsg}</Text>
      </Animated.View>

      {/* Room badge — bottom-left */}
      <View style={styles.roomBadge}>
        {reconnecting
          ? <ActivityIndicator size="small" color="#f59e0b" />
          : <View style={[styles.dot, connected ? styles.dotGreen : styles.dotRed]} />}
        <Text style={styles.roomCode}>{roomCode}</Text>
      </View>

      {/* FABs — bottom-right */}
      <View style={styles.fabCol}>
        {navMode != null && (
          <TouchableOpacity
            style={[styles.fab, navMode === 'overview' && styles.fabActive]}
            onPress={handleNavToggle}
          >
            <Text style={styles.fabIcon}>{navMode === 'overview' ? '📍' : '🗺'}</Text>
          </TouchableOpacity>
        )}
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
    backgroundColor: 'rgba(15,23,42,0.95)',
    borderRadius: 18,
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14,
    alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5, shadowRadius: 10, elevation: 12,
  },
  statusIsland: {
    paddingVertical: 18,
    backgroundColor: 'rgba(15,23,42,0.82)',
  },
  maneuverName: {
    color: '#f1f5f9', fontSize: 18, fontWeight: '700',
    textAlign: 'center', marginTop: 10, lineHeight: 24,
  },
  maneuverDist: {
    color: '#3b82f6', fontSize: 26, fontWeight: '800',
    textAlign: 'center', marginTop: 6, letterSpacing: 0.5,
  },
  statusText: { color: '#94a3b8', fontSize: 15, textAlign: 'center' },

  compass: {
    position: 'absolute', top: 14, right: 14, zIndex: 20,
  },

  toast: {
    position: 'absolute', top: 8, left: 20, right: 20,
    backgroundColor: 'rgba(15,23,42,0.97)',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 11,
    alignItems: 'center', elevation: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5, shadowRadius: 8,
  },
  toastText: { color: '#f1f5f9', fontSize: 15, fontWeight: '600', textAlign: 'center' },

  reconnectBanner: {
    position: 'absolute', top: 220, left: 12, right: 12,
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
  dotRed:   { backgroundColor: '#ef4444' },
  roomCode: { color: '#94a3b8', fontSize: 13, fontWeight: '600', letterSpacing: 1 },

  fabCol: { position: 'absolute', bottom: 28, right: 16, gap: 12 },
  fab: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(15,23,42,0.9)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4, shadowRadius: 4, elevation: 6,
  },
  fabActive: { backgroundColor: 'rgba(37,99,235,0.9)' },
  fabIcon: { fontSize: 22, color: '#f1f5f9' },
});
