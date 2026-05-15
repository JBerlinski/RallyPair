import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal,
  StyleSheet, ActivityIndicator, Alert, StatusBar, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';
import { io } from 'socket.io-client';
import * as Location from 'expo-location';
import { BACKEND_URL } from '../config';
import { socketStore } from '../socketStore';
import { parseLocation } from '../utils/parseLocation';
import { saveSession, clearSession } from '../utils/sessionStorage';
import { fetchRoute } from '../utils/osrm';
import { reverseGeocode } from '../utils/reverseGeocode';
import { loadSettings, getCachedSettings, TILE_PROVIDERS } from '../utils/settings';
import LeafletMap from '../components/LeafletMap';

const STATUS = { CONNECTING: 'connecting', WAITING: 'waiting', PAIRED: 'paired' };

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

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

  // Context menu
  const [menuWpId, setMenuWpId] = useState(null); // _id of waypoint with open menu

  // Edit mode
  const [editingWpId, setEditingWpId] = useState(null);
  const [editingNewPos, setEditingNewPos] = useState(null); // { lat, lng }
  const [reverseGeocoding, setReverseGeocoding] = useState(false);

  // Apply tile provider on every focus (picks up settings changes)
  useFocusEffect(useCallback(() => {
    loadSettings().then((s) => {
      settingsRef.current = s;
      const provider = TILE_PROVIDERS.find((p) => p.id === s.tileProvider);
      if (provider) mapRef.current?.setTileUrl(provider.url);
    });
  }, []));

  // Socket setup
  const applyRoomCode = useCallback((code, hasDriver = false) => {
    roomCodeRef.current = code;
    setRoomCode(code);
    setDriverConnected(hasDriver);
    setStatus(hasDriver ? STATUS.PAIRED : STATUS.WAITING);
    saveSession('navigator', code);
  }, []);

  const doCreateRoom = useCallback((socket) => {
    socket.emit('create_room', (res) => {
      if (res.ok) applyRoomCode(res.roomCode, false);
      else { Alert.alert('Błąd', 'Nie udało się utworzyć pokoju'); navigation.goBack(); }
    });
  }, [applyRoomCode, navigation]);

  const doRejoinOrCreate = useCallback((socket, code) => {
    socket.emit('rejoin_navigator', { roomCode: code }, (res) => {
      setReconnecting(false);
      if (res.ok) applyRoomCode(res.roomCode, res.hasDriver);
      else doCreateRoom(socket);
    });
  }, [applyRoomCode, doCreateRoom]);

  useEffect(() => {
    const socket = io(BACKEND_URL, { transports: ['websocket'], reconnectionAttempts: 10, reconnectionDelay: 2000 });
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
    socket.on('disconnect', () => { needsRejoinRef.current = true; setReconnecting(true); });
    socket.on('driver_joined', () => { setDriverConnected(true); setStatus(STATUS.PAIRED); firstDriverPos.current = false; });
    socket.on('driver_disconnected', () => { setDriverConnected(false); firstDriverPos.current = false; setStatus(STATUS.WAITING); });
    socket.on('position_update', (payload) => {
      if (payload?.lat == null || payload?.lng == null) return;
      mapRef.current?.updateDriver(payload.lat, payload.lng);
      if (!firstDriverPos.current) {
        mapRef.current?.panTo(payload.lat, payload.lng, 14);
        firstDriverPos.current = true;
      }
    });
    socket.on('connect_error', () => {});

    return () => { socket.disconnect(); socketStore.clearNavigator(); clearSession(); };
  }, [doCreateRoom, doRejoinOrCreate]);

  // Sync waypoints to map + draw route
  useEffect(() => {
    mapRef.current?.updateWaypoints(waypoints);
    if (waypoints.length < 2) {
      mapRef.current?.updateRoute([]);
      return;
    }
    fetchRoute(waypoints).then((result) => {
      mapRef.current?.updateRoute(result?.coordinates ?? []);
    });
  }, [waypoints]);

  // Messages from Leaflet map (waypoint clicks, drag results)
  const handleMapMessage = useCallback((msg) => {
    if (msg.t === 'waypointClick') {
      const wp = waypoints[msg.index];
      if (wp) setMenuWpId(wp._id);
    } else if (msg.t === 'waypointMoved') {
      setEditingNewPos({ lat: msg.lat, lng: msg.lng });
    }
  }, [waypoints]);

  // Waypoint CRUD
  const handleAddWaypoint = useCallback(async () => {
    if (!locationInput.trim()) return;
    setParsing(true);
    try {
      const coords = await parseLocation(locationInput);
      if (!coords) { Alert.alert('Nie znaleziono', 'Nie udało się rozpoznać lokalizacji.'); return; }
      const label = coords.displayName || locationInput.trim();
      setWaypoints((prev) => [...prev, { ...coords, label, _id: uid() }]);
      setLocationInput('');
    } catch {
      Alert.alert('Błąd', 'Wystąpił błąd podczas parsowania lokalizacji.');
    } finally {
      setParsing(false);
    }
  }, [locationInput]);

  const handleDeleteWaypoint = useCallback((id) => {
    setMenuWpId(null);
    setWaypoints((prev) => prev.filter((wp) => wp._id !== id));
  }, []);

  // Edit mode
  const handleStartEdit = useCallback(() => {
    const id = menuWpId;
    setMenuWpId(null);
    const idx = waypoints.findIndex((wp) => wp._id === id);
    if (idx < 0) return;
    setEditingWpId(id);
    setEditingNewPos(null);
    mapRef.current?.editWaypoint(idx);
  }, [menuWpId, waypoints]);

  const handleConfirmEdit = useCallback(async () => {
    mapRef.current?.confirmEditWaypoint();
    if (editingNewPos) {
      setReverseGeocoding(true);
      try {
        const label = await reverseGeocode(editingNewPos.lat, editingNewPos.lng);
        setWaypoints((prev) =>
          prev.map((wp) => wp._id === editingWpId
            ? { ...wp, lat: editingNewPos.lat, lng: editingNewPos.lng, label }
            : wp)
        );
      } finally {
        setReverseGeocoding(false);
      }
    }
    setEditingWpId(null);
    setEditingNewPos(null);
  }, [editingWpId, editingNewPos]);

  const handleCancelEdit = useCallback(() => {
    mapRef.current?.cancelEditWaypoint();
    setEditingWpId(null);
    setEditingNewPos(null);
  }, []);

  const handleSendRoute = useCallback(() => {
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

  const menuWp = menuWpId ? waypoints.find((w) => w._id === menuWpId) : null;
  const editingIndex = editingWpId ? waypoints.findIndex((w) => w._id === editingWpId) : -1;

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <LeafletMap ref={mapRef} style={StyleSheet.absoluteFill} onMapMessage={handleMapMessage} />

      {/* Loading overlay */}
      {status === STATUS.CONNECTING && !reconnecting && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Łączenie z serwerem…</Text>
        </View>
      )}

      {/* Top bar */}
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

      {/* Bottom sheet */}
      <View style={styles.bottomSheet}>
        {/* Waypoints — drag & drop list */}
        {waypoints.length > 0 && editingWpId === null && (
          <View style={styles.waypointPanel}>
            <DraggableFlatList
              data={waypoints}
              keyExtractor={(item) => item._id}
              onDragEnd={({ data }) => setWaypoints(data)}
              style={{ maxHeight: 200 }}
              renderItem={({ item, drag, isActive, getIndex }) => (
                <ScaleDecorator>
                  <TouchableOpacity
                    style={[styles.waypointRow, (getIndex() ?? 0) > 0 && styles.waypointBorder,
                      isActive && styles.waypointActive]}
                    onPress={() => setMenuWpId(item._id)}
                    onLongPress={drag}
                    delayLongPress={200}
                  >
                    <Text style={styles.dragHandle}>⠿</Text>
                    <Text style={styles.waypointIndex}>{(getIndex() ?? 0) + 1}</Text>
                    <Text style={styles.waypointLabel} numberOfLines={1}>{item.label}</Text>
                  </TouchableOpacity>
                </ScaleDecorator>
              )}
            />
          </View>
        )}

        {/* Edit mode bar */}
        {editingWpId !== null ? (
          <View style={styles.editBar}>
            <Text style={styles.editHint}>
              {editingNewPos ? 'Zatwierdź nową pozycję' : 'Przeciągnij pinezkę na mapie'}
            </Text>
            <View style={styles.editActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={handleCancelEdit}>
                <Text style={styles.cancelBtnText}>✕</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, !editingNewPos && styles.confirmBtnDisabled]}
                onPress={handleConfirmEdit}
                disabled={reverseGeocoding}
              >
                {reverseGeocoding
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.confirmBtnText}>✓</Text>}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* Normal input bar */
          <View style={styles.inputBar}>
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
        )}
      </View>

      {/* Context menu modal */}
      <Modal
        visible={menuWp != null}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuWpId(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setMenuWpId(null)}
        >
          <View style={styles.contextMenu}>
            <Text style={styles.contextMenuTitle} numberOfLines={2}>{menuWp?.label}</Text>
            <TouchableOpacity style={styles.contextMenuItem} onPress={handleStartEdit}>
              <Text style={styles.contextMenuIcon}>✎</Text>
              <Text style={styles.contextMenuText}>Edytuj pozycję</Text>
            </TouchableOpacity>
            <View style={styles.contextMenuDivider} />
            <TouchableOpacity
              style={styles.contextMenuItem}
              onPress={() => menuWp && handleDeleteWaypoint(menuWp._id)}
            >
              <Text style={[styles.contextMenuIcon, { color: '#ef4444' }]}>✕</Text>
              <Text style={[styles.contextMenuText, { color: '#ef4444' }]}>Usuń</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const PANEL_BG = 'rgba(15,23,42,0.92)';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.7)',
    alignItems: 'center', justifyContent: 'center', zIndex: 50,
  },
  loadingText: { color: '#94a3b8', marginTop: 12, fontSize: 15 },

  topBar: {
    position: 'absolute', top: 14, left: 14, right: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 10,
  },
  roomBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: PANEL_BG, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 7 },
  dotGreen: { backgroundColor: '#22c55e' },
  dotAmber: { backgroundColor: '#f59e0b' },
  dotGray:  { backgroundColor: '#475569' },
  roomCodeText: { color: '#f1f5f9', fontSize: 15, fontWeight: '700', letterSpacing: 2 },
  topActions: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: PANEL_BG,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnText: { fontSize: 18, color: '#f1f5f9' },

  reconnectBanner: {
    position: 'absolute', top: 70, left: 14, right: 14,
    backgroundColor: '#78350f', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },
  reconnectText: { color: '#fef3c7', fontSize: 13 },

  // Bottom sheet
  bottomSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: PANEL_BG, borderTopLeftRadius: 16, borderTopRightRadius: 16,
    overflow: 'hidden', zIndex: 10,
  },
  waypointPanel: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  waypointRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 11, backgroundColor: 'transparent',
  },
  waypointBorder: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  waypointActive: { backgroundColor: 'rgba(59,130,246,0.15)' },
  dragHandle: { color: '#475569', fontSize: 16, marginRight: 8, letterSpacing: -1 },
  waypointIndex: { color: '#3b82f6', fontWeight: '700', fontSize: 13, width: 20, marginRight: 8 },
  waypointLabel: { flex: 1, color: '#e2e8f0', fontSize: 13 },

  // Edit bar
  editBar: {
    paddingHorizontal: 14, paddingTop: 14,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
  },
  editHint: { color: '#94a3b8', fontSize: 13, textAlign: 'center', marginBottom: 12 },
  editActions: { flexDirection: 'row', gap: 12 },
  cancelBtn: {
    flex: 1, backgroundColor: '#7f1d1d', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  cancelBtnText: { color: '#fca5a5', fontSize: 20, fontWeight: '700' },
  confirmBtn: {
    flex: 1, backgroundColor: '#14532d', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  confirmBtnDisabled: { backgroundColor: '#1e293b' },
  confirmBtnText: { color: '#86efac', fontSize: 20, fontWeight: '700' },

  // Input bar
  inputBar: {
    paddingHorizontal: 14, paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
  },
  inputRow: { flexDirection: 'row', gap: 8 },
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

  // Context menu modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center', padding: 40,
  },
  contextMenu: {
    backgroundColor: '#1e293b', borderRadius: 16,
    width: '100%', overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5, shadowRadius: 16, elevation: 20,
  },
  contextMenuTitle: {
    color: '#94a3b8', fontSize: 12, paddingHorizontal: 16,
    paddingTop: 14, paddingBottom: 10,
  },
  contextMenuDivider: { height: 1, backgroundColor: '#0f172a' },
  contextMenuItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  contextMenuIcon: { fontSize: 16, color: '#f1f5f9', marginRight: 12, width: 20, textAlign: 'center' },
  contextMenuText: { color: '#f1f5f9', fontSize: 15, fontWeight: '500' },
});
