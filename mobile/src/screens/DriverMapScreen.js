import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, StatusBar,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import LeafletMap from '../components/LeafletMap';
import { socketStore } from '../socketStore';
import { fetchRoute } from '../utils/osrm';

const POSITION_INTERVAL_MS = 3000;

export default function DriverMapScreen({ route }) {
  const { roomCode } = route.params;
  const socket = socketStore.getDriver();
  const mapRef = useRef(null);
  const locationSubRef = useRef(null);
  const lastSentRef = useRef(0);
  const lastPositionRef = useRef(null);  // driver's own GPS — used as route origin
  const routeCoordsRef = useRef([]);

  const [connected, setConnected] = useState(true);
  const [statusMsg, setStatusMsg] = useState('Czekam na trasę od nawigatora…');
  const [currentStep, setCurrentStep] = useState(null);
  const [overview, setOverview] = useState(false);

  // GPS tracking — show own position on map + send to navigator
  useEffect(() => {
    let active = true;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.warn('[GPS] Permission denied');
        return;
      }
      if (!active) return;

      locationSubRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: POSITION_INTERVAL_MS, distanceInterval: 5 },
        (loc) => {
          if (!active) return;
          const { latitude, longitude } = loc.coords;

          // Show on driver's own map (bug #1 fix)
          mapRef.current?.updateDriver(latitude, longitude);
          lastPositionRef.current = { lat: latitude, lng: longitude };

          // Throttle send to navigator
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

  // WebSocket listeners
  useEffect(() => {
    if (!socket) {
      setStatusMsg('Brak połączenia z serwerem.');
      return;
    }

    const onRouteUpdate = async (payload) => {
      const { waypoints: wps } = payload;
      console.log('[DriverMap] route_update, waypoints:', wps?.length ?? 0);
      if (!wps?.length) return;

      setStatusMsg('Wyznaczam trasę…');
      mapRef.current?.updateWaypoints(wps);

      // Prepend driver's GPS as route origin (bug #2 fix)
      const origin = lastPositionRef.current;
      const routePoints = origin ? [origin, ...wps] : wps;
      console.log('[DriverMap] fetchRoute with', routePoints.length, 'points, origin:', !!origin);

      const result = await fetchRoute(routePoints);
      if (!result) {
        console.warn('[DriverMap] fetchRoute returned null — need ≥2 points or OSRM error');
        setStatusMsg(origin
          ? 'Nie udało się wyznaczyć trasy — sprawdź połączenie.'
          : 'Oczekuję na sygnał GPS przed wyznaczeniem trasy…');
        return;
      }

      routeCoordsRef.current = result.coordinates;
      setCurrentStep(result.steps[0] ?? null);
      setStatusMsg('');

      mapRef.current?.updateRoute(result.coordinates);
      mapRef.current?.fitRoute(result.coordinates);

      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
      Alert.alert('Nowa trasa', `Cel: ${wps[wps.length - 1].label || 'zaktualizowany'}`);
    };

    const onRoomClosed = () => {
      setConnected(false);
      Alert.alert('Rozłączono', 'Nawigator zakończył sesję.');
    };

    socket.on('route_update', onRouteUpdate);
    socket.on('room_closed', onRoomClosed);
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect', () => setConnected(true));

    return () => {
      socket.off('route_update', onRouteUpdate);
      socket.off('room_closed', onRoomClosed);
      socket.off('disconnect');
      socket.off('connect');
      socket.disconnect();
      socketStore.clearDriver();
    };
  }, [socket]);

  const handleOverviewToggle = () => {
    setOverview((v) => {
      const next = !v;
      if (next && routeCoordsRef.current.length > 0) {
        mapRef.current?.fitRoute(routeCoordsRef.current);
      }
      return next;
    });
  };

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      <LeafletMap ref={mapRef} style={StyleSheet.absoluteFill} />

      <View style={styles.topBar}>
        <Text style={styles.roomCode}>Pokój: {roomCode}</Text>
        <View style={[styles.dot, connected ? styles.dotGreen : styles.dotRed]} />
      </View>

      {currentStep && !overview && (
        <View style={styles.instructionBox}>
          <Text style={styles.instructionText}>
            {currentStep.modifier
              ? `${currentStep.instruction} ${currentStep.modifier}`
              : currentStep.instruction}
            {currentStep.name ? ` → ${currentStep.name}` : ''}
          </Text>
          <Text style={styles.instructionDist}>{Math.round(currentStep.distance)} m</Text>
        </View>
      )}

      {statusMsg !== '' && (
        <View style={styles.statusBox}>
          <Text style={styles.statusText}>{statusMsg}</Text>
        </View>
      )}

      <TouchableOpacity style={styles.overviewBtn} onPress={handleOverviewToggle}>
        <Text style={styles.overviewBtnText}>{overview ? '📍 Nawigacja' : '🗺 Cała mapa'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  topBar: {
    position: 'absolute', top: 12, left: 12, right: 12,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(15,23,42,0.85)', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  roomCode: { color: '#94a3b8', fontSize: 13, flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotGreen: { backgroundColor: '#22c55e' },
  dotRed: { backgroundColor: '#ef4444' },
  instructionBox: {
    position: 'absolute', bottom: 90, left: 12, right: 12,
    backgroundColor: 'rgba(15,23,42,0.92)', borderRadius: 14,
    padding: 16, flexDirection: 'row', alignItems: 'center',
  },
  instructionText: { color: '#f1f5f9', fontSize: 15, fontWeight: '600', flex: 1 },
  instructionDist: { color: '#3b82f6', fontSize: 15, fontWeight: '700', marginLeft: 8 },
  statusBox: {
    position: 'absolute', bottom: 90, left: 12, right: 12,
    backgroundColor: 'rgba(15,23,42,0.85)', borderRadius: 12,
    padding: 14, alignItems: 'center',
  },
  statusText: { color: '#94a3b8', fontSize: 14 },
  overviewBtn: {
    position: 'absolute', bottom: 28, right: 16,
    backgroundColor: 'rgba(15,23,42,0.9)', borderRadius: 24,
    paddingHorizontal: 18, paddingVertical: 12,
  },
  overviewBtnText: { color: '#f1f5f9', fontSize: 14, fontWeight: '600' },
});
