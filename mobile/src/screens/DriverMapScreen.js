import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, StatusBar, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import LeafletMap from '../components/LeafletMap';
import PacenoteStrip from '../components/PacenoteStrip';
import StartCountdown from '../components/StartCountdown';
import RoundButton from '../components/RoundButton';
import { C } from '../theme';
import { socketStore } from '../socketStore';
import { clearSession } from '../utils/sessionStorage';
import { loadSettings, saveSettings, getCachedSettings, tileArgs } from '../utils/settings';
import { useScreenAwake } from '../utils/useScreenAwake';
import { cumulative, snapToRoute, pointAt, bearingAt, angDiff } from '../utils/geo';
import { withGaps, callState } from '../utils/pacenotes';
import { mapNotesPayload } from '../utils/roadbook';
import { notify, confirm } from '../utils/dialogs';

const NAV_ZOOM = 17;
const ON_ROUTE_M = 40;     // further than this from the route = off route
const SNAP_M = 25;         // within this, the car is drawn exactly on the route
const SEND_INTERVAL_MS = 1000;

export default function DriverMapScreen({ navigation, route }) {
  useScreenAwake();
  const { roomCode } = route.params;
  const insets = useSafeAreaInsets();
  const socket = socketStore.getDriver();

  const mapRef = useRef(null);
  const stageRef = useRef(null);       // { rb, cum, notes } for the current roadbook
  const fixRef = useRef(null);         // last raw GPS fix
  const compassRef = useRef(null);
  const headingRef = useRef(0);
  const progressRef = useRef(null);
  const drawnProgressRef = useRef(-100);
  const lastSentRef = useRef(0);
  const lastCompassDrawRef = useRef(0);
  const modeRef = useRef('follow');    // follow | free | overview
  const headingUpRef = useRef(getCachedSettings().headingUp);
  const leavingRef = useRef(false);

  const [roadbook, setRoadbook] = useState(null);
  const [progress, setProgress] = useState(null);
  const [offRoute, setOffRoute] = useState(false);
  const [gps, setGps] = useState('waiting'); // waiting | ok | denied
  const [online, setOnline] = useState(socket?.connected ?? false);
  const [navigatorOnline, setNavigatorOnline] = useState(true);
  const [mode, setModeState] = useState('follow');
  const [headingUp, setHeadingUp] = useState(headingUpRef.current);
  const [tilt, setTilt] = useState(getCachedSettings().tilt);
  const [countdown, setCountdown] = useState(null);

  const notes = useMemo(() => (roadbook ? withGaps(roadbook.notes) : []), [roadbook?.notes]); // eslint-disable-line react-hooks/exhaustive-deps
  const call = useMemo(() => (progress != null && notes.length ? callState(notes, progress) : undefined), [notes, progress]);

  const setMode = useCallback((next) => { modeRef.current = next; setModeState(next); }, []);

  // ── Position handling ─────────────────────────────────────────────────────
  // Works out where the car is on the stage, moves the map and tells the navigator.
  const processFix = useCallback((force = false) => {
    const fix = fixRef.current;
    if (!fix) return;
    const stage = stageRef.current;
    const moving = (fix.speed ?? 0) > 1.5;
    let heading = headingRef.current;
    if (moving && fix.course != null && fix.course >= 0) heading = fix.course;
    else if (!moving && compassRef.current != null) heading = compassRef.current;

    let shown = [fix.lat, fix.lng];
    let d = null;
    if (stage) {
      const snap = snapToRoute(stage.rb.coords, stage.cum, shown, progressRef.current);
      if (snap.off <= ON_ROUTE_M) {
        d = snap.d;
        if (snap.off <= SNAP_M) shown = pointAt(stage.rb.coords, stage.cum, d);
        // The road's own direction is steadier than GPS course or a compass in a car.
        heading = bearingAt(stage.rb.coords, stage.cum, Math.min(d + 6, stage.rb.distance));
      }
      setOffRoute(snap.off > ON_ROUTE_M);
    }
    headingRef.current = heading;
    progressRef.current = d;

    if (modeRef.current === 'follow') mapRef.current?.follow(shown[0], shown[1], heading, NAV_ZOOM, headingUpRef.current);
    else mapRef.current?.setDriver(shown[0], shown[1], heading);

    if (d != null) {
      if (force || Math.abs(d - drawnProgressRef.current) >= 4) {
        drawnProgressRef.current = d;
        mapRef.current?.setProgress(d);
      }
      setProgress(Math.round(d / 5) * 5);
    } else {
      setProgress(null);
    }

    const now = Date.now();
    if (force || now - lastSentRef.current >= SEND_INTERVAL_MS) {
      lastSentRef.current = now;
      socket?.volatile.emit('send_position', {
        lat: shown[0], lng: shown[1], heading: Math.round(heading), d,
        routeId: stage ? stage.rb.id : null,
      });
    }
  }, [socket]);

  useEffect(() => {
    let active = true;
    let positionSub = null;
    let headingSub = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync().catch(() => ({ status: 'denied' }));
      if (!active) return;
      if (status !== 'granted') { setGps('denied'); return; }

      try {
        positionSub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 },
          (loc) => {
            if (!active) return;
            fixRef.current = {
              lat: loc.coords.latitude, lng: loc.coords.longitude,
              speed: loc.coords.speed, course: loc.coords.heading,
            };
            setGps('ok');
            processFix();
          },
        );
      } catch {
        if (active) setGps('denied');
      }

      // Compass: only used while standing still away from the route. Not available on web.
      try {
        headingSub = await Location.watchHeadingAsync((h) => {
          const value = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (!(value >= 0)) return;
          compassRef.current = value;
          const fix = fixRef.current;
          const now = Date.now();
          if (!fix || (fix.speed ?? 0) > 1.5 || progressRef.current != null) return;
          if (now - lastCompassDrawRef.current < 300 || Math.abs(angDiff(headingRef.current, value)) < 4) return;
          lastCompassDrawRef.current = now;
          processFix();
        });
      } catch {}
      if (!active) { positionSub?.remove(); headingSub?.remove(); }
    })();

    return () => { active = false; positionSub?.remove(); headingSub?.remove(); };
  }, [processFix]);

  // ── Roadbook from the navigator ───────────────────────────────────────────
  const drawNotes = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) { mapRef.current?.setNotes([], [], false); return; }
    const markers = getCachedSettings().driverMarkers;
    mapRef.current?.setNotes(...mapNotesPayload(stage.rb, stage.cum, { markers }), false);
  }, []);

  const applyRoadbook = useCallback((rb) => {
    const previousId = stageRef.current?.rb.id;
    if (!rb) {
      stageRef.current = null;
      progressRef.current = null;
      mapRef.current?.setRoute([]);
      drawNotes();
      setRoadbook(null); setProgress(null); setOffRoute(false);
      return;
    }
    const sameRoute = previousId === rb.id;
    stageRef.current = { rb, cum: sameRoute ? stageRef.current.cum : cumulative(rb.coords) };
    if (!sameRoute) {
      progressRef.current = null;
      drawnProgressRef.current = -100;
      mapRef.current?.setRoute(rb.coords);
    }
    drawNotes();
    setRoadbook(rb);
    if (fixRef.current) processFix(true);
    else if (!sameRoute) mapRef.current?.fit(rb.coords, 80, 200); // no GPS yet: show the stage until the first fix
  }, [drawNotes, processFix]);

  useEffect(() => {
    if (!socket) { notify('Brak połączenia', 'Wróć i dołącz do pokoju ponownie.'); return undefined; }

    const leave = (title, message) => {
      if (leavingRef.current) return;
      leavingRef.current = true;
      clearSession();
      notify(title, message);
      navigation.goBack();
    };

    // Joining returns the current roadbook, so the same call covers first entry and reconnects.
    const join = () => socket.emit('join_room', { roomCode }, (res) => {
      if (!res?.ok) { leave('Sesja wygasła', 'Pokój już nie istnieje. Poproś nawigatora o nowy kod.'); return; }
      setOnline(true);
      setNavigatorOnline(res.hasNavigator);
      applyRoadbook(res.roadbook);
    });

    const onRoadbook = (rb) => {
      const isNew = rb && rb.id !== stageRef.current?.rb.id;
      applyRoadbook(rb);
      if (isNew) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    };
    const onNotes = ({ routeId, notes: next }) => {
      const stage = stageRef.current;
      if (stage && stage.rb.id === routeId) applyRoadbook({ ...stage.rb, notes: next });
    };
    const onCountdown = ({ seconds }) => setCountdown({ seconds, at: Date.now() });
    const onDisconnect = () => setOnline(false);
    const onNavGone = () => setNavigatorOnline(false);
    const onNavBack = () => setNavigatorOnline(true);
    const onClosed = () => leave('Rozłączono', 'Sesja wygasła z powodu braku aktywności.');
    const onReplaced = () => leave('Sesja przejęta', 'Do tego pokoju dołączył inny kierowca.');

    socket.on('connect', join);
    socket.on('disconnect', onDisconnect);
    socket.on('roadbook', onRoadbook);
    socket.on('notes_update', onNotes);
    socket.on('countdown', onCountdown);
    socket.on('navigator_reconnecting', onNavGone);
    socket.on('navigator_rejoined', onNavBack);
    socket.on('room_closed', onClosed);
    socket.on('replaced', onReplaced);
    if (socket.connected) join();

    return () => {
      socket.off('connect', join);
      socket.off('disconnect', onDisconnect);
      socket.off('roadbook', onRoadbook);
      socket.off('notes_update', onNotes);
      socket.off('countdown', onCountdown);
      socket.off('navigator_reconnecting', onNavGone);
      socket.off('navigator_rejoined', onNavBack);
      socket.off('room_closed', onClosed);
      socket.off('replaced', onReplaced);
      socket.disconnect();
      socketStore.clearDriver();
    };
  }, [socket, roomCode, navigation, applyRoadbook]);

  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (leavingRef.current) return;
    e.preventDefault();
    confirm('Opuścić sesję?', 'Przestaniesz widzieć trasę i notatki nawigatora.', () => {
      leavingRef.current = true;
      clearSession();
      navigation.dispatch(e.data.action);
    }, 'Opuść');
  }), [navigation]);

  // ── Settings (re-read whenever the screen regains focus) ──────────────────
  useFocusEffect(useCallback(() => {
    loadSettings().then((s) => {
      mapRef.current?.setTiles(...tileArgs(s));
      mapRef.current?.setTilt(s.tilt);
      headingUpRef.current = s.headingUp;
      setHeadingUp(s.headingUp); setTilt(s.tilt);
      drawNotes();
      processFix(true);
    });
  }, [drawNotes, processFix]));

  // ── Controls ──────────────────────────────────────────────────────────────
  const recenter = useCallback(() => { setMode('follow'); processFix(true); }, [setMode, processFix]);

  const toggleOverview = useCallback(() => {
    if (modeRef.current === 'overview') { recenter(); return; }
    const stage = stageRef.current;
    if (!stage) return;
    setMode('overview');
    mapRef.current?.fit(stage.rb.coords, 80, 220);
  }, [recenter, setMode]);

  const toggleHeadingUp = useCallback(() => {
    const next = !headingUpRef.current;
    headingUpRef.current = next; setHeadingUp(next);
    saveSettings({ headingUp: next });
    recenter();
  }, [recenter]);

  const toggleTilt = useCallback(() => {
    setTilt((cur) => {
      saveSettings({ tilt: !cur });
      mapRef.current?.setTilt(!cur);
      return !cur;
    });
  }, []);

  const onMapMessage = useCallback((msg) => {
    if (msg.t === 'userPan') setMode('free');
  }, [setMode]);

  // ── Render ────────────────────────────────────────────────────────────────
  let status = null;
  if (!online) status = { text: 'Przywracanie połączenia…', busy: true, tone: C.amber };
  else if (gps === 'denied') status = { text: 'Brak dostępu do lokalizacji — włącz ją w ustawieniach telefonu', tone: C.red };
  else if (gps === 'waiting') status = { text: 'Szukam sygnału GPS…', busy: true, tone: C.dim };
  else if (!roadbook) status = { text: 'Czekam na trasę od nawigatora…', tone: C.dim };
  else if (offRoute) status = { text: 'Poza trasą', tone: C.red };
  else if (!navigatorOnline) status = { text: 'Nawigator rozłączony', tone: C.amber };

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <LeafletMap ref={mapRef} style={StyleSheet.absoluteFill} onMapMessage={onMapMessage} />

      <View style={[styles.topLeft, { top: insets.top + 10 }]}>
        <RoundButton icon="back" label="Opuść sesję" onPress={() => navigation.goBack()} />
        <View style={styles.roomChip}>
          <View style={[styles.dot, { backgroundColor: online ? C.green : C.amber }]} />
          <Text style={styles.roomCode}>{roomCode}</Text>
        </View>
      </View>

      <View style={[styles.topRight, { top: insets.top + 10 }]}>
        <RoundButton icon="route" label="Cała trasa" active={mode === 'overview'} onPress={toggleOverview} />
        <RoundButton icon="north" label="Mapa zgodnie z kierunkiem jazdy" active={headingUp} onPress={toggleHeadingUp} />
        <RoundButton icon="cube" label="Widok 3D" active={tilt} onPress={toggleTilt} />
        <RoundButton icon="settings" label="Ustawienia" onPress={() => navigation.navigate('Settings')} />
      </View>

      {status && (
        <View style={[styles.status, { top: insets.top + 64 }]}>
          {status.busy && <ActivityIndicator size="small" color={status.tone} />}
          <Text style={[styles.statusText, { color: status.tone }]}>{status.text}</Text>
        </View>
      )}

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 10 }]} pointerEvents="box-none">
        {mode !== 'follow' && gps === 'ok' && (
          <RoundButton icon="locate" label="Wróć do jazdy" active size={52} style={styles.recenter} onPress={recenter} />
        )}
        {roadbook && call !== undefined && (
          <PacenoteStrip notes={notes} call={call} remaining={roadbook.distance - progress} size="lg" />
        )}
      </View>

      <StartCountdown start={countdown} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  topLeft: { position: 'absolute', left: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  topRight: { position: 'absolute', right: 10, gap: 8 },
  roomChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7, height: 34, paddingHorizontal: 12,
    backgroundColor: C.panel, borderRadius: 17, borderWidth: 1, borderColor: C.line,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  roomCode: { color: C.dim, fontSize: 13, fontWeight: '700', letterSpacing: 1.5 },

  status: {
    position: 'absolute', left: 10, right: 64, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.panel, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: C.line,
  },
  statusText: { flex: 1, fontSize: 14, fontWeight: '700' },

  bottom: { position: 'absolute', left: 10, right: 10, bottom: 0 },
  recenter: { alignSelf: 'flex-end', marginBottom: 10 },
});
