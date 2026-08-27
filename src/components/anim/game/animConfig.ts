import { Easing } from 'react-native-reanimated';

// The micro-interaction half of the language now lives in theme/motion — press,
// entrance, pulse and sweep are design tokens like colour and spacing, and
// shared components need them without reaching into a folder named `game`.
// Re-exported here so a reader of this file finds the whole vocabulary and the
// two can't drift into two different apps.
//
// The TOKENS, not `@/theme` — that barrel reaches Reanimated's Easing, and
// pulling a native package into this module took two pure logic suites down
// with it the moment it was added. The curves stay where they are needed.
export { motionTokens } from '@/theme/motionTokens';

/**
 * Shared visual language for the game product-animations (registration,
 * waitlist promotion, last-spot, next-game card, live entrance, draft pick,
 * auto-balance). Every animation pulls its timing/easing from here so they
 * feel like one system.
 *
 * Guidelines (from the product spec):
 *  • normal action:      250–450ms
 *  • meaningful celebration: up to ~900ms
 *  • natural easing, no harsh zoom/flash, no long random shuffles
 *  • Reduce Motion → a single short fade, no travel paths
 */
export const ANIM = {
  duration: {
    /** Standard UI action (button state, small move). */
    action: 320,
    /** A short accent (ring, pulse, single element in). */
    accent: 260,
    /** A meaningful celebration (last spot, teams ready). */
    celebration: 800,
    /** Reduce-Motion replacement for everything: one quick fade. */
    reducedFade: 180,
    /** Stagger step between siblings (avatars, team members). */
    stagger: 40,
  },
  scale: {
    /** Gentle counter/pulse pop: 1 → popIn → 1. */
    popIn: 1.08,
    /** Clock/card settle: from → 1. */
    settleFrom: 0.96,
  },
  easing: {
    /** Standard ease-in-out for travel/settle. */
    standard: Easing.bezier(0.22, 1, 0.36, 1),
    /** Entrance ease-out. */
    out: Easing.out(Easing.cubic),
    /** Symmetric for pulses. */
    inOut: Easing.inOut(Easing.quad),
  },
  spring: {
    /** Soft, no-overshoot-heavy spring for pops and settles. */
    gentle: { damping: 15, stiffness: 160, mass: 0.9 },
  },
} as const;

export type AnimVisibility = {
  visible: boolean;
  onComplete?: () => void;
};
