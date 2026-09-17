// What the growth journeys are allowed to say, and when they may say it again.
//
// These thresholds decide the wording of every push in the squad-building
// journey. The owner's requirement drives the whole file: do not stop at one
// member, keep going to ten, and never tell somebody with three players to
// "add your first friend".
import {
  stageFor,
  missingForPlayable,
  milestoneCrossed,
  organiserAttributes,
  PLAYABLE_ROSTER,
  ROSTER_MILESTONES,
} from '@/utils/organiserState';

describe('what stage an organiser is at', () => {
  it('a club with nobody in it is invisible to everyone but its owner', () => {
    expect(stageFor(0)).toBe('empty');
  });

  it('one member is NOT done — this is the whole point', () => {
    // The first version of this journey exited here. One player is not a game.
    expect(stageFor(1)).toBe('seeded');
    expect(stageFor(3)).toBe('seeded');
  });

  it('four is a squad taking shape, eight is the finish line', () => {
    expect(stageFor(4)).toBe('forming');
    expect(stageFor(7)).toBe('forming');
    expect(stageFor(8)).toBe('nearly');
    expect(stageFor(9)).toBe('nearly');
  });

  it('ten is playable, and the asking stops', () => {
    expect(stageFor(PLAYABLE_ROSTER)).toBe('playable');
    expect(stageFor(25)).toBe('playable');
  });

  it('survives rubbish', () => {
    expect(stageFor(-4)).toBe('empty');
    expect(stageFor(NaN)).toBe('empty');
    expect(stageFor(undefined as never)).toBe('empty');
  });
});

describe('how many are still missing', () => {
  it('counts down to a playable club', () => {
    expect(missingForPlayable(0)).toBe(10);
    expect(missingForPlayable(3)).toBe(7);
    expect(missingForPlayable(9)).toBe(1);
  });

  it('never says "another 0", and never goes negative', () => {
    // A push reading "עוד 0 ויש לכם מחזור" is the kind of thing that gets an
    // app muted.
    expect(missingForPlayable(10)).toBe(0);
    expect(missingForPlayable(30)).toBe(0);
  });
});

describe('when a milestone fires', () => {
  it('fires on the way up', () => {
    expect(milestoneCrossed(1, 2)).toBe(2);
    expect(milestoneCrossed(4, 5)).toBe(5);
    expect(milestoneCrossed(9, 10)).toBe(10);
  });

  it('stays quiet between milestones', () => {
    expect(milestoneCrossed(2, 3)).toBeNull();
    expect(milestoneCrossed(5, 7)).toBeNull();
  });

  it('reports only the HIGHEST when several are crossed at once', () => {
    // A club that imports a whole WhatsApp group goes 0 → 14 in one go. It
    // deserves one "you are ready", not three notifications narrating a
    // journey it has already finished.
    expect(milestoneCrossed(0, 14)).toBe(10);
    expect(milestoneCrossed(0, 6)).toBe(5);
  });

  it('never fires twice for the same ground', () => {
    // Against the club's own high-water mark, so losing a player and re-adding
    // them is silent. Re-sending a message is how an organiser turns
    // notifications off.
    expect(milestoneCrossed(10, 9)).toBeNull();
    expect(milestoneCrossed(10, 10)).toBeNull();
    expect(milestoneCrossed(12, 11)).toBeNull();
  });

  it('the milestones are the three points where the message changes', () => {
    expect(ROSTER_MILESTONES).toEqual([2, 5, 10]);
  });
});

describe('the attributes a journey branches on', () => {
  it('reports the BIGGEST club the person admins', () => {
    const a = organiserAttributes([3, 11, 1]);
    expect(a.club_size).toBe(11);
    expect(a.club_stage).toBe('playable');
    expect(a.clubs_admin).toBe(3);
    expect(a.club_missing).toBe(0);
  });

  it('an organiser of nothing is not told to grow a club', () => {
    // Belonging to somebody else's big club must not look like running one.
    const a = organiserAttributes([]);
    expect(a.club_size).toBe(0);
    expect(a.clubs_admin).toBe(0);
    expect(a.club_stage).toBe('empty');
  });

  it('carries the countdown the copy uses', () => {
    expect(organiserAttributes([6]).club_missing).toBe(4);
    expect(organiserAttributes([6]).club_stage).toBe('forming');
  });
});
