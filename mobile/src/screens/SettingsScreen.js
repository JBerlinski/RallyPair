import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch, ScrollView } from 'react-native';
import { TILE_PROVIDERS, loadSettings, saveSettings } from '../utils/settings';
import { C } from '../theme';

function Toggle({ label, hint, value, onChange, first }) {
  return (
    <View style={[styles.row, !first && styles.rowBorder]}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {!!hint && <Text style={styles.rowHint}>{hint}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#343a46', true: C.accent }}
        thumbColor={C.text}
        accessibilityLabel={label}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const [s, setS] = useState(null);

  useEffect(() => { loadSettings().then((loaded) => setS({ ...loaded })); }, []);

  const update = useCallback((patch) => {
    setS((prev) => ({ ...prev, ...patch }));
    saveSettings(patch);
  }, []);

  if (!s) return <View style={styles.container} />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Styl mapy</Text>
      <View style={styles.card}>
        {TILE_PROVIDERS.map((p, i) => {
          const selected = s.tileProvider === p.id;
          return (
            <TouchableOpacity
              key={p.id}
              style={[styles.row, i > 0 && styles.rowBorder]}
              onPress={() => update({ tileProvider: p.id })}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <View style={[styles.radioOuter, selected && styles.radioSelected]}>
                {selected && <View style={styles.radioInner} />}
              </View>
              <Text style={styles.rowLabel}>{p.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.sectionTitle}>Kierowca</Text>
      <View style={styles.card}>
        <Toggle
          first
          label="Mapa zgodnie z kierunkiem jazdy"
          hint="Droga przed autem jest zawsze u góry ekranu"
          value={s.headingUp}
          onChange={(v) => update({ headingUp: v })}
        />
        <Toggle
          label="Widok 3D"
          hint="Mapa pochylona jak w nawigacji samochodowej"
          value={s.tilt}
          onChange={(v) => update({ tilt: v })}
        />
        <Toggle
          label="Ikony notatek na mapie"
          hint="Strzałki i ostrzeżenia przy zakrętach"
          value={s.driverMarkers}
          onChange={(v) => update({ driverMarkers: v })}
        />
      </View>

      <Text style={styles.sectionTitle}>Ogólne</Text>
      <View style={styles.card}>
        <Toggle
          first
          label="Nie wygaszaj ekranu"
          hint="Ekran pozostaje włączony podczas sesji"
          value={s.keepAwake}
          onChange={(v) => update({ keepAwake: v })}
        />
      </View>

      <Text style={styles.credits}>
        Mapy © OpenStreetMap, CARTO, OpenTopoMap. Trasy: OSRM. Wyszukiwanie: Nominatim.{'\n'}
        Notatki powstają automatycznie z kształtu drogi i mogą być niedokładne — zawsze jedź zgodnie z przepisami i tym, co widzisz.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 48 },
  sectionTitle: {
    color: C.faint, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1,
    marginTop: 20, marginBottom: 8, marginLeft: 4,
  },
  card: { backgroundColor: C.raised, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, minHeight: 52 },
  rowBorder: { borderTopWidth: 1, borderTopColor: C.bg },
  rowText: { flex: 1, marginRight: 12 },
  rowLabel: { color: C.text, fontSize: 15 },
  rowHint: { color: C.dim, fontSize: 12, marginTop: 2 },
  radioOuter: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: C.faint,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  radioSelected: { borderColor: C.accent },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent },
  credits: { color: C.faint, fontSize: 11.5, lineHeight: 17, marginTop: 24, marginHorizontal: 4 },
});
