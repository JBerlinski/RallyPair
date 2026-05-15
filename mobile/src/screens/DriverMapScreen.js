import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, StatusBar,
} from 'react-native';
import MapView, { Polyline, Marker, UrlTile, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { socketStore } from '../socketStore';
import { fetchRoute } from '../utils/osrm';

const INITIAL_REGION = { latitude: 52.237, longitude: 21.017, latitudeDelta: 0.05, longitudeDelta: 0.05 };
const POSITION_INTERVAL_MS = 3000;

export default function DriverMapScreen({ route }) {
  const { roomCode } = route.params;
  const socket = socketStore.getDriver();
  const mapRef = useRef(null);
  const locationSubRef = useRef(null);
  const lastSentRef = useRef(0);

  const [routeCoords, setRouteCoords] = useState([]);
  const [waypoints, setWaypoints] = useState([]);
  const [steps, setSteps] = useState([]);
  const [overview, setOverview] = useState(false);
  const [connected, setConnected] = useState(true);
  const [statusMsg, setStatusMsg] = useState('Czekam na trasę od nawigatora…');

  const fitToRoute = useCallback((coords) => {
    if (coords.length === 0 || !mapRef.current) return;
    mapRef.current.fitToCoordinates(coords, {
      edgePadding: { top: 80, right: 40, bottom: 120, left: 40 },
      animated: true,
    });
  }, []);

  // GPS tracking — sends position to navigator via WebSocket
  useEffect(() => {
    let active = true;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || !active) return;

      locationSubRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: POSITION_INTERVAL_MS, distanceInterval: 5 },
        (loc) => {
          const now = Date.now();
          if (now - lastSentRef.current < POSITION_INTERVAL_MS) return;
          lastSentRef.current = now;
          socket?.emit('send_position', {
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            heading: loc.coords.heading,
            speed: loc.coords.speed,
          });
        },
      );
    })();

    return () => {
      active = false;
      locationSubRef.current?.remove();
    };
  }, [socket]);

  // WebSocket event listeners
  useEffect(() => {
    if (!socket) {
      setStatusMsg('Brak połączenia z serwerem.');
      return;
    }

    const onRouteUpdate = async (payload) => {
      const { waypoints: wps } = payload;
      if (!wps || wps.length === 0) return;

      setWaypoints(wps);
      setStatusMsg('Wyznaczam trasę…');

      const result = await fetchRoute(wps);
      if (!result) {
        setStatusMsg('Nie udało się wyznaczyć trasy.');
        return;
      }

      setRouteCoords(result.coordinates);
      setSteps(result.steps);
      setStatusMsg('');

      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } catch {}

      Alert.alert('Nowa trasa', `Cel: ${wps[wps.length - 1].label || 'zaktualizowany'}`);
      setTimeout(() => fitToRoute(result.coordinates), 300);
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
  }, [socket, fitToRoute]);

  const handleOverviewToggle = () => {
    setOverview((v) => !v);
    if (!overview && routeCoords.length > 0) {
      fitToRoute(routeCoords);
    }
  };

  const currentInstruction = steps[0];

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        initialRegion={INITIAL_REGION}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        moveOnMarkerPress={false}
        showsUserLocation
        showsMyLocationButton={false}
      >
        <UrlTile
          urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maximumZ={19}
          flipY={false}
        />

        {routeCoords.length > 0 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor="#3b82f6"
            strokeWidth={5}
          />
        )}

        {waypoints.map((wp, i) => (
          <Marker
            key={i}
            coordinate={{ latitude: wp.lat, longitude: wp.lng }}
            title={wp.label || `Punkt ${i + 1}`}
            pinColor={i === waypoints.length - 1 ? '#ef4444' : '#f59e0b'}
          />
        ))}
      </MapView>

      <View style={styles.topBar}>
        <Text style={styles.roomCode}>Pokój: {roomCode}</Text>
        <View style={[styles.dot, connected ? styles.dotGreen : styles.dotRed]} />
      </View>

      {currentInstruction && !overview && (
        <View style={styles.instructionBox}>
          <Text style={styles.instructionText}>
            {currentInstruction.modifier
              ? `${currentInstruction.instruction} ${currentInstruction.modifier}`
              : currentInstruction.instruction}
            {currentInstruction.name ? ` → ${currentInstruction.name}` : ''}
          </Text>
          <Text style={styles.instructionDist}>
            {Math.round(currentInstruction.distance)} m
          </Text>
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
