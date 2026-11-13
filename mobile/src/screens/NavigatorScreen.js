import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator,
  StatusBar, Platform, Share, useWindowDimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DraggableFlatList from 'react-native-draggable-flatlist';
import { io } from 'socket.io-client';
import { BACKEND_URL } from '../config';
import { C } from '../theme';
import { searchPlaces, reverseGeocode } from '../utils/parseLocation';
import { saveSession, loadSession, clearSession, saveDraft, loadDraft } from '../utils/sessionStorage';
import { loadSettings, tileArgs } from '../utils/settings';
import { useScreenAwake } from '../utils/useScreenAwake';
import { useKeyboardInset } from '../utils/useKeyboardInset';
import { cumulative, pointAt, snapToRoute, fmtDistance } from '../utils/geo';
import { withGaps, callState, sortNotes, noteId, noteText, applyFeatures } from '../utils/pacenotes';
import { buildRoadbook, mapNotesPayload, countCorners } from '../utils/roadbook';
import { fetchRoadFeatures } from '../utils/overpass';
import { notify, confirm } from '../utils/dialogs';
import LeafletMap from '../components/LeafletMap';
import PacenoteStrip from '../components/PacenoteStrip';
import NoteEditor from '../components/NoteEditor';
import StartCountdown from '../components/StartCountdown';
import RoundButton from '../components/RoundButton';
import Icon from '../components/Icon';
import { NoteTiles } from '../components/PaceTiles';

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const NOTE_ROW_HEIGHT = 50;

export default function NavigatorScreen({ navigation }) {
  useScreenAwake();
  const insets = useSafeAreaInsets();
  const { height: winHeight } = useWindowDimensions();
  const keyboardInset = useKeyboardInset(insets.bottom);

  const socketRef = useRef(null);
  const mapRef = useRef(null);
  const listRef = useRef(null);
  const roadbookRef = useRef(null);
  const publishedIdRef = useRef(null);
  const leavingRef = useRef(false);
  const driverPosRef = useRef(null);
  const followDriverRef = useRef(false);
  const sawDriverRef = useRef(false);

  const [roomCode, setRoomCode] = useState('');
  const [online, setOnline] = useState(false);
  const [driverConnected, setDriverConnected] = useState(false);

  const [waypoints, setWaypoints] = useState([]);
  const [roadbook, setRoadbook] = useState(null);
  const [stale, setStale] = useState(false);
  const [computing, setComputing] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);

  const [tab, setTab] = useState('route');
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [pickMode, setPickMode] = useState(false);
  const [pending, setPending] = useState(null); // long-press on the route: { lat, lng, d }
  const [driverD, setDriverD] = useState(null);
  const [hasDriverPos, setHasDriverPos] = useState(false);
  const [followDriver, setFollowDriver] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [toast, setToast] = useState('');

  roadbookRef.current = roadbook;
  const cum = useMemo(() => (roadbook ? cumulative(roadbook.coords) : null), [roadbook?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const notes = useMemo(() => (roadbook ? withGaps(roadbook.notes) : []), [roadbook?.notes]); // eslint-disable-line react-hooks/exhaustive-deps
  const call = useMemo(() => (driverD != null && notes.length ? callState(notes, driverD) : undefined), [notes, driverD]);
  const editing = editingId ? notes.find((n) => n.id === editingId) : null;

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? '' : cur)), 2200);
  }, []);

  // ── Map appearance ────────────────────────────────────────────────────────
  useFocusEffect(useCallback(() => {
    loadSettings().then((s) => mapRef.current?.setTiles(...tileArgs(s)));
  }, []));

  // ── Draft: restore on start, save on every change ─────────────────────────
  useEffect(() => {
    loadDraft().then((draft) => {
      if (draft?.waypoints?.length) {
        setWaypoints(draft.waypoints);
        if (draft.roadbook) { setRoadbook(draft.roadbook); setTab('notes'); }
        setStale(!!draft.stale);
        const pts = draft.roadbook?.coords || draft.waypoints.map((w) => [w.lat, w.lng]);
        mapRef.current?.fit(pts, 80, 320);
      }
      setDraftLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!draftLoaded) return undefined;
    const timer = setTimeout(() => saveDraft(waypoints.length ? { waypoints, roadbook, stale } : null), 600);
    return () => clearTimeout(timer);
  }, [draftLoaded, waypoints, roadbook, stale]);

  // ── Room / socket ─────────────────────────────────────────────────────────
  const publish = useCallback((rb) => {
    publishedIdRef.current = rb ? rb.id : null;
    socketRef.current?.emit('set_roadbook', rb);
  }, []);

  useEffect(() => {
    let alive = true;
    const session = { roomCode: null, token: null };
    const socket = io(BACKEND_URL, {
      transports: ['websocket'], autoConnect: false, reconnectionDelay: 1500, reconnectionDelayMax: 6000,
    });
    socketRef.current = socket;

    const entered = (code, token, hasDriver) => {
      session.roomCode = code;
      session.token = token;
      setRoomCode(code);
      setOnline(true);
      setDriverConnected(hasDriver);
      saveSession({ role: 'navigator', roomCode: code, token });
      // The server may have lost or never seen our roadbook (new room, restart) — resend it.
      if (roadbookRef.current) publish(roadbookRef.current);
    };

    const createRoom = () => socket.emit('create_room', (res) => {
      if (!alive) return;
      if (res?.ok) entered(res.roomCode, res.token, false);
      else notify('Błąd', 'Nie udało się utworzyć pokoju. Spróbuj ponownie za chwilę.');
    });

    const enterRoom = () => {
      if (!session.roomCode) return createRoom();
      return socket.emit('rejoin_navigator', session, (res) => {
        if (!alive) return;
        if (res?.ok) entered(session.roomCode, session.token, res.hasDriver);
        else createRoom(); // room expired on the server — open a fresh one
      });
    };

    socket.on('connect', enterRoom);
    socket.on('disconnect', () => setOnline(false));
    socket.on('driver_joined', () => setDriverConnected(true));
    socket.on('driver_disconnected', () => setDriverConnected(false));
    socket.on('countdown', ({ seconds }) => setCountdown({ seconds, at: Date.now() }));
    socket.on('replaced', () => {
      notify('Sesja przejęta', 'Ten pokój został otwarty na innym urządzeniu.');
      leavingRef.current = true;
      navigation.goBack();
    });
    socket.on('position_update', (p) => {
      driverPosRef.current = p;
      setHasDriverPos(true);
      mapRef.current?.setDriver(p.lat, p.lng, p.heading);
      if (!sawDriverRef.current && !roadbookRef.current) mapRef.current?.panTo(p.lat, p.lng, 14);
      else if (followDriverRef.current) mapRef.current?.panTo(p.lat, p.lng, 15);
      sawDriverRef.current = true;
      if (typeof p.d === 'number' && p.routeId === roadbookRef.current?.id) {
        mapRef.current?.setProgress(p.d);
        setDriverD(Math.round(p.d / 5) * 5);
      } else {
        setDriverD(null);
      }
    });

    // Resume the previous room if this phone was the navigator there.
    loadSession().then((saved) => {
      if (!alive) return;
      if (saved?.role === 'navigator' && saved.token) { session.roomCode = saved.roomCode; session.token = saved.token; }
      socket.connect();
    });

    return () => { alive = false; socket.disconnect(); };
  }, [navigation, publish]);

  // Leaving ends the session — ask first.
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (leavingRef.current) { clearSession(); return; }
    e.preventDefault();
    confirm('Zakończyć sesję?', 'Kierowca straci połączenie z nawigatorem. Trasa i notatki zostaną zapisane na tym telefonie.', () => {
      leavingRef.current = true;
      clearSession();
      navigation.dispatch(e.data.action);
    }, 'Zakończ');
  }), [navigation]);

  // ── Keep the map and the driver in sync with local state ──────────────────
  useEffect(() => { mapRef.current?.setWaypoints(waypoints, true); }, [waypoints]);

  useEffect(() => {
    mapRef.current?.setRoute(roadbook ? roadbook.coords : []);
    setDriverD(null);
  }, [roadbook?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!roadbook || !cum) { mapRef.current?.setNotes([], [], true); return undefined; }
    mapRef.current?.setNotes(...mapNotesPayload(roadbook, cum), true);
    if (publishedIdRef.current !== roadbook.id) { publish(roadbook); return undefined; }
    const timer = setTimeout(() => {
      socketRef.current?.emit('update_notes', { routeId: roadbook.id, notes: roadbook.notes });
    }, 350);
    return () => clearTimeout(timer);
  }, [roadbook, cum, publish]);

  useEffect(() => { mapRef.current?.highlight(editingId); }, [editingId, roadbook?.notes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the note being called visible in the list while the driver is moving.
  useEffect(() => {
    if (tab !== 'notes' || editingId || collapsed || !call) return;
    listRef.current?.scrollToIndex({ index: call.index, viewPosition: 0.3, animated: true });
  }, [call?.index, tab, editingId, collapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Waypoints ─────────────────────────────────────────────────────────────
  const changeWaypoints = useCallback((updater) => {
    setWaypoints(updater);
    if (roadbookRef.current) setStale(true);
  }, []);

  const addWaypoint = useCallback((place, { first = false } = {}) => {
    const wp = { _id: uid(), lat: place.lat, lng: place.lng, label: place.label || 'Punkt' };
    changeWaypoints((prev) => (first ? [wp, ...prev] : [...prev, wp]));
    return wp;
  }, [changeWaypoints]);

  const addWaypointAt = useCallback((lat, lng) => {
    const wp = addWaypoint({ lat, lng, label: 'Punkt na mapie' });
    reverseGeocode(lat, lng).then((label) => {
      setWaypoints((prev) => prev.map((w) => (w._id === wp._id ? { ...w, label } : w)));
    });
  }, [addWaypoint]);

  const runSearch = useCallback(async () => {
    if (!query.trim() || searching) return;
    setSearching(true);
    try {
      const found = await searchPlaces(query);
      if (found.length === 0) {
        setResults([]);
      } else if (found.length === 1) {
        addWaypoint(found[0]);
        mapRef.current?.panTo(found[0].lat, found[0].lng, 13);
        setQuery(''); setResults(null);
      } else {
        setResults(found);
      }
    } catch {
      notify('Brak połączenia', 'Nie udało się wyszukać miejsca.');
    } finally {
      setSearching(false);
    }
  }, [query, searching, addWaypoint]);

  const pickResult = useCallback((place) => {
    addWaypoint(place);
    mapRef.current?.panTo(place.lat, place.lng, 13);
    setQuery(''); setResults(null);
  }, [addWaypoint]);

  // ── Route ─────────────────────────────────────────────────────────────────
  const canCompute = waypoints.length >= 2 || (waypoints.length === 1 && hasDriverPos);

  const computeRoute = useCallback(async () => {
    let pts = waypoints;
    if (pts.length === 1 && driverPosRef.current) {
      // One destination only: start from wherever the driver is right now.
      const p = driverPosRef.current;
      const start = { _id: uid(), lat: p.lat, lng: p.lng, label: 'Pozycja kierowcy' };
      pts = [start, ...pts];
      setWaypoints(pts);
    }
    if (pts.length < 2) return;
    setComputing(true);
    try {
      const rb = await buildRoadbook(pts, roadbookRef.current);
      setRoadbook(rb);
      setStale(false);
      setEditingId(null);
      setTab('notes');
      mapRef.current?.fit(rb.coords, 80, Math.round(winHeight * 0.45));

      // Bridges, tunnels and level crossings arrive a moment later, if at all.
      const rbCum = cumulative(rb.coords);
      fetchRoadFeatures(rb.coords, rbCum).then((features) => {
        if (!features.length) return;
        setRoadbook((cur) => (cur && cur.id === rb.id
          ? { ...cur, notes: applyFeatures(cur.notes, features, rb.coords, rbCum) } : cur));
      });
    } catch (err) {
      notify('Nie udało się wyznaczyć trasy', err?.message || 'Sprawdź połączenie z internetem.');
    } finally {
      setComputing(false);
    }
  }, [waypoints, winHeight]);

  const clearAll = useCallback(() => {
    confirm('Wyczyścić trasę?', 'Usunie wszystkie punkty i notatki.', () => {
      setWaypoints([]); setRoadbook(null); setStale(false); setEditingId(null); setTab('route');
      publish(null);
    }, 'Wyczyść');
  }, [publish]);

  // ── Notes ─────────────────────────────────────────────────────────────────
  const openNote = useCallback((id, focus = true) => {
    const note = roadbookRef.current?.notes.find((n) => n.id === id);
    if (!note) return;
    setTab('notes'); setCollapsed(false); setPickMode(false); setEditingId(id);
    if (focus) mapRef.current?.setView(note.lat, note.lng, 17);
  }, []);

  const patchNote = useCallback((id, patch) => {
    setRoadbook((rb) => rb && ({
      ...rb,
      notes: sortNotes(rb.notes.map((n) => (n.id === id ? { ...n, ...patch, auto: false } : n))),
    }));
  }, []);

  const moveNote = useCallback((id, delta) => {
    const rb = roadbookRef.current;
    const note = rb?.notes.find((n) => n.id === id);
    if (!note || !cum) return;
    const d = Math.max(0, Math.min(rb.distance, note.d + delta));
    const p = pointAt(rb.coords, cum, d);
    patchNote(id, { d, end: d + (note.end - note.d), lat: p[0], lng: p[1] });
    mapRef.current?.setView(p[0], p[1]);
  }, [cum, patchNote]);

  const deleteNote = useCallback((id) => {
    setEditingId(null);
    setRoadbook((rb) => rb && ({ ...rb, notes: rb.notes.filter((n) => n.id !== id) }));
  }, []);

  const addNoteAt = useCallback((d) => {
    const rb = roadbookRef.current;
    if (!rb || !cum) return;
    const p = pointAt(rb.coords, cum, d);
    const note = {
      id: noteId(), kind: 'info', d, end: d, lat: p[0], lng: p[1],
      mods: [], tags: ['caution'], text: '', auto: false,
    };
    setRoadbook({ ...rb, notes: sortNotes([...rb.notes, note]) });
    setTab('notes'); setCollapsed(false); setPickMode(false); setEditingId(note.id);
    mapRef.current?.setView(p[0], p[1], 17);
  }, [cum]);

  // ── Map events ────────────────────────────────────────────────────────────
  const onMapMessage = useCallback((msg) => {
    const rb = roadbookRef.current;
    const snap = rb && cum && msg.lat != null ? snapToRoute(rb.coords, cum, [msg.lat, msg.lng]) : null;

    if (msg.t === 'noteClick') {
      openNote(msg.id, false);
    } else if (msg.t === 'waypointMoved') {
      changeWaypoints((prev) => prev.map((w, i) => (i === msg.index ? { ...w, lat: msg.lat, lng: msg.lng } : w)));
      reverseGeocode(msg.lat, msg.lng).then((label) => {
        setWaypoints((prev) => prev.map((w, i) => (i === msg.index ? { ...w, label } : w)));
      });
    } else if (msg.t === 'waypointClick') {
      setTab('route'); setCollapsed(false); setEditingId(null);
    } else if (msg.t === 'mapClick') {
      if (!pickMode) return;
      if (snap && snap.off < 80) addNoteAt(snap.d);
      else showToast('Dotknij bliżej trasy');
    } else if (msg.t === 'mapLongPress') {
      if (snap && snap.off < 40) setPending({ lat: msg.lat, lng: msg.lng, d: snap.d });
      else addWaypointAt(msg.lat, msg.lng);
    }
  }, [cum, pickMode, openNote, changeWaypoints, addNoteAt, addWaypointAt, showToast]);

  // ── Top bar actions ───────────────────────────────────────────────────────
  const shareCode = useCallback(async () => {
    if (!roomCode) return;
    try {
      if (Platform.OS === 'web') {
        await navigator.clipboard.writeText(roomCode);
        showToast('Skopiowano kod pokoju');
      } else {
        await Share.share({ message: `Kod pokoju RallyPair: ${roomCode}` });
      }
    } catch {}
  }, [roomCode, showToast]);

  const fitRoute = useCallback(() => {
    followDriverRef.current = false; setFollowDriver(false);
    const pts = roadbookRef.current?.coords || waypoints.map((w) => [w.lat, w.lng]);
    if (pts.length) mapRef.current?.fit(pts, 80, Math.round(winHeight * 0.45));
  }, [waypoints, winHeight]);

  const toggleFollow = useCallback(() => {
    const next = !followDriverRef.current;
    followDriverRef.current = next; setFollowDriver(next);
    const p = driverPosRef.current;
    if (next && p) mapRef.current?.panTo(p.lat, p.lng, 15);
    else if (next) showToast('Czekam na pozycję kierowcy');
  }, [showToast]);

  const startCountdown = useCallback(() => {
    if (!driverConnected) { showToast('Kierowca nie jest połączony'); return; }
    socketRef.current?.emit('start_countdown', { seconds: 5 });
  }, [driverConnected, showToast]);

  // ── Render ────────────────────────────────────────────────────────────────
  const listHeight = Math.round(winHeight * 0.3);
  const statusColor = !online ? C.amber : driverConnected ? C.green : C.faint;
  const statusText = !online ? 'Łączenie…' : driverConnected ? 'Kierowca online' : 'Podaj kod kierowcy';

  const renderWaypoint = useCallback(({ item, drag, isActive, getIndex }) => {
    const i = getIndex() ?? 0;
    const last = i === waypoints.length - 1 && waypoints.length > 1;
    return (
      <View style={[styles.wpRow, isActive && styles.wpActive]}>
        <TouchableOpacity onPressIn={drag} style={styles.wpHandle} accessibilityLabel="Przeciągnij, aby zmienić kolejność">
          <Icon name="drag" size={18} color={C.faint} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.wpMain} onPress={() => mapRef.current?.setView(item.lat, item.lng, 15)}>
          <View style={[styles.wpBadge, { backgroundColor: i === 0 ? '#16a34a' : last ? '#dc2626' : '#2563eb' }]}>
            <Text style={styles.wpBadgeText}>{i === 0 ? 'S' : last ? 'M' : i}</Text>
          </View>
          <Text style={styles.wpLabel} numberOfLines={1}>{item.label}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.wpDelete}
          onPress={() => changeWaypoints((prev) => prev.filter((w) => w._id !== item._id))}
          accessibilityLabel={`Usuń punkt ${item.label}`}
        >
          <Icon name="close" size={18} color={C.dim} />
        </TouchableOpacity>
      </View>
    );
  }, [waypoints.length, changeWaypoints]);

  const renderNote = useCallback(({ item, index }) => {
    const current = call && call.index === index;
    const passed = call ? index < call.index : call === null;
    return (
      <TouchableOpacity
        style={[styles.noteRow, current && styles.noteCurrent]}
        onPress={() => openNote(item.id)}
        accessibilityLabel={noteText(item)}
      >
        <Text style={[styles.noteKm, passed && styles.passed]}>{(item.d / 1000).toFixed(2)}</Text>
        <View style={passed && styles.passed}><NoteTiles note={item} size={34} max={5} gap={3} /></View>
        {!!item.text && <Text style={styles.noteCaption} numberOfLines={1}>{item.text}</Text>}
        {!item.auto && <View style={styles.editedDot} />}
      </TouchableOpacity>
    );
  }, [call, openNote]);

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <LeafletMap ref={mapRef} style={StyleSheet.absoluteFill} onMapMessage={onMapMessage} />

      {/* Top bar */}
      <View style={[styles.topBar, { top: insets.top + 10 }]} pointerEvents="box-none">
        <RoundButton icon="back" label="Zakończ sesję" onPress={() => navigation.goBack()} />
        <TouchableOpacity style={styles.roomChip} onPress={shareCode} accessibilityLabel={`Kod pokoju ${roomCode}. ${statusText}`}>
          <View style={[styles.dot, { backgroundColor: statusColor }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.roomCode}>{roomCode || '······'}</Text>
            <Text style={styles.roomStatus} numberOfLines={1}>{statusText}</Text>
          </View>
          <Icon name="copy" size={16} color={C.faint} />
        </TouchableOpacity>
        <RoundButton icon="route" label="Pokaż całą trasę" onPress={fitRoute} />
        <RoundButton icon="car" label="Śledź kierowcę" active={followDriver} onPress={toggleFollow} />
        <RoundButton icon="settings" label="Ustawienia" onPress={() => navigation.navigate('Settings')} />
      </View>

      {/* What the driver sees right now */}
      {roadbook && call !== undefined && !pickMode && (
        <PacenoteStrip
          notes={notes}
          call={call}
          remaining={roadbook.distance - driverD}
          size="sm"
          style={[styles.strip, { top: insets.top + 64 }]}
        />
      )}

      {pickMode && (
        <View style={[styles.hintBar, { top: insets.top + 64 }]}>
          <Text style={styles.hintBarText}>Dotknij trasy w miejscu nowej notatki</Text>
          <TouchableOpacity onPress={() => setPickMode(false)} hitSlop={10}><Icon name="close" size={18} color={C.accentInk} /></TouchableOpacity>
        </View>
      )}

      {!!toast && (
        <View style={[styles.toast, { top: insets.top + 64 }]} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {/* Bottom sheet — always pinned to the bottom edge, lifted only while the keyboard is open */}
      <View style={[styles.sheetWrap, { bottom: keyboardInset }]} pointerEvents="box-none">
        <View style={[styles.sheet, { paddingBottom: keyboardInset ? 10 : insets.bottom + 10 }]}>
          {!pending && (
            <TouchableOpacity
              style={styles.grabber}
              onPress={() => setCollapsed((c) => !c)}
              hitSlop={{ top: 8, bottom: 4 }}
              accessibilityLabel={collapsed ? 'Rozwiń panel' : 'Schowaj panel'}
            >
              <View style={styles.grabberBar} />
            </TouchableOpacity>
          )}
          {pending ? (
            <View style={styles.pending}>
              <Text style={styles.pendingTitle}>Co dodać w tym miejscu?</Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => { addNoteAt(pending.d); setPending(null); }}>
                <Text style={styles.primaryText}>Notatkę dla kierowcy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => { addWaypointAt(pending.lat, pending.lng); setPending(null); }}>
                <Text style={styles.secondaryText}>Punkt trasy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.textBtn} onPress={() => setPending(null)}>
                <Text style={styles.textBtnText}>Anuluj</Text>
              </TouchableOpacity>
            </View>
          ) : editing ? (
            <NoteEditor
              note={editing}
              onChange={(patch) => patchNote(editing.id, patch)}
              onMove={(delta) => moveNote(editing.id, delta)}
              onDelete={() => deleteNote(editing.id)}
              onClose={() => setEditingId(null)}
              collapsed={collapsed}
              onToggleCollapse={() => setCollapsed((c) => !c)}
            />
          ) : (
            <>
              <View style={styles.tabs}>
                {[['route', 'Trasa'], ['notes', roadbook ? `Notatki · ${roadbook.notes.length}` : 'Notatki']].map(([key, label]) => (
                  <TouchableOpacity
                    key={key}
                    style={[styles.tab, tab === key && !collapsed && styles.tabOn]}
                    onPress={() => { setTab(key); setCollapsed(false); }}
                  >
                    <Text style={[styles.tabText, tab === key && !collapsed && styles.tabTextOn]}>{label}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={styles.collapse}
                  onPress={() => setCollapsed((c) => !c)}
                  accessibilityLabel={collapsed ? 'Rozwiń panel' : 'Zwiń panel'}
                >
                  <Icon name={collapsed ? 'chevUp' : 'chevDown'} color={C.dim} />
                </TouchableOpacity>
              </View>

              {!collapsed && tab === 'route' && (
                <View style={styles.pane}>
                  <View style={styles.searchRow}>
                    <TextInput
                      style={styles.input}
                      placeholder="Adres, współrzędne lub link do mapy"
                      placeholderTextColor={C.faint}
                      value={query}
                      onChangeText={(t) => { setQuery(t); setResults(null); }}
                      onSubmitEditing={runSearch}
                      returnKeyType="search"
                      autoCorrect={false}
                    />
                    <TouchableOpacity style={styles.searchBtn} onPress={runSearch} disabled={searching} accessibilityLabel="Szukaj">
                      {searching ? <ActivityIndicator size="small" color={C.text} /> : <Icon name="search" />}
                    </TouchableOpacity>
                  </View>

                  {results && (results.length === 0
                    ? <Text style={styles.empty}>Nic nie znaleziono. Spróbuj inaczej albo przytrzymaj palec na mapie.</Text>
                    : results.map((r, i) => (
                      <TouchableOpacity key={i} style={styles.resultRow} onPress={() => pickResult(r)}>
                        <Icon name="plus" size={16} color={C.accent} />
                        <Text style={styles.resultText} numberOfLines={1}>{r.label}</Text>
                      </TouchableOpacity>
                    )))}

                  {!results && waypoints.length === 0 && (
                    <Text style={styles.empty}>
                      Dodaj start i metę: wyszukaj miejsce albo przytrzymaj palec na mapie. Zakręty wykryją się same.
                    </Text>
                  )}

                  {!results && waypoints.length > 0 && (
                    <DraggableFlatList
                      data={waypoints}
                      keyExtractor={(item) => item._id}
                      onDragEnd={({ data }) => changeWaypoints(data)}
                      renderItem={renderWaypoint}
                      style={{ maxHeight: listHeight - 60 }}
                    />
                  )}

                  {!results && waypoints.length > 0 && (
                    <View style={styles.actions}>
                      <TouchableOpacity style={styles.ghostBtn} onPress={clearAll} accessibilityLabel="Wyczyść trasę">
                        <Icon name="trash" size={20} color={C.dim} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.primaryBtn, styles.flex, (!canCompute || (roadbook && !stale)) && styles.disabled]}
                        onPress={computeRoute}
                        disabled={!canCompute || computing || (!!roadbook && !stale)}
                      >
                        {computing
                          ? <ActivityIndicator size="small" color={C.accentInk} />
                          : (
                            <Text style={styles.primaryText}>
                              {!canCompute ? 'Dodaj jeszcze metę' : !roadbook ? 'Wyznacz trasę' : stale ? 'Przelicz trasę' : 'Trasa aktualna'}
                            </Text>
                          )}
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}

              {!collapsed && tab === 'notes' && (
                <View style={styles.pane}>
                  {!roadbook ? (
                    <Text style={styles.empty}>Najpierw wyznacz trasę w zakładce „Trasa” — notatki powstaną automatycznie, a potem poprawisz je tutaj.</Text>
                  ) : (
                    <>
                      <View style={styles.summary}>
                        <View style={styles.flex}>
                          <Text style={styles.summaryMain}>{fmtDistance(roadbook.distance)} · {countCorners(roadbook.notes)} zakrętów</Text>
                          <Text style={styles.summarySub}>
                            {stale ? 'Punkty zmienione — przelicz trasę' : driverConnected ? 'Kierowca widzi zmiany na żywo' : 'Kierowca dostanie trasę po dołączeniu'}
                          </Text>
                        </View>
                        <TouchableOpacity style={styles.chipBtn} onPress={() => { setPickMode(true); setCollapsed(true); }}>
                          <Icon name="plus" size={16} color={C.text} />
                          <Text style={styles.chipText}>Notatka</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.chipBtn, styles.chipStart]} onPress={startCountdown}>
                          <Icon name="flag" size={16} color={C.accentInk} />
                          <Text style={[styles.chipText, { color: C.accentInk }]}>Start</Text>
                        </TouchableOpacity>
                      </View>
                      <FlatList
                        ref={listRef}
                        data={notes}
                        keyExtractor={(item) => item.id}
                        renderItem={renderNote}
                        style={{ height: listHeight }}
                        getItemLayout={(_, index) => ({ length: NOTE_ROW_HEIGHT, offset: NOTE_ROW_HEIGHT * index, index })}
                        initialNumToRender={12}
                        keyboardShouldPersistTaps="handled"
                      />
                    </>
                  )}
                </View>
              )}
            </>
          )}
        </View>
      </View>

      <StartCountdown start={countdown} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },

  topBar: { position: 'absolute', left: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 10 },
  roomChip: {
    flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', gap: 9,
    backgroundColor: C.panel, borderRadius: 22, paddingHorizontal: 14, borderWidth: 1, borderColor: C.line,
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
  roomCode: { color: C.text, fontSize: 15, fontWeight: '800', letterSpacing: 2.5, lineHeight: 18 },
  roomStatus: { color: C.dim, fontSize: 10.5, lineHeight: 13 },

  strip: { position: 'absolute', left: 10, right: 10, zIndex: 9 },
  hintBar: {
    position: 'absolute', left: 10, right: 10, zIndex: 11, backgroundColor: C.accent, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  hintBarText: { flex: 1, color: C.accentInk, fontSize: 14, fontWeight: '700' },
  toast: {
    position: 'absolute', alignSelf: 'center', zIndex: 20, backgroundColor: C.text,
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 9,
  },
  toastText: { color: C.accentInk, fontSize: 13, fontWeight: '700' },

  sheetWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 12 },
  sheet: {
    backgroundColor: C.panelSolid, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    borderTopWidth: 1, borderColor: C.line,
  },
  grabber: { alignItems: 'center', paddingTop: 7, paddingBottom: 1 },
  grabberBar: { width: 38, height: 4, borderRadius: 2, backgroundColor: C.faint },
  tabs: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingTop: 2, gap: 6 },
  tab: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 18 },
  tabOn: { backgroundColor: C.raised },
  tabText: { color: C.dim, fontSize: 14, fontWeight: '700' },
  tabTextOn: { color: C.text },
  collapse: { marginLeft: 'auto', width: 44, height: 38, alignItems: 'center', justifyContent: 'center' },
  pane: { paddingTop: 8 },

  searchRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12 },
  input: {
    flex: 1, backgroundColor: C.raised, borderRadius: 12, color: C.text,
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 13 : 10, fontSize: 15,
  },
  searchBtn: { width: 48, borderRadius: 12, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' },
  empty: { color: C.dim, fontSize: 13.5, lineHeight: 19, paddingHorizontal: 16, paddingVertical: 14 },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  resultText: { flex: 1, color: C.text, fontSize: 14 },

  wpRow: { flexDirection: 'row', alignItems: 'center', height: 48, backgroundColor: C.panelSolid },
  wpActive: { backgroundColor: C.raised },
  wpHandle: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  wpMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 48 },
  wpBadge: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  wpBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  wpLabel: { flex: 1, color: C.text, fontSize: 14 },
  wpDelete: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },

  actions: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 8 },
  primaryBtn: { backgroundColor: C.accent, borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primaryText: { color: C.accentInk, fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.4 },
  ghostBtn: { width: 48, height: 48, borderRadius: 12, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' },
  secondaryBtn: { backgroundColor: C.raised, borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: C.text, fontSize: 15, fontWeight: '700' },
  textBtn: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  textBtnText: { color: C.dim, fontSize: 14, fontWeight: '600' },
  pending: { padding: 14, gap: 8 },
  pendingTitle: { color: C.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },

  summary: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 8 },
  summaryMain: { color: C.text, fontSize: 14, fontWeight: '700' },
  summarySub: { color: C.dim, fontSize: 11.5, marginTop: 1 },
  chipBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, height: 38, paddingHorizontal: 12,
    borderRadius: 19, backgroundColor: C.raised,
  },
  chipStart: { backgroundColor: C.accent },
  chipText: { color: C.text, fontSize: 13, fontWeight: '700' },

  noteRow: {
    height: NOTE_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14,
    borderTopWidth: 1, borderTopColor: C.line,
  },
  noteCurrent: { backgroundColor: C.raised },
  noteKm: { width: 40, color: C.dim, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  noteCaption: { flex: 1, color: C.dim, fontSize: 12.5 },
  editedDot: { marginLeft: 'auto', width: 7, height: 7, borderRadius: 4, backgroundColor: C.accent },
  passed: { opacity: 0.35 },
});
