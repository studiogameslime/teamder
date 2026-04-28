// Theme tokens. Resolved once at module load against the system color
// scheme. Live theme switching (toggle without restart) is not supported
// — the user gets a consistent palette per launch.
//
// Tokens are intentionally a flat shape so existing `colors.X` imports
// keep compiling. The set of keys is identical across light/dark; only
// values differ.

import { Appearance } from 'react-native';

interface Palette {
  // Primary brand
  primary: string;
  primaryDark: string;
  primaryLight: string;

  // Backgrounds
  bg: string;
  surface: string;
  surfaceMuted: string;

  // Text
  text: string;
  textMuted: string;
  textOnPrimary: string;

  // Borders / dividers
  border: string;
  divider: string;

  // Status
  success: string;
  warning: string;
  danger: string;
  info: string;

  // Team colors
  team1: string;
  team1Bg: string;
  team2: string;
  team2Bg: string;
  team3: string;
  team3Bg: string;

  // Field
  field: string;
  fieldStripe: string;
  fieldLine: string;

  // Goalkeeper highlight
  gkGlove: string;
}

const lightPalette: Palette = {
  primary: '#16A34A',
  primaryDark: '#15803D',
  primaryLight: '#DCFCE7',

  bg: '#F9FAFB',
  surface: '#FFFFFF',
  surfaceMuted: '#F3F4F6',

  text: '#111827',
  textMuted: '#6B7280',
  textOnPrimary: '#FFFFFF',

  border: '#E5E7EB',
  divider: '#F3F4F6',

  success: '#16A34A',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#3B82F6',

  team1: '#EF4444',
  team1Bg: '#FEE2E2',
  team2: '#3B82F6',
  team2Bg: '#DBEAFE',
  team3: '#22C55E',
  team3Bg: '#DCFCE7',

  field: '#15803D',
  fieldStripe: '#16A34A',
  fieldLine: '#FFFFFF',

  gkGlove: '#16A34A',
};

const darkPalette: Palette = {
  // Slightly lighter green so it pops on dark surfaces.
  primary: '#22C55E',
  primaryDark: '#16A34A',
  primaryLight: '#064E3B',

  bg: '#0B0F14',          // app background
  surface: '#11161D',     // cards
  surfaceMuted: '#1A2027',

  text: '#F3F4F6',
  textMuted: '#9CA3AF',
  textOnPrimary: '#0B0F14',

  border: '#243042',
  divider: '#1A2027',

  success: '#22C55E',
  warning: '#FBBF24',
  danger: '#F87171',
  info: '#60A5FA',

  team1: '#F87171',
  team1Bg: '#3F1D1D',
  team2: '#60A5FA',
  team2Bg: '#1E2A4A',
  team3: '#34D399',
  team3Bg: '#0F3328',

  field: '#10612F',
  fieldStripe: '#1B7A3E',
  fieldLine: '#E5E7EB',

  gkGlove: '#22C55E',
};

const scheme = Appearance.getColorScheme();
export const isDarkTheme = scheme === 'dark';
export const colors: Palette = isDarkTheme ? darkPalette : lightPalette;

export type Color = keyof Palette;
