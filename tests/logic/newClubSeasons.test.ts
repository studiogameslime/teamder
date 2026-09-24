// Seasons, decided when a club is created.
//
// Asked for 24.09: "מועדון חדש יחליט אם יש לו עונות או לא… שיקבע אם זה מבוסס
// מחזורים או זמן וזהו" — and explicitly NOT the rest of the seasons screen,
// because a club being created has no season to close and no history to decide
// about. This pins the shape of the call the creation screen makes, since the
// wrong shape here is how a brand-new club ends up sealing a season it never
// played.

import {
  NEW_CLUB_SEASONS_DEFAULT,
  newClubSeasonsArgs as enableArgs,
} from '@/utils/newClubSeasons';
import { MIN_SEASON_ROUNDS, isValidSeasonRounds } from '@/utils/seasonActivation';

describe('the default', () => {
  it('is OFF', () => {
    // A club that has never played an evening has no idea yet whether it wants
    // a competition with a finish line, and the edit screen is one tap away.
    expect(NEW_CLUB_SEASONS_DEFAULT.enabled).toBe(false);
  });

  it('carries a usable target anyway, so turning it on needs no second step', () => {
    expect(isValidSeasonRounds(NEW_CLUB_SEASONS_DEFAULT.targetRounds)).toBe(true);
    expect(NEW_CLUB_SEASONS_DEFAULT.months).toBeGreaterThan(0);
  });

  it('sends nothing at all when left off', () => {
    expect(enableArgs(NEW_CLUB_SEASONS_DEFAULT, 'g1')).toBeNull();
  });
});

describe('what the creation screen sends', () => {
  it('a rounds season carries its target and no months', () => {
    const args = enableArgs(
      { ...NEW_CLUB_SEASONS_DEFAULT, enabled: true, cadenceType: 'rounds', targetRounds: 24 },
      'g1',
    );
    expect(args).toEqual({ groupId: 'g1', cadenceType: 'rounds', targetRounds: 24 });
  });

  it('a date season carries its months and no target', () => {
    const args = enableArgs(
      { ...NEW_CLUB_SEASONS_DEFAULT, enabled: true, cadenceType: 'date', months: 6 },
      'g1',
    );
    expect(args).toEqual({ groupId: 'g1', cadenceType: 'date', months: 6 });
  });

  it('NEVER carries historyChoice', () => {
    // It decides what to do with evenings already played. A club created a
    // second ago has none, and sending one would ask the server to seal a
    // history that does not exist — which is the bug this whole change sits
    // next to.
    const args = enableArgs({ ...NEW_CLUB_SEASONS_DEFAULT, enabled: true }, 'g1');
    expect(args).not.toHaveProperty('historyChoice');
    expect(args).not.toHaveProperty('season1EndsOn');
  });
});

describe('the target the form can produce', () => {
  it('cannot go below the floor a season may be sealed at', () => {
    // The stepper's `min`. If these ever diverge a club could be created with
    // a target it is not allowed to reach.
    expect(MIN_SEASON_ROUNDS).toBe(2);
    expect(isValidSeasonRounds(MIN_SEASON_ROUNDS)).toBe(true);
    expect(isValidSeasonRounds(MIN_SEASON_ROUNDS - 1)).toBe(false);
  });
});
