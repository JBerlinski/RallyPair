import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Tile, NoteTiles } from './PaceTiles';
import { distSpec, tagSpec, noteColor } from '../utils/paceIcons';
import { noteText } from '../utils/pacenotes';
import { fmtDistance } from '../utils/geo';
import { C } from '../theme';

function liveDistance(m) {
  if (m < 15) return null;
  if (m >= 1000) return `${(m / 1000).toFixed(1)}k`;
  return String(Math.round(m / 10) * 10);
}

// The call shown to both crew members: the current note as large icons with a live
// distance countdown, and the notes that follow as a smaller queue.
//   notes — withGaps() output;  call — callState() output (null = stage finished)
function PacenoteStrip({ notes, call, remaining, size = 'lg', style }) {
  const big = size === 'lg' ? 64 : 44;
  const small = size === 'lg' ? 36 : 28;

  if (!call) {
    return (
      <View style={[styles.panel, style]}>
        <View style={styles.mainRow}><Tile spec={tagSpec('finish')} size={big} /></View>
        <Text style={styles.footer}>Meta</Text>
      </View>
    );
  }

  const note = notes[call.index];
  const upcoming = notes.slice(call.index + 1, call.index + 4);
  const dist = liveDistance(call.distTo);
  const near = call.distTo < 200;

  return (
    <View
      style={[styles.panel, near && { borderColor: noteColor(note) }, style]}
      accessibilityLabel={`${dist ? `${dist} metrów, ` : ''}${noteText(note)}`}
    >
      <View style={[styles.mainRow, !near && styles.far]}>
        {dist && <Tile spec={distSpec(dist)} size={big} />}
        <NoteTiles note={note} size={big} showGap={false} max={dist ? 4 : 5} gap={6} />
      </View>
      {!!note.text && <Text style={styles.caption} numberOfLines={1}>{note.text}</Text>}

      {upcoming.length > 0 && (
        <View style={styles.queue}>
          {upcoming.map((n) => (
            <View key={n.id} style={styles.queueItem}>
              <NoteTiles note={n} size={small} max={3} gap={3} />
            </View>
          ))}
        </View>
      )}
      {remaining != null && <Text style={styles.footer}>{fmtDistance(remaining)} do mety</Text>}
    </View>
  );
}

export default memo(PacenoteStrip);

const styles = StyleSheet.create({
  panel: {
    backgroundColor: C.panel, borderRadius: 18, borderWidth: 2, borderColor: C.line,
    paddingHorizontal: 10, paddingTop: 10, paddingBottom: 6, alignItems: 'center', overflow: 'hidden',
  },
  mainRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  far: { opacity: 0.55 },
  caption: { color: C.text, fontSize: 15, fontWeight: '700', marginTop: 6, textTransform: 'uppercase' },
  queue: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: C.line, alignSelf: 'stretch', justifyContent: 'center', overflow: 'hidden',
  },
  queueItem: { opacity: 0.8 },
  footer: { color: C.faint, fontSize: 11, fontWeight: '600', marginTop: 5, letterSpacing: 0.3 },
});
