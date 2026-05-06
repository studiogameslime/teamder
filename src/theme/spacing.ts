// Strict 8-point spacing scale. Every padding / margin in the app
// should resolve to one of these — no random 11/13/17 values.
//   xs (4) — tight inline gaps
//   sm (8) — adjacent siblings
//   md (12) — small section gaps
//   lg (16) — standard card / screen padding
//   xl (20) — generous section padding
//   xxl (24) — between major sections
//   xxxl (32) — hero spacing
//   xxxxl (48) — huge breathing room (rare)
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  xxxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  pill: 999,
} as const;

// Centralised shadow tokens. The app uses three elevation levels:
//   card  — resting state for content cards
//   raised — modals, popovers, FABs
//   hero  — top-of-screen heroes / banners (only when needed)
// On Android `elevation` drives the shadow, on iOS `shadow*` props do.
export const shadows = {
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  raised: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  hero: {
    shadowColor: '#1E40AF',
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
} as const;
