import { TextStyle } from 'react-native';

// We rely on system Hebrew fonts (San Francisco / Roboto) which both render
// Hebrew well. If you later add a custom Hebrew font, swap fontFamily here.

export const typography = {
  h1: { fontSize: 28, fontWeight: '700', lineHeight: 34 } as TextStyle,
  h2: { fontSize: 22, fontWeight: '700', lineHeight: 28 } as TextStyle,
  h3: { fontSize: 18, fontWeight: '600', lineHeight: 24 } as TextStyle,
  body: { fontSize: 16, fontWeight: '400', lineHeight: 22 } as TextStyle,
  bodyBold: { fontSize: 16, fontWeight: '600', lineHeight: 22 } as TextStyle,
  caption: { fontSize: 13, fontWeight: '400', lineHeight: 18 } as TextStyle,
  label: { fontSize: 14, fontWeight: '500', lineHeight: 20 } as TextStyle,
  button: { fontSize: 16, fontWeight: '600', lineHeight: 22 } as TextStyle,
  number: { fontSize: 48, fontWeight: '700', lineHeight: 56 } as TextStyle,
};
