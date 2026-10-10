/**
 * Switching "תזמון פתיחת הרשמה" OFF has to do something.
 *
 * Reported from a real club: the admin turns the toggle off, saves, and
 * nothing happens — the game stays scheduled and the roster is never told.
 * The cause was a patch that was built only for the ON case:
 *
 *   v.scheduledRegEnabled && status === 'scheduled' && opensAt > 0
 *     ? { registrationOpensAt: opensAt }
 *     : {}                                    // ← off writes NOTHING
 *
 * The reporter's expectation is the right one: turning the schedule off means
 * "open it now, and send the push". Stamping the moment of saving makes the
 * game due, and the server's own self-verifying flip does the rest.
 */

import { registrationEditPatch as regOpensPatch } from '@/utils/registrationEdit';

const NOW = 1_789_400_000_000;
const LATER = NOW + 3 * 24 * 60 * 60 * 1000;

describe('turning the schedule off', () => {
  it('stamps NOW, so the game becomes due', () => {
    expect(regOpensPatch('scheduled', false, LATER, NOW)).toEqual({
      registrationOpensAt: NOW,
    });
  });

  it('does it even when the picker still holds an old date', () => {
    // The field is not cleared by the toggle, so the stale value must not win.
    expect(regOpensPatch('scheduled', false, LATER, NOW).registrationOpensAt).toBe(NOW);
  });

  it('and when the picker was never filled in at all', () => {
    expect(regOpensPatch('scheduled', false, 0, NOW)).toEqual({
      registrationOpensAt: NOW,
    });
  });
});

describe('turning it on, or leaving it on', () => {
  it('keeps the chosen moment', () => {
    expect(regOpensPatch('scheduled', true, LATER, NOW)).toEqual({
      registrationOpensAt: LATER,
    });
  });

  it('but an ON toggle with no date still opens now rather than never', () => {
    expect(regOpensPatch('scheduled', true, 0, NOW)).toEqual({
      registrationOpensAt: NOW,
    });
  });
});

describe('a game that is no longer scheduled', () => {
  it('is never touched, whichever way the toggle sits', () => {
    // Past the flip the field is moot, and rewriting it would re-arm a game
    // people have already joined.
    for (const status of ['locked', 'active', 'finished', 'cancelled']) {
      expect(regOpensPatch(status, false, LATER, NOW)).toEqual({});
      expect(regOpensPatch(status, true, LATER, NOW)).toEqual({});
    }
  });
});
