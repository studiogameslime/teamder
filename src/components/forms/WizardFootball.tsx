import React from 'react';
import { Image, View } from 'react-native';
import { FORM_BG, FORM_BLUE } from './FormTheme';

/** Shared local artwork for rolling form controls; inactive steps stay subdued. */
export function WizardFootball({ color, size = 36 }: { color: string; size?: number }) {
  // Mask the connector under transparent artwork, including inactive steps
  // and every intermediate position of the rolling ball.
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: FORM_BG }}><Image
    source={require('../../assets/images/form-toggle-football-3d.png')}
    style={{ width: size, height: size, opacity: color === FORM_BLUE ? 1 : 0.35 }}
    resizeMode="contain"
    fadeDuration={0}
    accessible={false}
  /></View>;
}
