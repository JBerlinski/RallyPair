import React from 'react';
import Svg, { Path } from 'react-native-svg';

// Minimal line-icon set (24×24, stroked).
const PATHS = {
  back: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  plus: 'M12 5v14M5 12h14',
  settings: 'M4 7h9M19 7h1M4 17h1M11 17h9M13 7a3 3 0 1 0 6 0a3 3 0 1 0-6 0M5 17a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  locate: 'M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M7 12a5 5 0 1 0 10 0a5 5 0 1 0-10 0',
  route: 'M4.5 19a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0M16.3 5a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0M6.5 17.2c.5-7 11-3.400 11.300-10.500',
  north: 'M12 3l6 17-6-4.500-6 4.500z',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  flag: 'M6 21V4M6 5h11l-2.500 4 2.500 4H6',
  drag: 'M5 9h14M5 15h14',
  chevDown: 'M6 9l6 6 6-6',
  chevUp: 'M6 15l6-6 6 6',
  chevLeft: 'M14 6l-6 6 6 6',
  chevRight: 'M10 6l6 6-6 6',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M15.500 15.500l5 5',
  car: 'M5 15.500l1.500-6h11l1.500 6M4 15.500h16V19H4zM7 19v1.500M17 19v1.500',
  cube: 'M12 3l8 4.500v9L12 21l-8-4.500v-9zM4 7.500l8 4.500 8-4.500M12 12v9',
};

export default function Icon({ name, size = 22, color = '#f4f4f5', strokeWidth = 2 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={PATHS[name]} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
