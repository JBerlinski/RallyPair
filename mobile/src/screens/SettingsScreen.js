import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Switch, ScrollView,
} from 'react-native';
import { TILE_PROVIDERS, loadSettings, saveSettings } from '../utils/settings';

export default function SettingsScreen() {
  const [s, setS] = useState(null);

  useEffect(() => { loadSettings().then(setS); }, []);

  const update = useCallback(async (patch) => {
    setS((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(patch);
      return next;
    });
  }, []);

  if (!s) return <View style={styles.container} />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      <Text style={styles.sectionTitle}>Ogólne</Text>
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Styl mapy</Text>
        {TILE_PROVIDERS.map((p, i) => (
          <TouchableOpacity
            key={p.id}
            style={[styles.radioRow, i > 0 && styles.rowBorder]}
            onPress={() => update({ tileProvider: p.id })}
          >
            <View style={[styles.radioOuter, s.tileProvider === p.id && styles.radioSelected]}>
              {s.tileProvider === p.id && <View style={styles.radioInner} />}
            </View>
            <Text style={styles.rowLabel}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Kierowca</Text>
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.rowLabel}>Obrót mapy wg kierunku</Text>
            <Text style={styles.rowHint}>Mapa obraca się zgodnie z kierunkiem jazdy</Text>
          </View>
          <Switch
            value={s.compassRotation}
            onValueChange={(v) => update({ compassRotation: v })}
            trackColor={{ false: '#334155', true: '#2563eb' }}
            thumbColor="#f1f5f9"
          />
        </View>
        <View style={[styles.switchRow, styles.rowBorder]}>
          <View style={styles.switchText}>
            <Text style={styles.rowLabel}>Auto-centrowanie</Text>
            <Text style={styles.rowHint}>Mapa podąża za pozycją kierowcy</Text>
          </View>
          <Switch
            value={s.autoCenter}
            onValueChange={(v) => update({ autoCenter: v })}
            trackColor={{ false: '#334155', true: '#2563eb' }}
            thumbColor="#f1f5f9"
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>Nawigator</Text>
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.rowLabel}>Pokaż trasę na mapie</Text>
            <Text style={styles.rowHint}>Wyświetla wyznaczoną trasę w widoku nawigatora</Text>
          </View>
          <Switch
            value={s.showRoute}
            onValueChange={(v) => update({ showRoute: v })}
            trackColor={{ false: '#334155', true: '#2563eb' }}
            thumbColor="#f1f5f9"
          />
        </View>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16, paddingBottom: 48 },

  sectionTitle: {
    color: '#64748b', fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1,
    marginTop: 24, marginBottom: 8, marginLeft: 4,
  },
  card: { backgroundColor: '#1e293b', borderRadius: 14, overflow: 'hidden' },
  cardLabel: { color: '#94a3b8', fontSize: 12, fontWeight: '600', padding: 14, paddingBottom: 6 },

  rowBorder: { borderTopWidth: 1, borderTopColor: '#0f172a' },

  radioRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13,
  },
  radioOuter: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: '#475569',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  radioSelected: { borderColor: '#3b82f6' },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#3b82f6' },

  rowLabel: { color: '#e2e8f0', fontSize: 14 },
  rowHint: { color: '#64748b', fontSize: 12, marginTop: 2 },

  switchRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13,
  },
  switchText: { flex: 1, marginRight: 12 },
});
