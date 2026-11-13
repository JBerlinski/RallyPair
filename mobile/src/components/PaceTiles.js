import React, { memo } from 'react';
import { View, Platform } from 'react-native';
import Svg, { Path, Circle, Rect, Text as SvgText } from 'react-native-svg';
import { noteSpecs, gapSpec } from '../utils/paceIcons';

const FONT = Platform.select({ web: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', default: undefined });

// One square pacenote icon.
export const Tile = memo(function Tile({ spec, size = 48, dim = false, style }) {
  if (!spec) return null;
  return (
    <View style={[{ width: size, height: size, opacity: dim ? 0.38 : 1 }, style]}>
      <Svg width={size} height={size} viewBox="0 0 48 48">
        <Rect x={1} y={1} width={46} height={46} rx={7} fill={spec.bg} stroke="rgba(0,0,0,0.55)" strokeWidth={2} />
        {spec.items.map((it, i) => {
          if (it[0] === 'p') {
            return it[2] > 0
              ? <Path key={i} d={it[1]} fill="none" stroke={spec.ink} strokeWidth={it[2]} strokeLinecap="round" strokeLinejoin="round" />
              : <Path key={i} d={it[1]} fill={spec.ink} fillRule="evenodd" />;
          }
          if (it[0] === 'c') return <Circle key={i} cx={it[1]} cy={it[2]} r={it[3]} fill={spec.ink} />;
          return (
            <SvgText key={i} x={it[1]} y={it[2]} fontSize={it[3]} fontWeight="800" fontFamily={FONT} textAnchor={it[5]} fill={spec.ink}>
              {it[4]}
            </SvgText>
          );
        })}
      </Svg>
    </View>
  );
});

// The full icon row for a note: [distance] [arrow] [hazards…] [modifiers…]
export const NoteTiles = memo(function NoteTiles({ note, size = 48, showGap = true, max = 6, gap = 4, dim = false }) {
  const specs = noteSpecs(note).slice(0, max);
  const dist = showGap ? gapSpec(note) : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap }}>
      {dist && <Tile spec={dist} size={size} dim={dim} />}
      {specs.map((s, i) => <Tile key={i} spec={s} size={size} dim={dim} />)}
    </View>
  );
});
