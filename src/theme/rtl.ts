// Cross-platform RTL alignment helper.
//
// Why this exists: under `I18nManager.forceRTL(true)`, RN's text engine
// interprets `textAlign:'right'` as "end of paragraph" — and because the
// paragraph is RTL, "end" maps to the visual LEFT. This swap happens on
// BOTH Android and iOS once RTL is forced (App.tsx calls forceRTL). So to
// anchor Hebrew labels to the visual RIGHT, we must pass `'left'` on both
// platforms — `'left'` resolves to the RTL "start" → visual right.
//
// (Earlier this returned `'right'` on iOS on the assumption that iOS
// doesn't do the swap. That was only ever exercised on Android; on iOS
// under forceRTL it swapped too, so every label using this helper drifted
// to the visual left. Hence: `'left'` everywhere.)
//
// Use `RTL_LABEL_ALIGN` instead of writing `'right'`/`'left'` literals in
// stylesheets. Avoid setting `writingDirection:'rtl'` on labels — it
// triggers the same swap and double-applies.

import type { TextStyle } from 'react-native';

export const RTL_LABEL_ALIGN: TextStyle['textAlign'] = 'left';
