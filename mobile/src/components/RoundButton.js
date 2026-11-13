import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import Icon from './Icon';
import { C } from '../theme';

export default function RoundButton({ icon, onPress, active, size = 44, color, label, style, children }) {
  return (
    <TouchableOpacity
      style={[styles.btn, { width: size, height: size, borderRadius: size / 2 }, active && styles.active, style]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
    >
      {children || <Icon name={icon} size={size * 0.5} color={color || (active ? C.accentInk : C.text)} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.line,
  },
  active: { backgroundColor: C.accent, borderColor: C.accent },
});
