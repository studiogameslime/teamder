/**
 * The home screen's round area, as a decision.
 *
 * Two things are pinned here. The ORDER of the questions — because the bugs
 * this replaces were all order bugs: a player on the overflow waitlist shown
 * a green "you're in", a full game whose registration had closed offering the
 * waitlist, a scheduled game hidden because it was not joinable yet. And the
 * refusal to invent — a spots-left of an uncapped game, a waitlist position
 * for someone not on the list, a zero metric on an evening nobody counted.
 */
import {
  deriveRoundState,
  pickHomeRound,
  completedMetrics,
  isShowableUpcoming,
  STARTS_SOON_MS,
} from '@/utils/homeRoundState';
import { canJoinGame } from '@/services/gameLifecycle';
import type { Game } from '@/types';

const ME = 'me';
const NOW = new Date('2026-10-07T12:00:00+03:00').getTime();
const HOUR = 60 * 60 * 1000;

const game = (o: Partial<Game> = {}): Game =>
  ({
    id: 'g1',
    groupId: 'c1',
    title: 'חמישי כדורגל',
    startsAt: NOW + 48 * HOUR,
    status: 'open',
    players: [],
    waitlist: [],
    maxPlayers: 15,
    matches: [],
    fieldName: 'מגרש',
    ...o,
  }) as Game;

describe('the order of the questions', () => {
  it('a running evening beats everything, including my place in it', () => {
    const g = game({ status: 'active', players: [ME] });
    expect(deriveRoundState(g, ME, NOW).kind).toBe('live');
  });

  it('a legacy live game (status open + phase live) is live too', () => {
    // Stage 1 wrote `phase: 'live'` with status 'open'. `gameLifecycle`
    // normalises it and this must inherit that, not re-decide it.
    const g = game({ liveMatch: { phase: 'live' } } as Partial<Game>);
    expect(deriveRoundState(g, ME, NOW).kind).toBe('live');
  });

  it('the WAITLIST is asked before "registered" — it is not being in', () => {
    // The bug this prevents: a player holding place 3 in the queue shown a
    // green "אתה רשום ✓".
    const g = game({ players: ['a'], waitlist: ['b', ME] });
    const s = deriveRoundState(g, ME, NOW);
    expect(s.kind).toBe('waitlist');
    expect(s.viewerRegistered).toBe(false);
    expect(s.waitlistPosition).toBe(2);
  });

  it('awaiting approval is its own answer, not a registration', () => {
    const g = game({ requiresApproval: true, pending: [ME] });
    expect(deriveRoundState(g, ME, NOW).kind).toBe('pending');
  });

  it('a registered player on the day gets "today"', () => {
    const g = game({ players: [ME], startsAt: NOW + 5 * HOUR });
    expect(deriveRoundState(g, ME, NOW).kind).toBe('today');
  });

  it('…but someone NOT in it sees the registration, not the date', () => {
    // Today is interesting to a player who is coming. To everyone else the
    // useful thing today is still the open place.
    const g = game({ startsAt: NOW + 5 * HOUR });
    expect(deriveRoundState(g, ME, NOW).kind).toBe('open');
  });

  it('a registered player on another day is simply registered', () => {
    const g = game({ players: [ME] });
    expect(deriveRoundState(g, ME, NOW).kind).toBe('registered');
  });

  it('a scheduled game is SHOWN, as "opens soon" — never hidden', () => {
    const g = game({ status: 'scheduled', registrationOpensAt: NOW + 20 * HOUR });
    const s = deriveRoundState(g, ME, NOW);
    expect(s.kind).toBe('opensSoon');
    expect(s.opensAt).toBe(NOW + 20 * HOUR);
  });

  it('an open game whose own opening time is still ahead is also "opens soon"', () => {
    // Covers the window where the flip has not run yet.
    const g = game({ status: 'open', registrationOpensAt: NOW + 2 * HOUR });
    expect(deriveRoundState(g, ME, NOW).kind).toBe('opensSoon');
  });

  it('closed is asked BEFORE full — a closed full game is closed', () => {
    // 'locked' is not joinable. Answering "full" there would offer a
    // waitlist that the server would refuse.
    const g = game({ status: 'locked', players: Array(15).fill('x') });
    expect(deriveRoundState(g, ME, NOW).kind).toBe('closed');
  });

  it('past the one-hour post-kickoff grace the door is closed', () => {
    // The grace window is gameLifecycle's, not this module's.
    const g = game({ startsAt: NOW - 2 * HOUR });
    expect(deriveRoundState(g, ME, NOW).kind).toBe('closed');
  });

  it('a full open game is "full"', () => {
    const g = game({ players: Array(15).fill('x') });
    expect(deriveRoundState(g, ME, NOW).kind).toBe('full');
  });

  it('otherwise it is open', () => {
    const g = game({ players: ['a', 'b'] });
    expect(deriveRoundState(g, ME, NOW).kind).toBe('open');
  });
});

describe('the door check stays in step with gameLifecycle', () => {
  // `deriveRoundState` asks "is the door open" from the same parts
  // `canJoinGame` is built from, so that the clock can be injected. These
  // two must never disagree at the present moment — if `canJoinGame` grows
  // a rung and this module does not, this is what notices.
  const now = Date.now();
  const cases: [string, Game][] = [
    ['open, future kickoff', game({ startsAt: now + 48 * HOUR })],
    ['open, full', game({ startsAt: now + 48 * HOUR, players: Array(15).fill('x') })],
    ['locked', game({ status: 'locked', startsAt: now + 48 * HOUR })],
    ['finished', game({ status: 'finished', startsAt: now - 48 * HOUR })],
    ['cancelled', game({ status: 'cancelled', startsAt: now + 48 * HOUR })],
    ['past the grace window', game({ startsAt: now - 2 * HOUR })],
    ['inside the grace window', game({ startsAt: now - 10 * 60 * 1000 })],
    ['round running', game({ liveMatch: { phase: 'roundRunning' } } as Partial<Game>)],
  ];
  it.each(cases)('agrees on: %s', (_label, g) => {
    const derivedClosed = deriveRoundState(g, 'nobody', now).kind === 'closed';
    // 'closed' is only reachable once the earlier rungs have passed, so
    // compare on the games where neither live/scheduled short-circuits.
    const s = deriveRoundState(g, 'nobody', now);
    if (s.kind === 'live' || s.kind === 'opensSoon') return;
    expect(derivedClosed).toBe(!canJoinGame(g));
  });
});

describe('the numbers it prints', () => {
  it('counts non-waitlisted guests towards occupancy', () => {
    const g = game({
      players: ['a', 'b'],
      guests: [{ waitlisted: false }, { waitlisted: true }],
    } as Partial<Game>);
    const s = deriveRoundState(g, ME, NOW);
    expect(s.registered).toBe(3);
    expect(s.spotsLeft).toBe(12);
  });

  it('an uncapped game has NO capacity and NO spots left', () => {
    // Not zero. "How many places are left" has no answer without a maximum,
    // and a progress bar over nothing is a lie.
    const g = game({ maxPlayers: 0, players: ['a'] });
    const s = deriveRoundState(g, ME, NOW);
    expect(s.capacity).toBeNull();
    expect(s.spotsLeft).toBeNull();
  });

  it('never reports a negative number of places', () => {
    const g = game({ maxPlayers: 2, players: ['a', 'b', 'c'] });
    expect(deriveRoundState(g, ME, NOW).spotsLeft).toBe(0);
  });

  it('a waitlist position is null for someone not on the list', () => {
    const g = game({ waitlist: ['a', 'b'] });
    const s = deriveRoundState(g, ME, NOW);
    expect(s.waitlistPosition).toBeNull();
    expect(s.waitlistCount).toBe(2);
  });

  it('counts down only inside the six-hour window', () => {
    const near = deriveRoundState(
      game({ players: [ME], startsAt: NOW + STARTS_SOON_MS - HOUR }),
      ME,
      NOW,
    );
    const far = deriveRoundState(
      game({ players: [ME], startsAt: NOW + STARTS_SOON_MS + HOUR }),
      ME,
      NOW,
    );
    expect(near.startsSoon).toBe(true);
    expect(far.startsSoon).toBe(false);
  });

  it('"today" is a calendar day, not a duration', () => {
    // Kickoff at 23:00 tonight is today, even though it is 11 hours away.
    const tonight = new Date('2026-10-07T23:00:00+03:00').getTime();
    const s = deriveRoundState(game({ players: [ME], startsAt: tonight }), ME, NOW);
    expect(s.isToday).toBe(true);
    expect(s.kind).toBe('today');
  });
});

describe('which cards the area shows', () => {
  const up = game({ id: 'up' });
  const done = game({ id: 'done', status: 'finished' });

  it('upcoming alone', () => {
    expect(pickHomeRound(up, null)).toEqual({
      upcoming: up,
      completed: null,
      completedRole: null,
      showEmpty: false,
    });
  });

  it('upcoming AND completed — the upcoming one leads, the summary shrinks', () => {
    // The case the whole layout exists for: last night finished and next
    // week is already open.
    const r = pickHomeRound(up, done);
    expect(r.upcoming).toBe(up);
    expect(r.completedRole).toBe('compact');
    expect(r.showEmpty).toBe(false);
  });

  it('completed with nothing coming — the summary leads, and the empty CTA follows', () => {
    const r = pickHomeRound(null, done);
    expect(r.completedRole).toBe('primary');
    expect(r.showEmpty).toBe(true);
  });

  it('neither — the opportunity card alone', () => {
    const r = pickHomeRound(null, null);
    expect(r.completedRole).toBeNull();
    expect(r.showEmpty).toBe(true);
  });

  it('a cancelled game is never led with', () => {
    expect(isShowableUpcoming(game({ status: 'cancelled' }))).toBe(false);
    expect(isShowableUpcoming(null)).toBe(false);
    expect(isShowableUpcoming(up)).toBe(true);
  });
});

describe('what the completed card may claim', () => {
  it('prints the mini-games and the roster when the evening has them', () => {
    const g = game({ status: 'finished', committedRoundCount: 12, players: Array(28).fill('x') });
    expect(completedMetrics(g)).toEqual([
      { key: 'rounds', value: 12 },
      { key: 'players', value: 28 },
    ]);
  });

  it('omits a metric it does not have rather than printing a zero', () => {
    // An evening nobody counted did not play zero mini-games — we simply do
    // not know, and "0 משחקונים" would be a statement that it did.
    const g = game({ status: 'finished', players: ['a'] });
    expect(completedMetrics(g).map((m) => m.key)).toEqual(['players']);
  });

  it('says nothing at all when it knows nothing', () => {
    expect(completedMetrics(game({ status: 'finished', players: [] }))).toEqual([]);
  });
});
