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
  // Brand was green for v1 but the redesigned heroes / onboarding /
  // sign-in surfaces all use blue, and mixing the two felt off. We
  // flip the primary triplet to blue here so every legacy
  // `colors.primary` usage (Button variant=primary, outline border,
  // checkmark accents, etc.) lights up the new brand without
  // chasing 100+ call sites individually.
  // `success`, `field*`, `gkGlove`, and `team3` deliberately stay
  // green — those carry semantic green meaning ("approved", the
  // pitch chrome, one of the rotating team tints).
  primary: '#1E40AF',
  primaryDark: '#1E3A8A',
  primaryLight: '#DBEAFE',

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
  // Lighter blue tones so the primary CTA pops on dark surfaces.
  primary: '#3B82F6',
  primaryDark: '#1E40AF',
  primaryLight: '#1E3A8A',

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

// Force LIGHT mode app-wide per design spec — no dark variant exposed.
// `Appearance.getColorScheme` is intentionally not consulted.
void Appearance; // keep the import valid; consumer may re-enable later
export const isDarkTheme = false;
export const colors: Palette = lightPalette;
void darkPalette; // retained for future dark-mode work

export type Color = keyof Palette;
