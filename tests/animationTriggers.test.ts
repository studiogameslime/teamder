import {
  decideRegistrationVariant,
  isLastSpotCelebration,
  isWaitlistPromotion,
  shouldAnimateDraftPick,
  balanceTiming,
  decideTeamsReveal,
  isNewEntity,
  type LastSpotInput,
} from '@/components/anim/game/triggerLogic';

describe('decideRegistrationVariant (Anim 1)', () => {
  it('returns the confirmed status for each real variant', () => {
    expect(decideRegistrationVariant('registered')).toBe('registered');
    expect(decideRegistrationVariant('waitlisted')).toBe('waitlisted');
    expect(decideRegistrationVariant('pendingApproval')).toBe('pendingApproval');
  });
  it('plays nothing on a failed / rolled-back request (no status)', () => {
    expect(decideRegistrationVariant(null)).toBeNull();
    expect(decideRegistrationVariant(undefined)).toBeNull();
    // a bogus value never animates
    expect(decideRegistrationVariant('nope' as never)).toBeNull();
  });
});

describe('isLastSpotCelebration (Anim 3)', () => {
  const base: LastSpotInput = {
    variant: 'registered',
    cause: 'selfRegister',
    freeSpotsBefore: 1,
    isFullAfter: true,
  };
  it('celebrates only a self-registration that took the final spot', () => {
    expect(isLastSpotCelebration(base)).toBe(true);
  });
  it('does not celebrate when the user went to the waitlist', () => {
    expect(isLastSpotCelebration({ ...base, variant: 'waitlisted' })).toBe(false);
  });
  it('does not celebrate an admin-add / promotion / guest-add', () => {
    expect(isLastSpotCelebration({ ...base, cause: 'adminAdd' })).toBe(false);
    expect(isLastSpotCelebration({ ...base, cause: 'promotion' })).toBe(false);
    expect(isLastSpotCelebration({ ...base, cause: 'guestAdd' })).toBe(false);
  });
  it('does not celebrate a listener-driven count change', () => {
    expect(isLastSpotCelebration({ ...base, cause: 'listenerRefresh' })).toBe(false);
  });
  it('does not celebrate when the game was already full before', () => {
    expect(isLastSpotCelebration({ ...base, freeSpotsBefore: 0 })).toBe(false);
  });
  it('does not celebrate when there was more than one free spot', () => {
    expect(isLastSpotCelebration({ ...base, freeSpotsBefore: 2 })).toBe(false);
  });
  it('does not celebrate when the game is not full after', () => {
    expect(isLastSpotCelebration({ ...base, isFullAfter: false })).toBe(false);
  });
});

describe('isWaitlistPromotion (Anim 2)', () => {
  it('fires on a real waitlist → registered transition', () => {
    expect(isWaitlistPromotion('waitlisted', 'registered')).toBe(true);
  });
  it('does not fire on initial load (no previous status)', () => {
    expect(isWaitlistPromotion(undefined, 'registered')).toBe(false);
    expect(isWaitlistPromotion(null, 'registered')).toBe(false);
  });
  it('does not fire on a same-status refresh (listener replay)', () => {
    expect(isWaitlistPromotion('registered', 'registered')).toBe(false);
    expect(isWaitlistPromotion('waitlisted', 'waitlisted')).toBe(false);
  });
  it('does not fire on unrelated transitions', () => {
    expect(isWaitlistPromotion('pendingApproval', 'registered')).toBe(false);
    expect(isWaitlistPromotion('registered', 'waitlisted')).toBe(false);
  });
});

describe('shouldAnimateDraftPick (Anim 12)', () => {
  it('animates a confirmed pick that is new since load', () => {
    expect(
      shouldAnimateDraftPick({ saveConfirmed: true, isNewSinceInitialLoad: true }),
    ).toBe(true);
  });
  it('does not animate picks already present at initial load (read-only replay)', () => {
    expect(
      shouldAnimateDraftPick({ saveConfirmed: true, isNewSinceInitialLoad: false }),
    ).toBe(false);
  });
  it('does not animate an unconfirmed / failed save', () => {
    expect(
      shouldAnimateDraftPick({ saveConfirmed: false, isNewSinceInitialLoad: true }),
    ).toBe(false);
  });
});

describe('balanceTiming (Anim 13)', () => {
  it('always shows a minimal compute phase and never loops', () => {
    const t = balanceTiming();
    expect(t.minComputeMs).toBeGreaterThanOrEqual(300);
    expect(t.maxComputeMs).toBeLessThanOrEqual(700);
    expect(t.minComputeMs).toBeLessThanOrEqual(t.maxComputeMs);
    expect(t.loopShuffle).toBe(false);
  });
});

describe('decideTeamsReveal (Anim 13)', () => {
  it('shuffles for a user-initiated balance (2/3/4 teams alike)', () => {
    expect(decideTeamsReveal({ userInitiated: true, teamsJustArrived: true })).toBe(
      'shuffle',
    );
  });
  it('gently enters server-scheduled teams the user did not just request', () => {
    expect(
      decideTeamsReveal({ userInitiated: false, teamsJustArrived: true }),
    ).toBe('gentleEntrance');
  });
  it('does nothing when no new teams arrived (e.g. a manual drag edit)', () => {
    expect(decideTeamsReveal({ userInitiated: true, teamsJustArrived: false })).toBe(
      'none',
    );
    expect(
      decideTeamsReveal({ userInitiated: false, teamsJustArrived: false }),
    ).toBe('none');
  });
});

describe('isNewEntity (Anim 5 / 7)', () => {
  it('is true when the id changes to a real new one', () => {
    expect(isNewEntity('g1', 'g2')).toBe(true);
    expect(isNewEntity(undefined, 'g1')).toBe(true);
  });
  it('is false for the same id (realtime update of the same game)', () => {
    expect(isNewEntity('g1', 'g1')).toBe(false);
  });
  it('is false when there is no current id', () => {
    expect(isNewEntity('g1', null)).toBe(false);
    expect(isNewEntity('g1', undefined)).toBe(false);
  });
});
