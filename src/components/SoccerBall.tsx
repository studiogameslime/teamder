// SoccerBall — uses the same Ionicons "football-outline" glyph the
// Games tab shows in the bottom tab bar, so the splash + loader feel
// like an extension of the app's existing visual identity.
//
// Ionicons is already bundled in the installed app (no extra native
// module to compile), so this works the moment a JS reload lands.

import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme';

interface Props {
  size?: number;
  color?: string;
}

export function SoccerBall({ size = 64, color = colors.primary }: Props) {
  return <Ionicons name="football" size={size} color={color} />;
}
