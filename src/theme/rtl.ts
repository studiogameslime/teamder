// Cross-platform RTL alignment helpers.
//
// Why this exists: under `I18nManager.forceRTL(true)` on Android, RN's
// TextView interprets `textAlign:'right'` as "end of paragraph" — and
// because the paragraph is RTL, "end" maps to the visual LEFT. iOS does
// not do this swap; on iOS, `textAlign:'right'` is always physical right.
//
// To get Hebrew labels visually anchored to the right edge across both
// platforms, use `RTL_LABEL_ALIGN` instead of writing `'right'` literals
// in stylesheets. Adding `writingDirection:'rtl'` to a Text style is
// what triggers Android's swap in the first place — so we deliberately
// do NOT set it on labels.

import { Platform } from 'react-native';
import type { TextStyle } from 'react-native';

export const RTL_LABEL_ALIGN: TextStyle['textAlign'] =
  Platform.OS === 'android' ? 'left' : 'right';
