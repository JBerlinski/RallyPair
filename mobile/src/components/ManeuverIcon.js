import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';

const SEVERITY_COLORS = {
  1: '#b91c1c',
  2: '#ea580c',
  3: '#d97706',
  4: '#ca8a04',
  5: '#65a30d',
  6: '#16a34a',
};

// Each entry: shaft path + arrowhead path, in 48×48 viewBox
// Entry direction is always from the bottom, exit direction varies by maneuver type
const ARROWS = {
  straight: {
    shaft: 'M24,42 L24,10',
    head:  'M17,17 L24,10 L31,17',
  },
  slightRight: {
    shaft: 'M24,42 C24,30 32,20 36,10',
    head:  'M29,5 L36,10 L30,18',
  },
  right: {
    shaft: 'M24,42 L24,26 Q24,12 38,12',
    head:  'M31,5 L38,12 L31,19',
  },
  sharpRight: {
    shaft: 'M22,42 L22,28 Q22,16 32,16 Q42,16 42,26 L42,40',
    head:  'M36,34 L42,40 L36,46',
  },
  slightLeft: {
    shaft: 'M24,42 C24,30 16,20 12,10',
    head:  'M19,5 L12,10 L18,18',
  },
  left: {
    shaft: 'M24,42 L24,26 Q24,12 10,12',
    head:  'M17,5 L10,12 L17,19',
  },
  sharpLeft: {
    shaft: 'M26,42 L26,28 Q26,16 16,16 Q6,16 6,26 L6,40',
    head:  'M12,34 L6,40 L12,46',
  },
  uturn: {
    shaft: 'M28,42 L28,16 Q28,6 20,6 Q12,6 12,16 L12,30',
    head:  'M6,24 L12,30 L18,24',
  },
  roundabout: {
    shaft: 'M34,24 A10,10 0 1 1 24,14',
    head:  'M17,10 L24,14 L21,22',
  },
};

export function computeSeverity(bearingBefore, bearingAfter) {
  if (bearingBefore == null || bearingAfter == null) return null;
  let diff = Math.abs(bearingAfter - bearingBefore);
  if (diff > 180) diff = 360 - diff;
  if (diff < 30) return 6;
  if (diff < 60) return 5;
  if (diff < 90) return 4;
  if (diff < 120) return 3;
  if (diff < 150) return 2;
  return 1;
}

function arrowKey(instruction, modifier) {
  const m = (modifier || '').toLowerCase();
  if (instruction === 'roundabout' || instruction === 'rotary') return 'roundabout';
  if (m.includes('uturn')) return 'uturn';
  if (m === 'sharp left')  return 'sharpLeft';
  if (m === 'sharp right') return 'sharpRight';
  if (m === 'slight left') return 'slightLeft';
  if (m === 'slight right') return 'slightRight';
  if (m.includes('left'))  return 'left';
  if (m.includes('right')) return 'right';
  return 'straight';
}

export default function ManeuverIcon({ instruction, modifier, bearingBefore, bearingAfter, size = 52 }) {
  const isArrive = instruction === 'arrive';
  const severity = isArrive ? null : computeSeverity(bearingBefore, bearingAfter);
  const bgColor = severity ? SEVERITY_COLORS[severity] : '#1e40af';

  const svgSize = size - 8;

  if (isArrive) {
    return (
      <View style={{ width: size, height: size, borderRadius: 10, backgroundColor: '#475569', alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={svgSize} height={svgSize} viewBox="0 0 48 48">
          {/* Flagpole */}
          <Path d="M24,42 L24,14" stroke="white" strokeWidth={4} strokeLinecap="round" fill="none" />
          {/* Flag */}
          <Path d="M24,14 L38,20 L24,26" stroke="white" strokeWidth={3} strokeLinejoin="round" fill="white" />
        </Svg>
      </View>
    );
  }

  const key = arrowKey(instruction, modifier);
  const arrow = ARROWS[key] || ARROWS.straight;

  return (
    <View style={{ width: size, height: size, borderRadius: 10, backgroundColor: bgColor, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={svgSize} height={svgSize} viewBox="0 0 48 48">
        <Path d={arrow.shaft} stroke="white" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Path d={arrow.head}  stroke="white" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </View>
  );
}
