import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';

// Full-screen start lights: red digits, yellow for the last two, green on go.
// `start` = { seconds, at } — a new object restarts the countdown.
export default function StartCountdown({ start }) {
  const [left, setLeft] = useState(null);

  useEffect(() => {
    if (!start) return undefined;
    const tick = () => {
      const remaining = start.seconds - (Date.now() - start.at) / 1000;
      setLeft(remaining > -1.2 ? Math.ceil(remaining) : null);
      return remaining > -1.2;
    };
    tick();
    const timer = setInterval(() => { if (!tick()) clearInterval(timer); }, 100);
    return () => clearInterval(timer);
  }, [start]);

  if (left == null) return null;
  const go = left <= 0;
  const bg = go ? '#1fb141' : left <= 2 ? '#f2c40f' : '#e5222b';
  return (
    <View style={[styles.fill, { backgroundColor: bg }]} pointerEvents="none">
      <Text style={[styles.digit, go && styles.go]}>{go ? 'START' : left}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 100, elevation: 100 },
  digit: { color: '#fff', fontSize: 220, fontWeight: '900' },
  go: { fontSize: 84, letterSpacing: 4 },
});
