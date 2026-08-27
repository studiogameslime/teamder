// motion — the shared motion language, assembled.
//
// The numbers live in motionTokens.ts (import-free, unit-tested); the curves
// live here because they need Reanimated's Easing. Consumers import `motion`
// and get both.

import { Easing } from 'react-native-reanimated';
import { motionTokens } from './motionTokens';

export const motion = {
  ...motionTokens,
  easing: {
    /** Entrances: fast out of the gate, long settle. */
    out: Easing.bezier(0.22, 1, 0.36, 1),
    /** Symmetric — pulses and sweeps. */
    inOut: Easing.inOut(Easing.quad),
  },

  spring: {
    /** Press release. Snappy with no visible overshoot; overshoot on a press
     *  reads as a bug on a surface the finger is still near. */
    press: { damping: 18, stiffness: 320, mass: 0.6 },
  },
} as const;
