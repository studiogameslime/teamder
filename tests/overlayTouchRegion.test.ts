// Guard for a bug class this app has now hit twice.
//
// An `absoluteFill` View mounted over a ScrollView and then UNMOUNTED leaves a
// stale native touch region on Fabric: the screen behind it stops accepting taps
// until a scroll forces the touch targets to be rebuilt. It was diagnosed once
// on MatchDetails' confetti host and fixed by keeping the host permanently
// mounted and toggling only its contents — and then reported again from
// production, in the user's words:
//
//   "לפעמים שלוחצים על כפתורים הם לא עובדים בכלל ולאחר שקצת גוללים באותו עמוד
//    אז ניתן אחר כך ללחוץ על הכפתורים"
//
// …because the two overlays that mount on that same screen right after a
// registration still used the old pattern. `pointerEvents="none"` does not save
// it: the stale region is left by the unmount, not by the mounted view.
//
// There is no RN renderer in this project's jest setup (logic-only, node env),
// so this reads the sources. A shallow check, but it is the check that would
// have caught both occurrences — and it costs nothing to keep.

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');

/** Full-screen overlays that live over a scrolling screen. */
const OVERLAYS = [
  'src/components/anim/game/RegistrationSuccessAnimation.tsx',
  'src/components/anim/game/WaitlistPromotionAnimation.tsx',
];

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('full-screen overlays keep their host mounted', () => {
  for (const rel of OVERLAYS) {
    describe(path.basename(rel), () => {
      const src = read(rel);

      it('covers the screen with an absoluteFill host', () => {
        expect(src).toMatch(/absoluteFill/);
      });

      it('never unmounts that host on a visibility flag', () => {
        // The exact shape of the bug: bail out of render entirely when hidden.
        expect(src).not.toMatch(/if\s*\(\s*!\s*(visible|show|open|active)\s*\)\s*return null/);
      });

      it('is not hit-tested while it sits there', () => {
        expect(src).toMatch(/pointerEvents="none"/);
      });

      it('still gates its CONTENT on the flag, so nothing shows when hidden', () => {
        expect(src).toMatch(/\{visible &&|visible \?/);
      });
    });
  }
});

describe('the host that was fixed first stays fixed', () => {
  const src = read('src/screens/games/MatchDetailsScreen.tsx');

  it('MatchDetails still wraps its celebration layer in a permanent host', () => {
    // The wrapper is mounted unconditionally; only CelebrationOverlay inside it
    // toggles. If someone inlines `{celebrate ? <CelebrationOverlay/> : null}`
    // as a direct child of the root again, this fails.
    expect(src).toMatch(/<View pointerEvents="none" style=\{styles\.confettiLayer\}>/);
  });
});
