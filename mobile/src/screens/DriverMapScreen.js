import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, StatusBar, ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import LeafletMap from '../components/LeafletMap';
import { socketStore } from '../socketStore';
import { clearSession } from '../utils/sessionStorage';
import { fetchRoute } from '../utils/osrm';

const POSITION_INTERVAL_MS = 3000;

export default function DriverMapScreen({ route }) {
  const { roomCode } = route.params;
  const socket = socketStore.getDriver();
  const mapRef = useRef(null);
  const locationSubRef = useRef(null);
  const lastSentRef = useRef(0);
  const lastPositionRef = useRef(null);
  const routeCoordsRef = useRef([]);
  const needsRejoinRef = useRef(false);

  const [connected, setConnected] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Czekam na trasę od nawigatora…');
  const [currentStep, setCurrentStep] = useState(null);
  const [overview, setOverview] = useState(false);

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
          const { latitude, longitude } = loc.coords;

          mapRef.current?.updateDriver(latitude, longitude);
          lastPositionRef.current = { lat: latitude, lng: longitude };

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

  // WebSocket listeners + reconnect logic
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

      const origin = lastPositionRef.current;
      const routePoints = origin ? [origin, ...wps] : wps;
      console.log('[DriverMap] fetchRoute with', routePoints.length, 'points, origin:', !!origin);

      const result = await fetchRoute(routePoints);
      if (!result) {
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
      clearSession();
      Alert.alert('Rozłączono', 'Nawigator zakończył sesję.');
    };

    const onNavigatorReconnecting = () => {
      setStatusMsg('Nawigator się rozłączył, próba ponownego połączenia…');
    };

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
            Alert.alert('Sesja wygasła', 'Pokój nie istnieje. Wróć do menu.', [
              { text: 'OK', onPress: () => {} },
            ]);
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

  const handleOverviewToggle = () => {
    setOverview((v) => {
      const next = !v;
      if (next && routeCoordsRef.current.length > 0) mapRef.current?.fitRoute(routeCoordsRef.current);
      return next;
    });
  };

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <LeafletMap ref={mapRef} style={StyleSheet.absoluteFill} />

      <View style={styles.topBar}>
        <Text style={styles.roomCode}>Pokój: {roomCode}</Text>
        {reconnecting
          ? <ActivityIndicator size="small" color="#f59e0b" />
          : <View style={[styles.dot, connected ? styles.dotGreen : styles.dotRed]} />}
      </View>

      {reconnecting && (
        <View style={styles.reconnectBanner}>
          <Text style={styles.reconnectText}>Przywracanie połączenia…</Text>
        </View>
      )}

      {currentStep && !overview && !reconnecting && (
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

      {statusMsg !== '' && !reconnecting && (
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
  reconnectBanner: {
    position: 'absolute', top: 52, left: 12, right: 12,
    backgroundColor: '#78350f', borderRadius: 8,
    padding: 10, alignItems: 'center',
  },
  reconnectText: { color: '#fef3c7', fontSize: 13 },
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
