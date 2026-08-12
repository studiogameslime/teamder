// Weekly series — WHEN the next occurrence is created, and for WHEN.
//
// The two are different questions and both go wrong quietly:
//   • create too early and next week's match sits in the feed while this
//     week's is still being played;
//   • compute the kickoff naively and a dormant series sprays past-dated
//     matches into a club at five-minute intervals.
// Both are pinned here.

import {
  OCCURRENCE_CREATE_DELAY_MS,
  buildOccurrence,
  addOneWeekUtc,
  isOccurrenceDue,
  nextOccurrenceAt,
  occurrenceSchedule,
  settingsFromGame,
} from '@/utils/seriesSchedule';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Thursday 2026-08-06, 20:00 UTC — a typical fixture slot. */
const KICKOFF = new Date('2026-08-06T20:00:00Z').getTime();

describe('when the next occurrence is created', () => {
  it('waits until the previous match is well past', () => {
    expect(isOccurrenceDue(KICKOFF, KICKOFF - HOUR)).toBe(false); // before
    expect(isOccurrenceDue(KICKOFF, KICKOFF)).toBe(false); // at kickoff
    expect(isOccurrenceDue(KICKOFF, KICKOFF + HOUR)).toBe(false); // mid-match
    expect(isOccurrenceDue(KICKOFF, KICKOFF + OCCURRENCE_CREATE_DELAY_MS)).toBe(
      true,
    );
  });

  it('does not fire on a series with no anchor', () => {
    expect(isOccurrenceDue(0, Date.now())).toBe(false);
    expect(isOccurrenceDue(Number.NaN, Date.now())).toBe(false);
  });
});

describe('what kickoff the next occurrence gets', () => {
  it('is exactly one week after the previous one', () => {
    const now = KICKOFF + 4 * HOUR;
    expect(nextOccurrenceAt(KICKOFF, now)).toBe(KICKOFF + WEEK);
  });

  it('keeps the same weekday and time of day', () => {
    const next = nextOccurrenceAt(KICKOFF, KICKOFF + 4 * HOUR)!;
    const a = new Date(KICKOFF);
    const b = new Date(next);
    expect(b.getUTCDay()).toBe(a.getUTCDay());
    expect(b.getUTCHours()).toBe(a.getUTCHours());
    expect(b.getUTCMinutes()).toBe(a.getUTCMinutes());
  });

  it('NEVER schedules a match in the past', () => {
    // The failure this guards: a series whose anchor is months old. Advancing
    // it by a single week would create a long-dead match, and because the
    // anchor only moves one week per run the cron would keep doing it every
    // five minutes until it caught up — dozens of dead matches in the club.
    const dormantAnchor = KICKOFF;
    const now = KICKOFF + 30 * WEEK + 4 * HOUR;
    const next = nextOccurrenceAt(dormantAnchor, now)!;
    expect(next).toBeGreaterThan(now);
    // Still the same weekly slot, just the upcoming one.
    expect((next - dormantAnchor) % WEEK).toBe(0);
    // And it's the FIRST future slot, not some arbitrary later one.
    expect(next - WEEK).toBeLessThanOrEqual(now);
  });

  it('produces one match per week when the cron runs every week', () => {
    // Walk a year of weekly runs and assert we never emit a past kickoff and
    // never skip or double a week.
    let anchor = KICKOFF;
    const kickoffs: number[] = [];
    for (let week = 1; week <= 52; week++) {
      const now = anchor + 4 * HOUR; // cron fires 4h after the last kickoff
      expect(isOccurrenceDue(anchor, now)).toBe(true);
      const next = nextOccurrenceAt(anchor, now)!;
      expect(next).toBeGreaterThan(now);
      kickoffs.push(next);
      anchor = next;
    }
    expect(kickoffs).toHaveLength(52);
    expect(new Set(kickoffs).size).toBe(52); // no duplicates
    for (let i = 1; i < kickoffs.length; i++) {
      expect(kickoffs[i] - kickoffs[i - 1]).toBe(WEEK);
    }
  });

  it('a repeated cron run in the same window cannot double-book', () => {
    // Two runs five minutes apart, before the anchor has been advanced (e.g. a
    // retry): both propose the SAME kickoff, so the existence check upstream
    // collapses them into one match.
    const now1 = KICKOFF + 4 * HOUR;
    const now2 = now1 + 5 * 60 * 1000;
    expect(nextOccurrenceAt(KICKOFF, now1)).toBe(
      nextOccurrenceAt(KICKOFF, now2),
    );
  });

  it('uses the injected week-adder, so the CF can stay DST-safe', () => {
    // The Cloud Function passes an Israel-wall-time adder. Prove the seam is
    // actually used rather than the plain +7d being hard-coded.
    const oddAdder = (t: number) => t + WEEK - HOUR; // pretend DST shift
    const next = nextOccurrenceAt(KICKOFF, KICKOFF + 4 * HOUR, oddAdder);
    expect(next).toBe(KICKOFF + WEEK - HOUR);
  });

  it('refuses a broken anchor instead of guessing', () => {
    expect(nextOccurrenceAt(0, Date.now())).toBeNull();
    expect(nextOccurrenceAt(-1, Date.now())).toBeNull();
  });
});

describe('the schedule around each occurrence', () => {
  it('re-derives every window from the NEW kickoff', () => {
    const settings = {
      registrationOpensBeforeMs: DAY,
      publicOpenBeforeMs: 2 * DAY,
      guestsOpenBeforeMs: 6 * HOUR,
    };
    const next = KICKOFF + WEEK;
    const s = occurrenceSchedule(settings, next);
    expect(s.registrationOpensAt).toBe(next - DAY);
    expect(s.publicOpenAt).toBe(next - 2 * DAY);
    expect(s.guestsOpenAt).toBe(next - 6 * HOUR);
  });

  it('leaves windows unset when the template has none', () => {
    expect(occurrenceSchedule({}, KICKOFF)).toEqual({});
  });

  it('holds the same lead every week instead of drifting', () => {
    // The bug this prevents: storing absolute timestamps would pin every
    // future week to the FIRST week's clock, so "24h before" silently becomes
    // "8 days before" by week two.
    const settings = { registrationOpensBeforeMs: DAY };
    for (let w = 1; w <= 10; w++) {
      const k = KICKOFF + w * WEEK;
      expect(k - occurrenceSchedule(settings, k).registrationOpensAt!).toBe(DAY);
    }
  });
});

describe('the template built from a match', () => {
  const base = {
    title: 'חמישי כדורגל',
    fieldName: 'המגרש הקבוע',
    maxPlayers: 15,
    visibility: 'community' as const,
    requiresApproval: true,
    bringBall: true,
    bringShirts: false,
    startsAt: KICKOFF,
  };

  it('stores schedule fields as offsets, never absolute times', () => {
    const s = settingsFromGame({
      ...base,
      registrationOpensAt: KICKOFF - DAY,
      publicOpenAt: KICKOFF - 2 * DAY,
    });
    expect(s.registrationOpensBeforeMs).toBe(DAY);
    expect(s.publicOpenBeforeMs).toBe(2 * DAY);
    // Nothing in the template may be an absolute timestamp.
    expect(JSON.stringify(s)).not.toContain(String(KICKOFF));
  });

  it('drops a schedule value that is not before kickoff', () => {
    const s = settingsFromGame({ ...base, publicOpenAt: KICKOFF + DAY });
    expect(s.publicOpenBeforeMs).toBeUndefined();
  });

  it('carries the settings a fixture should repeat', () => {
    const s = settingsFromGame({
      ...base,
      format: '5v5',
      numberOfTeams: 3,
      city: 'אור יהודה',
      fieldType: 'grass',
      ruleTags: ['בלי סליידים'],
      acceptsFillers: true,
    });
    expect(s).toMatchObject({
      title: 'חמישי כדורגל',
      fieldName: 'המגרש הקבוע',
      maxPlayers: 15,
      format: '5v5',
      numberOfTeams: 3,
      city: 'אור יהודה',
      fieldType: 'grass',
      ruleTags: ['בלי סליידים'],
      acceptsFillers: true,
      requiresApproval: true,
      bringBall: true,
      bringShirts: false,
    });
  });

  it('carries NO instance state — an occurrence is disposable', () => {
    const s = settingsFromGame({
      ...base,
      // Fields a real game carries that must never become part of the template.
      ...({
        players: ['a', 'b'],
        waitlist: ['c'],
        status: 'open',
        draftTeams: { teams: [] },
        recurringNextCreatedAt: 123,
      } as unknown as Record<string, never>),
    });
    for (const k of [
      'players',
      'waitlist',
      'status',
      'draftTeams',
      'recurringNextCreatedAt',
      'startsAt',
      'id',
    ]) {
      expect(s).not.toHaveProperty(k);
    }
  });

  it('round-trips through a week without changing the fixture', () => {
    // Create → next occurrence → rebuild the template from that occurrence.
    // The template must be identical, or the fixture would mutate weekly.
    const first = settingsFromGame({
      ...base,
      registrationOpensAt: KICKOFF - DAY,
    });
    const nextKickoff = nextOccurrenceAt(KICKOFF, KICKOFF + 4 * HOUR)!;
    const sched = occurrenceSchedule(first, nextKickoff);
    const second = settingsFromGame({
      ...base,
      startsAt: nextKickoff,
      registrationOpensAt: sched.registrationOpensAt,
    });
    expect(second).toEqual(first);
  });
});

describe('the match document an occurrence produces', () => {
  const ids = { groupId: 'g1', seriesId: 's1', createdBy: 'u1' };
  const template = {
    title: 'חמישי כדורגל',
    fieldName: 'המגרש הקבוע',
    maxPlayers: 15,
    visibility: 'community' as const,
    requiresApproval: true,
    bringBall: true,
    bringShirts: false,
  };

  it('starts empty — no roster, no live state, no latches', () => {
    const g = buildOccurrence(template, KICKOFF + WEEK, KICKOFF, ids);
    expect(g.players).toEqual([]);
    expect(g.waitlist).toEqual([]);
    expect(g.pending).toEqual([]);
    expect(g.participantIds).toEqual([]);
    expect(g.guests).toEqual([]);
    expect(g.arrivals).toEqual({});
    expect(g.cancellations).toEqual({});
    expect(g.joinedAt).toEqual({});
    expect(g.locked).toBe(false);
    expect(g.currentMatchIndex).toBe(0);
    // The whole point of building from a template: none of last week's state
    // can ride in, because it was never copied.
    for (const k of [
      'draftTeams',
      'draftTeamFeedback',
      'liveMatch',
      'rotation',
      'recurringNextCreatedAt',
      'openedNotificationSent',
      'reminderSent',
      'shortageWarningSentAt',
      'capacityNoticeSent',
      'invitedUserIds',
      'pendingPromotion',
      'rejectedPlayerIds',
      'weather',
      'autoTeamsGeneratedAt',
    ]) {
      expect(g).not.toHaveProperty(k);
    }
  });

  it('links back to its series and club', () => {
    const g = buildOccurrence(template, KICKOFF + WEEK, KICKOFF, ids);
    expect(g.seriesId).toBe('s1');
    expect(g.groupId).toBe('g1');
    expect(g.createdBy).toBe('u1');
    expect(g.startsAt).toBe(KICKOFF + WEEK);
  });

  it('opens immediately when the fixture has no deferred registration', () => {
    const g = buildOccurrence(template, KICKOFF + WEEK, KICKOFF, ids);
    expect(g.status).toBe('open');
    expect(g).not.toHaveProperty('registrationOpensAt');
  });

  it('waits as "scheduled" when registration opens later', () => {
    const g = buildOccurrence(
      { ...template, registrationOpensBeforeMs: DAY },
      KICKOFF + WEEK,
      KICKOFF, // now — a week before the new kickoff, so reg is still ahead
      ids,
    );
    expect(g.status).toBe('scheduled');
    expect(g.registrationOpensAt).toBe(KICKOFF + WEEK - DAY);
  });

  it('opens straight away when that window has already passed', () => {
    // Cron ran late: the registration moment is behind us, so the match must
    // NOT sit hidden in 'scheduled' waiting for a flip that already came due.
    const g = buildOccurrence(
      { ...template, registrationOpensBeforeMs: DAY },
      KICKOFF + WEEK,
      KICKOFF + WEEK - HOUR,
      ids,
    );
    expect(g.status).toBe('open');
  });

  it('carries the fixture settings across', () => {
    const g = buildOccurrence(
      {
        ...template,
        format: '5v5',
        numberOfTeams: 3,
        city: 'אור יהודה',
        fieldType: 'grass',
        matchDurationMinutes: 8,
        cancelDeadlineHours: 12,
        ruleTags: ['בלי סליידים'],
        acceptsFillers: true,
        fillerMinTrust: 70,
      },
      KICKOFF + WEEK,
      KICKOFF,
      ids,
    );
    expect(g).toMatchObject({
      title: 'חמישי כדורגל',
      fieldName: 'המגרש הקבוע',
      maxPlayers: 15,
      format: '5v5',
      numberOfTeams: 3,
      city: 'אור יהודה',
      fieldType: 'grass',
      matchDurationMinutes: 8,
      cancelDeadlineHours: 12,
      ruleTags: ['בלי סליידים'],
      acceptsFillers: true,
      fillerMinTrust: 70,
      visibility: 'community',
      requiresApproval: true,
    });
  });

  it('omits absent settings instead of writing undefined into Firestore', () => {
    const g = buildOccurrence(template, KICKOFF + WEEK, KICKOFF, ids);
    for (const [k, v] of Object.entries(g)) {
      expect(v).not.toBeUndefined();
      expect(k).toBeTruthy();
    }
    expect(g).not.toHaveProperty('city');
    expect(g).not.toHaveProperty('format');
  });

  it('produces identical matches week after week', () => {
    // A fixture must not drift. Same template, three consecutive weeks: only
    // the time fields may differ.
    const weeks = [1, 2, 3].map((w) =>
      buildOccurrence(
        { ...template, registrationOpensBeforeMs: DAY },
        KICKOFF + w * WEEK,
        KICKOFF,
        ids,
      ),
    );
    const strip = (g: Record<string, unknown>) => {
      const c = { ...g };
      delete c.startsAt;
      delete c.registrationOpensAt;
      delete c.createdAt;
      delete c.updatedAt;
      delete c.status;
      return c;
    };
    expect(strip(weeks[1])).toEqual(strip(weeks[0]));
    expect(strip(weeks[2])).toEqual(strip(weeks[0]));
    // …and each week's registration keeps the same lead.
    weeks.forEach((g, i) => {
      expect((g.startsAt as number) - (g.registrationOpensAt as number)).toBe(DAY);
      expect(g.startsAt).toBe(KICKOFF + (i + 1) * WEEK);
    });
  });
});
