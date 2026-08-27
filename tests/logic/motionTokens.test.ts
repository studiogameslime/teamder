import { motionTokens as motion } from '@/theme/motionTokens';

// The point of these is not to pin numbers for their own sake — it is to pin
// the CONSTRAINTS the brief set, so a later "let's make it pop" edit has to
// argue with a failing test instead of sliding through review.
describe('motion tokens', () => {
  it('keeps a press under the threshold where feedback becomes lag', () => {
    // The brief asked for 80–150ms. Past that a press stops reading as an
    // answer and starts reading as the app being slow.
    expect(motion.duration.fast).toBeGreaterThanOrEqual(80);
    expect(motion.duration.fast).toBeLessThanOrEqual(150);
  });

  it('keeps entrances inside 250–400ms, hero included', () => {
    expect(motion.duration.normal).toBeGreaterThanOrEqual(250);
    expect(motion.duration.normal).toBeLessThanOrEqual(400);
    // The hero is allowed a little more presence, but not a different species
    // of animation — a hero that takes twice as long reads as a delay.
    expect(motion.duration.slow).toBeGreaterThan(motion.duration.normal);
    expect(motion.duration.slow).toBeLessThanOrEqual(motion.duration.normal * 1.4);
  });

  it('caps the total stagger so the last card is never a wait', () => {
    // 40–70ms per step was the brief; the cap is what stops a long screen
    // from turning that into a queue the user watches.
    expect(motion.entrance.staggerMs).toBeGreaterThanOrEqual(40);
    expect(motion.entrance.staggerMs).toBeLessThanOrEqual(70);
    expect(motion.entrance.staggerCapMs).toBeLessThanOrEqual(400);
  });

  it('keeps press scale in transform range, never a layout change', () => {
    for (const scale of [motion.press.cardScale, motion.press.controlScale]) {
      expect(scale).toBeGreaterThanOrEqual(0.96);
      expect(scale).toBeLessThan(1);
    }
    // A card is a bigger surface, so the same proportional shrink is a bigger
    // movement: it must travel LESS than a control, not more.
    expect(motion.press.cardScale).toBeGreaterThan(motion.press.controlScale);
  });

  it('keeps the pulse weak, slow and finite', () => {
    // Weak: anything stronger reads as an error state.
    expect(motion.pulse.scaleTo).toBeLessThanOrEqual(1.05);
    // Readable at every point in the cycle — never a blink.
    expect(motion.pulse.opacityTo).toBeGreaterThanOrEqual(0.75);
    // Slow enough to be felt rather than noticed.
    expect(motion.pulse.periodMs).toBeGreaterThanOrEqual(1500);
    // And it ENDS. A badge pulsing on minute two is a badge nobody sees.
    expect(motion.pulse.maxCycles).toBeGreaterThan(0);
    expect(motion.pulse.maxCycles).toBeLessThanOrEqual(4);
  });

  it('lets the screen settle before the sweep, and sweeps once', () => {
    // The brief: 500–900ms after the screen appears.
    expect(motion.sweep.delayMs).toBeGreaterThanOrEqual(500);
    expect(motion.sweep.delayMs).toBeLessThanOrEqual(900);
    // Subtle enough that the button's own colour still reads as its colour.
    expect(motion.sweep.opacity).toBeLessThanOrEqual(0.3);
    // The sweep must start AFTER the entrance it follows, or it lands on a
    // button that is still moving.
    expect(motion.sweep.delayMs).toBeGreaterThan(motion.duration.slow);
  });

  it('gives Reduce Motion a fade shorter than any real animation', () => {
    expect(motion.duration.reducedFade).toBeLessThan(motion.duration.normal);
  });
});
