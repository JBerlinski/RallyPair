import React from 'react';
import { TouchableOpacity, StyleSheet, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

// headingLock=true  → blue ring, needle follows heading (active tracking mode)
// headingLock=false → dim, needle fixed at north (north-up mode)
export default function NorthCompass({ bearing = 0, onPress, headingLock = true, style }) {
  const rotation = headingLock ? -bearing : 0;

  return (
    <TouchableOpacity
      style={[styles.button, headingLock && styles.buttonActive, style]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <Svg width={22} height={22} viewBox="0 0 22 22">
        <Polygon
          points="11,2 13.5,10 11,8.5 8.5,10"
          fill={headingLock ? '#ef4444' : '#94a3b8'}
          rotation={rotation}
          origin="11,11"
        />
        <Polygon
          points="11,20 13.5,12 11,13.5 8.5,12"
          fill={headingLock ? '#64748b' : '#334155'}
          rotation={rotation}
          origin="11,11"
        />
      </Svg>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(15,23,42,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 6,
  },
  buttonActive: {
    borderWidth: 2,
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(30,64,175,0.75)',
  },
});
