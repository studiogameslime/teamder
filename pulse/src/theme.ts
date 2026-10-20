import { Platform } from 'react-native';

// Native RTL paragraphs interpret left/right as start/end. Web uses physical CSS alignment.
export const RTL_LABEL_ALIGN = Platform.OS === 'web' ? 'right' as const : 'left' as const;
export const RTL_VALUE_ALIGN = Platform.OS === 'web' ? 'left' as const : 'right' as const;
// Editable fields use physical gravity on Android, unlike paragraph Text.
export const RTL_INPUT_ALIGN = 'right' as const;
export const isolateText = (value: string) => '\u2068' + value + '\u2069';

// Neutral charcoal surfaces; green is reserved for actions and selection.

export const colors = {
  onPrimary: '#14251A',
  blue: '#93B5D4',
  purple: '#BAA7D3',
  teal: '#83BDB6',
  bg: '#171819',
  surface: '#242628',
  surfaceAlt: '#2D3032',
  border: '#3B3E40',
  text: '#F3F1EC',
  textSoft: '#BEC3C0',
  textMuted: '#9DA6A1',
  primary: '#81C99A',
  primarySoft: '#263E30',
  green: '#81C99A',
  amber: '#E8B866',
  red: '#ED8585',
  star: '#FBBF24',
  appstore: '#0A84FF',
  googleplay: '#34A853',
};

export const radius = { sm: 10, md: 14, lg: 20 };

export const space = (n: number) => n * 4;

// RTL app — headings right-align by default; sizes kept compact to match
// the dense dashboard look.
export const font = {
  h1: { direction: 'rtl' as const, fontSize: 26, fontWeight: '800' as const, color: colors.text, textAlign: RTL_LABEL_ALIGN,},
  h2: { direction: 'rtl' as const, fontSize: 16, fontWeight: '700' as const, color: colors.text, textAlign: RTL_LABEL_ALIGN,},
  title: { direction: 'rtl' as const, fontSize: 15, fontWeight: '700' as const, color: colors.text, textAlign: RTL_LABEL_ALIGN },
  body: { direction: 'rtl' as const, fontSize: 14, fontWeight: '500' as const, color: colors.textSoft, textAlign: RTL_LABEL_ALIGN },
  small: { direction: 'rtl' as const, fontSize: 13, fontWeight: '500' as const, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  big: { fontSize: 28, fontWeight: '800' as const, color: colors.text },
};
