import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { colors } from '@/theme';

/** Filled pictograms, without a tile; shared by sheets and anchored menus. */
export function MenuIcon({ name, size = 24, color = colors.primaryDark }: {
  name: keyof typeof Ionicons.glyphMap; size?: number; color?: string;
}) {
  const accent = color === colors.primaryDark ? '#3B82F6' : color;
  if (name === 'stats-chart-outline' || name === 'stats-chart') return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Rect x="3" y="13" width="5" height="9" rx="1.5" fill={accent} />
      <Rect x="10" y="8" width="5" height="14" rx="1.5" fill={accent} opacity={0.75} />
      <Rect x="17" y="2" width="5" height="20" rx="1.5" fill={color} />
    </Svg>
  );
  if (name === 'calendar-outline' || name === 'calendar') return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path d="M5 4h14a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z" fill={color} />
      <Rect x="5" y="10" width="14" height="10" rx="1" fill={colors.surface} />
      <Rect x="6" y="1" width="3" height="7" rx="1.5" fill={accent} />
      <Rect x="15" y="1" width="3" height="7" rx="1.5" fill={accent} />
      <Rect x="7" y="12" width="4" height="4" rx="0.5" fill={accent} />
    </Svg>
  );
  if (name === 'create-outline') return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Circle cx="9" cy="6" r="5" fill={color} />
      <Path d="M1 23v-4a8 8 0 0 1 14-5l-4 9Z" fill={color} />
      <Path d="m13 19 7-9 3 3-7 9-4 1Z" fill={accent} />
    </Svg>
  );
  const filled = name.replace(/-outline$/, '') as keyof typeof Ionicons.glyphMap;
  return <Ionicons name={filled in Ionicons.glyphMap ? filled : name} size={size} color={color} accessible={false} />;
}
