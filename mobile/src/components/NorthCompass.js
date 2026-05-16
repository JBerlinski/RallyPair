import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

export default function NorthCompass({ bearing = 0, onPress, style }) {
  // Rotate needle opposite to map bearing so north always points up on screen
  const rotation = -bearing;

  return (
    <TouchableOpacity style={[styles.button, style]} onPress={onPress} activeOpacity={0.8}>
      <Svg width={22} height={22} viewBox="0 0 22 22">
        <Polygon
          points="11,2 13.5,10 11,8.5 8.5,10"
          fill="#ef4444"
          rotation={rotation}
          origin="11,11"
        />
        <Polygon
          points="11,20 13.5,12 11,13.5 8.5,12"
          fill="#64748b"
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
});
