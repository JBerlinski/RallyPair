import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Tile } from './PaceTiles';
import Icon from './Icon';
import { arrowSpec, tagSpec, modSpec } from '../utils/paceIcons';
import { GRADES, GRADE_INFO, MODS, TAGS, HAZARD_TAGS } from '../utils/pacenotes';
import { fmtDistance } from '../utils/geo';
import { C } from '../theme';

const toggle = (list, item) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

function Choice({ spec, label, selected, onPress, size = 44 }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.choice} activeOpacity={0.7} accessibilityLabel={label}>
      <View style={[styles.choiceFrame, selected && styles.choiceSelected]}>
        <Tile spec={spec} size={size} dim={!selected} />
      </View>
      <Text style={[styles.choiceLabel, selected && styles.choiceLabelOn]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

// Edits one pacenote. Every change is applied (and synced to the driver) immediately.
export default function NoteEditor({ note, onChange, onMove, onDelete, onClose }) {
  const isCorner = note.kind === 'corner';
  const dir = note.dir || 'R';
  const tags = note.tags || [];
  const mods = note.mods || [];

  const setKind = (kind) => {
    if (kind === note.kind) return;
    if (kind === 'corner') onChange({ kind, dir, grade: note.grade || '4' });
    else onChange({ kind, mods: [], tags: tags.length ? tags : ['caution'] });
  };

  return (
    <View>
      <View style={styles.header}>
        <View style={styles.segment}>
          {[['corner', 'Zakręt'], ['info', 'Informacja']].map(([k, label]) => (
            <TouchableOpacity key={k} style={[styles.segBtn, note.kind === k && styles.segOn]} onPress={() => setKind(k)}>
              <Text style={[styles.segText, note.kind === k && styles.segTextOn]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={styles.iconBtn} onPress={onDelete} accessibilityLabel="Usuń notatkę">
          <Icon name="trash" color={C.red} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.iconBtn, styles.done]} onPress={onClose} accessibilityLabel="Gotowe">
          <Icon name="check" color={C.accentInk} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {isCorner && (
          <>
            <View style={styles.dirRow}>
              {[['L', 'Lewy'], ['R', 'Prawy']].map(([d, label]) => (
                <TouchableOpacity key={d} style={[styles.dirBtn, dir === d && styles.dirOn]} onPress={() => onChange({ dir: d })}>
                  <Text style={[styles.dirText, dir === d && styles.dirTextOn]}>{d === 'L' ? `← ${label}` : `${label} →`}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {[...GRADES].reverse().map((g) => (
                <Choice key={g} spec={arrowSpec(g, dir)} label={GRADE_INFO[g].name} selected={note.grade === g} onPress={() => onChange({ grade: g })} />
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {Object.keys(MODS).map((m) => (
                <Choice key={m} spec={modSpec(m)} label={MODS[m]} selected={mods.includes(m)} onPress={() => onChange({ mods: toggle(mods, m) })} size={38} />
              ))}
            </ScrollView>
          </>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {HAZARD_TAGS.map((t) => (
            <Choice key={t} spec={tagSpec(t)} label={TAGS[t]} selected={tags.includes(t)} onPress={() => onChange({ tags: toggle(tags, t) })} size={38} />
          ))}
        </ScrollView>

        {tags.includes('roundabout') && (
          <View style={styles.stepper}>
            <Text style={styles.stepLabel}>Zjazd z ronda</Text>
            <TouchableOpacity style={styles.stepBtn} onPress={() => onChange({ exit: Math.max(1, (note.exit || 1) - 1) })}>
              <Icon name="chevLeft" size={18} />
            </TouchableOpacity>
            <Text style={styles.stepValue}>{note.exit || '–'}</Text>
            <TouchableOpacity style={styles.stepBtn} onPress={() => onChange({ exit: Math.min(9, (note.exit || 0) + 1) })}>
              <Icon name="chevRight" size={18} />
            </TouchableOpacity>
          </View>
        )}

        <TextInput
          style={styles.input}
          placeholder="Własny dopisek (np. „po lewej słup”)"
          placeholderTextColor={C.faint}
          value={note.text || ''}
          onChangeText={(text) => onChange({ text })}
          maxLength={40}
          returnKeyType="done"
        />

        <View style={styles.stepper}>
          <Text style={styles.stepLabel}>Miejsce na trasie</Text>
          <TouchableOpacity style={styles.stepBtn} onPress={() => onMove(-10)} accessibilityLabel="Przesuń 10 metrów wcześniej">
            <Icon name="chevLeft" size={18} />
          </TouchableOpacity>
          <Text style={styles.stepValue}>{fmtDistance(note.d)}</Text>
          <TouchableOpacity style={styles.stepBtn} onPress={() => onMove(10)} accessibilityLabel="Przesuń 10 metrów dalej">
            <Icon name="chevRight" size={18} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 },
  segment: { flex: 1, flexDirection: 'row', backgroundColor: C.raised, borderRadius: 10, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segOn: { backgroundColor: C.accent },
  segText: { color: C.dim, fontSize: 14, fontWeight: '700' },
  segTextOn: { color: C.accentInk },
  iconBtn: { width: 42, height: 42, borderRadius: 10, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' },
  done: { backgroundColor: C.accent },

  body: { maxHeight: 300 },
  dirRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, marginBottom: 4 },
  dirBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: C.raised, alignItems: 'center' },
  dirOn: { backgroundColor: C.text },
  dirText: { color: C.dim, fontSize: 15, fontWeight: '800' },
  dirTextOn: { color: C.accentInk },

  row: { paddingHorizontal: 12, paddingVertical: 6, gap: 4 },
  choice: { alignItems: 'center', width: 62 },
  choiceFrame: { padding: 3, borderRadius: 10, borderWidth: 2, borderColor: 'transparent' },
  choiceSelected: { borderColor: C.text },
  choiceLabel: { color: C.faint, fontSize: 10, marginTop: 2, fontWeight: '600' },
  choiceLabelOn: { color: C.text },

  input: {
    marginHorizontal: 14, marginTop: 6, backgroundColor: C.raised, borderRadius: 10,
    color: C.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, marginTop: 10, marginBottom: 4, gap: 8 },
  stepLabel: { flex: 1, color: C.dim, fontSize: 13 },
  stepBtn: { width: 40, height: 36, borderRadius: 9, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' },
  stepValue: { color: C.text, fontSize: 14, fontWeight: '700', minWidth: 64, textAlign: 'center' },
});
