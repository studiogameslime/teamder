// Teamder Assistant — rule engine.
//
// The whole point of keeping the rules pure is that the interesting questions
// ("does game day beat a milestone?", "does it repeat a card that's already on
// screen?", "does the copy hold still during the day?") are answerable without
// a renderer. These tests pin the behaviour that the feature exists for.

import { resolveAssistantMessage, pickVariant } from '@/utils/assistant/resolve';
import { ASSISTANT_RULES } from '@/utils/assistant/rules';
import {
  AssistantPriority,
  type AssistantContext,
} from '@/utils/assistant/types';
import { he } from '@/i18n/he';
import type { ClubInsight } from '@/services/assistantInsightsService';
import type { Game, Group, User } from '@/types';

/** A club standing with everything switched off — override just what a test
 *  is actually about, so an unrelated field can't silently drive the result. */
function insight(over: Partial<ClubInsight> = {}): ClubInsight {
  return {
    goals: 0,
    assists: 0,
    scorerPlace: 1,
    scorerTotal: 1,
    isTopScorer: false,
    goalsToCrown: null,
    isTopAssister: false,
    assistsToCrown: null,
    rivalName: null,
    goalsToPassRival: null,
    attendanceStreak: 0,
    attendedNights: 0,
    winsPlace: null,
    ...over,
  };
}

const DAY = 86_400_000;
const NOW = new Date('2026-08-10T09:00:00Z').getTime();

function makeUser(stats: Partial<NonNullable<User['stats']>> = {}): User {
  return {
    id: 'me',
    name: 'מתן לוי',
    createdAt: 0,
    onboardingCompleted: true,
    availability: { preferredDays: [4], isAvailableForInvites: true },
    stats: { totalGames: 0, attended: 0, cancelled: 0, ...stats },
  } as User;
}

function makeGame(startsAt: number): Game {
  return { id: 'g1', startsAt, players: [], waitlist: [] } as unknown as Game;
}

function makeGroup(): Group {
  return { id: 'c1', adminIds: [], playerIds: ['me'] } as unknown as Group;
}

function ctx(over: Partial<AssistantContext> = {}): AssistantContext {
  return {
    now: NOW,
    nonce: 1,
    user: makeUser(),
    nextGame: null,
    isGameToday: false,
    communities: [makeGroup()],
    isClubAdmin: false,
    playedThisWeek: 0,
    lastPlayedMs: null,
    playedCount: 0,
    markedAvailability: true,
    bestEvening: null,
    clubName: 'כדורגל אנשים טובים',
    clubInsight: null,
    shown: {
      nextGameCard: false,
      recommendedDay: false,
      availabilityPodium: false,
      upcomingScheduledCard: false,
      availabilityPrompt: false,
    },
    ...over,
  };
}

const resolve = (c: AssistantContext) => resolveAssistantMessage(c, ASSISTANT_RULES);

describe('assistant priority', () => {
  it('always has something to say to a brand-new player', () => {
    const m = resolve(ctx({ communities: [], user: makeUser() }));
    expect(m).not.toBeNull();
    expect(m!.cta).toBeDefined();
  });

  it('leaves pending requests to the bell and its count badge', () => {
    // The bell at the top of the home screen already shows these with a
    // number. No assistant line may re-state them, whatever else is going on.
    const everyState = [
      ctx(),
      ctx({ nextGame: makeGame(NOW + 3600_000), isGameToday: true }),
      ctx({ communities: [] }),
      ctx({ lastPlayedMs: NOW - 40 * DAY, playedCount: 12 }),
    ];
    for (const c of everyState) {
      const m = resolve(c);
      expect(m?.priority).not.toBe(AssistantPriority.EVENT);
      expect(m?.cta?.action.kind).not.toBe('openRequests');
      expect(m?.text ?? '').not.toContain('בקש');
    }
  });

  it('game day beats a milestone and a quiet club', () => {
    const m = resolve(
      ctx({
        nextGame: makeGame(NOW + 3600_000),
        isGameToday: true,
        user: makeUser({ assists: 24 }),
      }),
    );
    expect(m!.priority).toBe(AssistantPriority.GAME_DAY);
  });

  it('a milestone within reach upgrades game day from a cheer to a stake', () => {
    const generic = resolve(
      ctx({ nextGame: makeGame(NOW + 3600_000), isGameToday: true }),
    );
    expect(generic!.scenario).toBe('gameDay');

    const withStake = resolve(
      ctx({
        nextGame: makeGame(NOW + 3600_000),
        isGameToday: true,
        user: makeUser({ goals: 19 }),
      }),
    );
    expect(withStake!.scenario).toBe('gameDayInsight');
    expect(withStake!.text).toContain('20');
  });
});

describe('no duplication of what the home screen already shows', () => {
  it('stays off availability numbers when the recommended-day card is up', () => {
    const base = {
      bestEvening: { dateMs: NOW + 2 * DAY, weekday: 4, count: 12 },
    };
    const quiet = resolve(
      ctx({
        ...base,
        shown: {
          nextGameCard: false,
          recommendedDay: true,
          availabilityPodium: false,
          upcomingScheduledCard: false,
          availabilityPrompt: false,
        },
      }),
    );
    expect(quiet!.scenario).not.toBe('availabilityMatch');

    const speaks = resolve(ctx(base));
    expect(speaks!.scenario).toBe('availabilityMatch');
  });

  it('never repeats kickoff details on game day', () => {
    const m = resolve(
      ctx({ nextGame: makeGame(NOW + 3600_000), isGameToday: true }),
    );
    // No clock, no date, no sign-up counts — that is the next-match card's job.
    expect(m!.text).not.toMatch(/\d{1,2}:\d{2}/);
    expect(m!.sub).toBeUndefined();
  });
});

describe('never invents a number', () => {
  it('says nothing numeric about a player with no stats at all', () => {
    const m = resolve(ctx({ user: makeUser(), playedCount: 0 }));
    expect(m!.text).not.toMatch(/\d/);
  });

  it('skips the rivalry line when the rival could not be named', () => {
    const m = resolve(ctx({ clubInsight: insight({ rivalName: null }) }));
    expect(m!.scenario).not.toBe('rivalry');
  });

  it('only claims a milestone that is genuinely close', () => {
    // 11 goals is nowhere near the next rung (20) — no milestone claim.
    for (let i = 0; i < 40; i++) {
      const far = resolve(ctx({ user: makeUser({ goals: 11 }), nonce: i }));
      expect(far!.scenario).not.toBe('milestone');
    }

    const near = Array.from({ length: 40 }, (_, i) =>
      resolve(ctx({ user: makeUser({ goals: 18 }), nonce: i })),
    );
    expect(near.some((m) => m!.scenario === 'milestone')).toBe(true);
    expect(
      near.find((m) => m!.scenario === 'milestone')!.text,
    ).toContain('20');
  });
});

describe('lifecycle states', () => {
  it('welcomes a player with no club and offers discovery', () => {
    const m = resolve(ctx({ communities: [], markedAvailability: true }));
    expect(m!.scenario).toBe('joinClub');
    expect(m!.cta!.action.kind).toBe('discoverClubs');
  });

  it('defers the availability ask to the screen s own prompt card', () => {
    // The home screen shows a full-width "set your availability" card to a
    // player who has marked none. The assistant must not ask a second time on
    // the same screen — the club line is the more useful thing to say.
    const m = resolve(
      ctx({
        markedAvailability: false,
        shown: {
          nextGameCard: false,
          recommendedDay: false,
          availabilityPodium: false,
          upcomingScheduledCard: false,
          availabilityPrompt: true,
        },
      }),
    );
    expect(m!.scenario).not.toBe('markAvailability');
  });

  it('asks for availability when nothing else on the screen does', () => {
    // Club member, a match already on the way (so the club is not idle), and
    // no prompt card up — the one state where this is the best thing to say.
    const m = resolve(
      ctx({
        markedAvailability: false,
        shown: {
          nextGameCard: false,
          recommendedDay: false,
          availabilityPodium: false,
          upcomingScheduledCard: true,
          availabilityPrompt: false,
        },
      }),
    );
    expect(m!.scenario).toBe('markAvailability');
    expect(m!.cta!.action.kind).toBe('markAvailability');
  });

  it('invites a long-absent player back without scolding', () => {
    const m = resolve(
      ctx({ lastPlayedMs: NOW - 40 * DAY, playedCount: 12, user: makeUser() }),
    );
    expect(m!.scenario).toBe('comeback');
    expect(m!.cta!.action.kind).toBe('browseGames');
  });

  it('does not treat a one-week gap as an absence', () => {
    const m = resolve(ctx({ lastPlayedMs: NOW - 7 * DAY, playedCount: 12 }));
    expect(m!.scenario).not.toBe('comeback');
  });

  it('celebrates after a match instead of previewing the next one', () => {
    const m = resolve(ctx({ lastPlayedMs: NOW - 3600_000, playedThisWeek: 1 }));
    expect(m!.scenario).toBe('postGame');
    expect(m!.text).toContain('מחזור');
  });

  it('prefers a counted fact over a pat on the back', () => {
    const m = resolve(ctx({ lastPlayedMs: NOW - 3600_000, playedThisWeek: 3 }));
    expect(m!.id).toBe('postGameFact');
    expect(m!.text).toContain('3');
  });

  it('drops the empty cheer once the match is no longer fresh', () => {
    // Yesterday's match with nothing countable to add: a contentless
    // "well done" a day later is worse than a real insight, so the stats band
    // gets the floor instead.
    const drawn = Array.from({ length: 40 }, (_, i) =>
      resolve(
        ctx({
          lastPlayedMs: NOW - 20 * 3600_000,
          playedThisWeek: 1,
          user: makeUser({ goals: 18 }),
          nonce: i,
        }),
      ),
    );
    expect(drawn.every((m) => m!.scenario !== 'postGame')).toBe(true);
    expect(drawn.some((m) => m!.text.includes('20'))).toBe(true);
  });

  it('still reports a counted fact even a day later', () => {
    const m = resolve(
      ctx({ lastPlayedMs: NOW - 20 * 3600_000, playedThisWeek: 3 }),
    );
    expect(m!.id).toBe('postGameFact');
  });

  it('nudges an ADMIN about the quiet club ahead of their own stats', () => {
    // The admin can actually fix it, so the job outranks the personal line.
    const m = resolve(ctx({ isClubAdmin: true, user: makeUser({ goals: 18 }) }));
    expect(m!.scenario).toBe('clubIdle');
    expect(m!.cta!.action.kind).toBe('createGame');
  });

  it('gives a regular MEMBER their personal insight over the club nudge', () => {
    // They can't book for the crew; "two off twenty" is worth more to them.
    // The band itself must win over the club nudge; which of its lines gets
    // drawn (fact or joke) is the per-load lottery.
    const drawn = Array.from({ length: 40 }, (_, i) =>
      resolve(ctx({ isClubAdmin: false, user: makeUser({ goals: 18 }), nonce: i })),
    );
    expect(drawn.every((m) => m!.scenario !== 'clubIdle')).toBe(true);
    expect(drawn.some((m) => m!.scenario === 'milestone')).toBe(true);
  });

  it('still tells a member about the quiet club when nothing sharper exists', () => {
    const m = resolve(ctx({ isClubAdmin: false, user: makeUser() }));
    expect(m!.scenario).toBe('clubIdle');
  });

  it('jokes with a member who has no numbers, instead of one dry line', () => {
    // A player with nothing countable is the one most at risk of tuning the
    // card out, so this is where the coach's humour has to show up.
    const lines = new Set(
      Array.from(
        { length: 40 },
        (_, i) => resolve(ctx({ isClubAdmin: false, nonce: i }))!.text,
      ),
    );
    expect(lines.size).toBeGreaterThan(3);
    const humor = he.assistantHumor as readonly string[];
    expect([...lines].some((t) => humor.includes(t))).toBe(true);
  });

  it('keeps the admin on the actionable line, not the jokes', () => {
    // They can actually book a pitch — don't trade that for a punchline.
    for (let i = 0; i < 40; i++) {
      const m = resolve(ctx({ isClubAdmin: true, nonce: i }));
      expect(he.assistantHumor as readonly string[]).not.toContain(m!.text);
    }
  });

  it('goes quiet on the club nudge when a match is already lined up', () => {
    const m = resolve(ctx({ nextGame: makeGame(NOW + 5 * DAY) }));
    expect(m?.scenario).not.toBe('clubIdle');
    expect(m?.scenario).not.toBe('engagement');
  });
});

describe('copy rotation', () => {
  const variants = ['a', 'b', 'c', 'd', 'e'] as const;

  it('holds still while the screen is open', () => {
    // One nonce per mount: every re-render during that visit re-picks with
    // the same seed, so the sentence can't reshuffle under a scroll.
    const first = pickVariant(variants, 'gameDay', 12345);
    const rerender = pickVariant(variants, 'gameDay', 12345);
    expect(first).toBe(rerender);
  });

  it('moves on across screen loads', () => {
    const seen = new Set(
      Array.from({ length: 30 }, (_, i) =>
        pickVariant(variants, 'gameDay', i),
      ),
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it('gives different scenarios independent rotations', () => {
    const a = Array.from({ length: 10 }, (_, i) =>
      pickVariant(variants, 'gameDay', i),
    ).join('');
    const b = Array.from({ length: 10 }, (_, i) =>
      pickVariant(variants, 'comeback', i),
    ).join('');
    expect(a).not.toBe(b);
  });
});

describe('variety — the coach must not repeat itself', () => {
  // A well-established player: club crowns in reach, a rival, an attendance
  // streak, milestones on several ladders, a shootout record.
  const richPlayer = (over: Partial<AssistantContext> = {}) =>
    ctx({
      user: makeUser({
        goals: 18,
        assists: 23,
        wins: 48,
        totalGames: 60,
        attended: 57,
        penTaken: 6,
        penScored: 5,
        penSaved: 3,
      }),
      playedCount: 48,
      clubInsight: insight({
        goals: 31,
        assists: 23,
        scorerPlace: 2,
        scorerTotal: 24,
        goalsToCrown: 2,
        isTopAssister: true,
        rivalName: 'דניאל',
        goalsToPassRival: 2,
        attendanceStreak: 7,
        attendedNights: 48,
        winsPlace: 2,
      }),
      ...over,
    });

  it('says something different across a month of quiet days', () => {
    const lines = new Set(
      Array.from(
        { length: 30 },
        (_, i) => resolve(richPlayer({ nonce: i }))!.text,
      ),
    );
    // Not a hard number — the point is that it moves through its material
    // instead of parking on one sentence.
    expect(lines.size).toBeGreaterThanOrEqual(5);
  });

  it('varies its game-day stake too', () => {
    const lines = new Set(
      Array.from(
        { length: 30 },
        (_, i) =>
          resolve(
            richPlayer({
              nonce: i,
              nextGame: makeGame(NOW + 3600_000),
              isGameToday: true,
            }),
          )!.text,
      ),
    );
    expect(lines.size).toBeGreaterThan(1);
  });

  it('names the club so the line feels personal', () => {
    const lines = Array.from(
      { length: 30 },
      (_, i) => resolve(richPlayer({ nonce: i }))!.text,
    );
    expect(lines.some((t) => t.includes('כדורגל אנשים טובים'))).toBe(true);
  });

  it('holds one line steady for as long as the screen is up', () => {
    // Same mount → same nonce → same line, no matter how many times the
    // memo recomputes as the club standing and availability land.
    const first = resolve(richPlayer({ nonce: 777 }))!.text;
    const again = resolve(richPlayer({ nonce: 777, playedThisWeek: 1 }))!.text;
    expect(first).toBe(again);
  });

  it('mixes jokes in with the numbers for a player who has both', () => {
    // The owner's ask: a stats-rich player shouldn't only ever get a
    // dashboard line. Humour draws from the same pool as the facts.
    const lines = Array.from(
      { length: 300 },
      (_, i) => resolve(richPlayer({ nonce: i }))!.text,
    );
    const humor = he.assistantHumor as readonly string[];
    expect(lines.some((t) => humor.includes(t))).toBe(true);
    expect(lines.some((t) => !humor.includes(t))).toBe(true);
  });

  it('can tell you how long it has been, in real days', () => {
    // Sampled over many loads: the pool is deliberately wide, so one draw
    // proves nothing — what matters is that the fact is IN it, with the real
    // number attached.
    const lines = Array.from(
      { length: 300 },
      (_, i) =>
        resolve(richPlayer({ nonce: i, lastPlayedMs: NOW - 12 * DAY }))!.text,
    );
    expect(lines.some((t) => t.includes('12 ימים'))).toBe(true);
  });

  it('leaves the day-count to the comeback line once it is three weeks', () => {
    // Two lines about the same gap would be a bug; the soft fact stops
    // exactly where the comeback invitation starts.
    const lines = Array.from(
      { length: 300 },
      (_, i) =>
        resolve(richPlayer({ nonce: i, lastPlayedMs: NOW - 30 * DAY }))!.text,
    );
    expect(lines.some((t) => t.includes('30 ימים מאז'))).toBe(false);
  });

  it('has a genuinely wide pool for a player with a full record', () => {
    // The whole point of the band. If a future change collapses the pool
    // (one rule swallowing the rest, a bad gate), this is what catches it.
    const lines = new Set(
      Array.from({ length: 300 }, (_, i) => resolve(richPlayer({ nonce: i }))!.text),
    );
    expect(lines.size).toBeGreaterThanOrEqual(20);
  });

  it('states a career total even when no milestone is close', () => {
    // 34 goals is 16 short of 50 — the milestone ladder stays silent, and
    // without the career line the player would never hear his own number.
    const lines = Array.from({ length: 300 }, (_, i) =>
      resolve(richPlayer({ nonce: i, user: makeUser({ goals: 34 }) }))!.text,
    );
    expect(lines.some((t) => t.includes('34 שערים'))).toBe(true);
  });

  it('owns the own-goals column, and only when there is one', () => {
    const withOg = Array.from({ length: 300 }, (_, i) =>
      resolve(richPlayer({ nonce: i, user: makeUser({ goals: 18, ownGoals: 2 }) }))!
        .text,
    );
    expect(withOg.some((t) => t.includes('שערים עצמיים'))).toBe(true);

    const without = Array.from({ length: 300 }, (_, i) =>
      resolve(richPlayer({ nonce: i }))!.text,
    );
    expect(without.some((t) => t.includes('עצמי'))).toBe(false);
  });

  it('never mentions a position or friends the account does not have', () => {
    const lines = Array.from({ length: 300 }, (_, i) =>
      resolve(richPlayer({ nonce: i }))!.text,
    );
    expect(lines.some((t) => t.includes('העמדה המועדפת'))).toBe(false);
    expect(lines.some((t) => t.includes('חברים ברשימה'))).toBe(false);
  });

  it('small-talks according to the day of the week', () => {
    // Thursday vs Tuesday: same player, different filler.
    const thursday = new Date(NOW);
    thursday.setDate(thursday.getDate() + ((4 - thursday.getDay() + 7) % 7));
    const tuesday = new Date(NOW);
    tuesday.setDate(tuesday.getDate() + ((2 - tuesday.getDay() + 7) % 7));

    const at = (d: Date) =>
      new Set(
        Array.from({ length: 300 }, (_, i) =>
          resolve(richPlayer({ nonce: i, now: d.getTime() }))!.text,
        ),
      );
    const weekend = he.assistantWeekendFlavor as readonly string[];
    const midweek = he.assistantMidweekFlavor as readonly string[];
    expect([...at(thursday)].some((t) => weekend.includes(t))).toBe(true);
    expect([...at(thursday)].some((t) => midweek.includes(t))).toBe(false);
    expect([...at(tuesday)].some((t) => midweek.includes(t))).toBe(true);
  });

  it('carries no greeting of its own — the card adds it', () => {
    for (let i = 0; i < 30; i++) {
      const t = resolve(richPlayer({ nonce: i }))!.text;
      expect(t).not.toMatch(/^(בוקר טוב|ערב טוב|צהריים טובים|לילה טוב)/);
    }
  });
});

describe('copy hygiene', () => {
  // Resolving a few personas only ever exercises the rules those personas
  // reach — an earlier version of this suite missed "ערב טוב על המגרש" sitting
  // in the post-match list, and it shipped to the screen as
  // "ערב טוב מתן, ערב טוב על המגרש". So walk the copy itself instead: every
  // assistant string, whether or not any test persona can trigger it.
  const GREETINGS = ['בוקר טוב', 'ערב טוב', 'צהריים טובים', 'לילה טוב'];

  /** Every assistant* string, with template functions filled with samples. */
  function allAssistantStrings(): Array<{ key: string; text: string }> {
    const out: Array<{ key: string; text: string }> = [];
    const samples = [2, 'דניאל', 'כדורגל אנשים טובים', 20, 5];
    for (const [key, value] of Object.entries(
      he as unknown as Record<string, unknown>,
    )) {
      if (!key.startsWith('assistant')) continue;
      if (typeof value === 'string') {
        out.push({ key, text: value });
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => {
          if (typeof v === 'string') out.push({ key: `${key}[${i}]`, text: v });
        });
      } else if (typeof value === 'function') {
        // Try plausible argument shapes until one produces a string; the copy
        // functions take (number|string) combinations only.
        for (const a of samples) {
          for (const b of samples) {
            try {
              const r = (value as (...args: unknown[]) => unknown)(a, b, 3);
              if (typeof r === 'string') {
                out.push({ key: `${key}(${String(a)},${String(b)})`, text: r });
              }
            } catch {
              /* wrong arity for this sample — try the next */
            }
          }
        }
      }
    }
    return out;
  }

  it('has no assistant line that repeats the greeting the card adds', () => {
    const offenders = allAssistantStrings()
      // The greeting helper itself is the one place a greeting belongs.
      .filter((s) => !s.key.startsWith('assistantGreeting'))
      .filter((s) => GREETINGS.some((g) => s.text.includes(g)))
      .map((s) => `${s.key}: ${s.text}`);
    expect(offenders).toEqual([]);
  });

  it('never signs off — the next match is usually booked right below', () => {
    // "See you next time" above a card that already names the date of the next
    // match contradicts the screen. Post-match lines look backwards only.
    const FAREWELLS = ['בפעם הבאה', 'נתראה', 'להתראות'];
    const offenders = allAssistantStrings()
      .filter((s) => s.key.startsWith('assistantPostGame'))
      .filter((s) => FAREWELLS.some((f) => s.text.includes(f)))
      .map((s) => `${s.key}: ${s.text}`);
    expect(offenders).toEqual([]);
  });

  it('names what it is talking about — no object-less sentences', () => {
    // Shipped once as "סיימת. תנוח, מגיע לך", and the reply was "סיימתי מה?".
    // A post-match line must name the match or carry a number.
    const offenders = allAssistantStrings()
      .filter((s) => s.key.startsWith('assistantPostGame'))
      .filter((s) => !/מחזור|הגעות|\d/.test(s.text))
      .map((s) => `${s.key}: ${s.text}`);
    expect(offenders).toEqual([]);
  });

  it('keeps the jokes free of anything that looks like a stat', () => {
    // The humour pool is the NO-DATA fallback. A number in it would read as a
    // real figure to a player who has none — the one thing this feature is
    // not allowed to do.
    const offenders = he.assistantHumor.filter((t) => /\d/.test(t));
    expect(offenders).toEqual([]);
  });

  it('found a meaningful number of strings to check', () => {
    // Guards the walker itself: if `he` is restructured and this silently
    // matches nothing, the test above would pass while checking zero lines.
    expect(allAssistantStrings().length).toBeGreaterThan(30);
  });
});

describe('resilience', () => {
  it('survives a rule that throws', () => {
    const boom = () => {
      throw new Error('bad rule');
    };
    const m = resolveAssistantMessage(ctx(), [boom, ...ASSISTANT_RULES]);
    expect(m).not.toBeNull();
  });
});
