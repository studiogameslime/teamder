// motion — the app's shared motion language.
//
// WHY IT LIVES IN theme/. Timings and easings were already collected once, in
// components/anim/game/animConfig.ts, but that file documents itself as the
// language of the GAME product-animations (registration, waitlist, teams
// ready). Nothing shared ever imported it, so every card, button and badge
// outside that folder invented its own numbers. Motion is a design token like
// colour and spacing, and it belongs next to them — animConfig now re-exports
// these so the two can't drift.
//
// Scope: micro-interactions. Entrance, attention, press. Celebrations and
// product set-pieces keep their own longer timings in animConfig.
//
// This half is deliberately IMPORT-FREE. The curves live in motion.ts, which
// needs Reanimated's Easing — and a module that pulls in a native package
// cannot be unit-tested, so the constraints the brief actually set (press
// under 150ms, stagger capped, pulse finite) would have had nothing pinning
// them. Numbers here, curves there.

export const motionTokens = {
  duration: {
    /** Press in/out. Must be under perception — a press that animates for
     *  200ms reads as lag, not feedback. */
    fast: 120,
    /** The default for entrances and settles. */
    normal: 320,
    /** An entrance with a little more presence — the hero card. */
    slow: 420,
    /** Reduce Motion replaces every one of the above with this. */
    reducedFade: 160,
  },

  /** Entrance. */
  entrance: {
    /** Pixels a card travels up from. Small on purpose: the eye should read
     *  "settled", never "flew in". */
    offsetY: 14,
    /** The hero starts a touch lower and a touch smaller. */
    heroOffsetY: 18,
    heroScaleFrom: 0.975,
    /** Between siblings. */
    staggerMs: 55,
    /** Total stagger is capped so a long screen never makes the last card
     *  arrive a second and a half after the first — the point is polish, not
     *  a queue. */
    staggerCapMs: 260,
  },

  /** Press. transform only — never width/height/margin, which reflow. */
  press: {
    /** Cards and large surfaces: the bigger the surface, the smaller the
     *  scale needs to be to read as the same amount of movement. */
    cardScale: 0.985,
    /** Buttons and small controls. */
    controlScale: 0.97,
  },

  /** Attention. Deliberately weak: a status that pulses hard reads as an
   *  error, and one that pulses forever becomes wallpaper. */
  pulse: {
    scaleTo: 1.035,
    opacityTo: 0.82,
    /** One breath. Slow enough to be felt rather than noticed. */
    periodMs: 1900,
    /** Repeating pulses stop after this many breaths. A badge that pulses
     *  for the life of the screen is a badge nobody looks at by minute two. */
    maxCycles: 3,
  },

  /** Light sweep across a CTA. Once, never a loop. */
  sweep: {
    /** Let the screen settle first — a sweep during the entrance is noise. */
    delayMs: 700,
    durationMs: 850,
    /** Peak opacity of the highlight band. */
    opacity: 0.22,
  },
} as const;
