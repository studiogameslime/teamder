// Dark, founder-dashboard palette. Compact, data-dense, glanceable.

export const colors = {
  bg: '#0B1220',
  surface: '#121C2E',
  surfaceAlt: '#1A2740',
  border: '#243350',
  text: '#F1F5F9',
  textSoft: '#9FB0C9',
  textMuted: '#6B7C99',
  primary: '#3B82F6',
  primarySoft: '#1E3A8A',
  green: '#22C55E',
  amber: '#F59E0B',
  red: '#EF4444',
  star: '#FBBF24',
  appstore: '#0A84FF',
  googleplay: '#34A853',
};

export const radius = { sm: 10, md: 16, lg: 22 };

export const space = (n: number) => n * 4;

// RTL app — headings right-align by default; sizes kept compact to match
// the dense dashboard look.
export const font = {
  h1: { fontSize: 22, fontWeight: '800' as const, color: colors.text, textAlign: 'right' as const, writingDirection: 'rtl' as const },
  h2: { fontSize: 16, fontWeight: '700' as const, color: colors.text, textAlign: 'right' as const, writingDirection: 'rtl' as const },
  title: { fontSize: 15, fontWeight: '700' as const, color: colors.text, textAlign: 'right' as const },
  body: { fontSize: 14, fontWeight: '500' as const, color: colors.textSoft, textAlign: 'right' as const },
  small: { fontSize: 12, fontWeight: '500' as const, color: colors.textMuted, textAlign: 'right' as const },
  big: { fontSize: 28, fontWeight: '800' as const, color: colors.text },
};
