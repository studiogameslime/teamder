import {
  relativeKickoff,
  formatTime,
  dayDiff,
  joinLocation,
} from '@/utils/format';
import { he } from '@/i18n/he';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// Fixed local "now": June 15 2026, 12:00 — noon keeps +hours on the same day.
const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime();

describe('relativeKickoff', () => {
  it('past / now → null', () => {
    expect(relativeKickoff(NOW - MIN, NOW)).toBeNull();
    expect(relativeKickoff(NOW, NOW)).toBeNull();
  });
  it('minutes under an hour', () => {
    expect(relativeKickoff(NOW + 5 * MIN, NOW)).toBe('עוד 5 דק׳');
    expect(relativeKickoff(NOW + 30 * MIN, NOW)).toBe('עוד 30 דק׳');
    expect(relativeKickoff(NOW + 59 * MIN, NOW)).toBe('עוד 59 דק׳');
    // never "0 דק׳" — clamps to at least 1
    expect(relativeKickoff(NOW + 20 * 1000, NOW)).toBe('עוד 1 דק׳');
  });
  it('Hebrew dual forms for hours (same day)', () => {
    expect(relativeKickoff(NOW + 1 * HOUR, NOW)).toBe('עוד שעה');
    expect(relativeKickoff(NOW + 2 * HOUR, NOW)).toBe('עוד שעתיים');
    expect(relativeKickoff(NOW + 3 * HOUR, NOW)).toBe('עוד 3 שעות');
    expect(relativeKickoff(NOW + 5 * HOUR, NOW)).toBe('עוד 5 שעות');
  });
  it('calendar-aware days', () => {
    const noonOn = (d: number) => new Date(2026, 5, d, 12, 0, 0).getTime();
    expect(relativeKickoff(noonOn(16), NOW)).toBe('מחר');
    expect(relativeKickoff(noonOn(17), NOW)).toBe('בעוד יומיים');
    expect(relativeKickoff(noonOn(18), NOW)).toBe('בעוד 3 ימים');
    expect(relativeKickoff(noonOn(21), NOW)).toBe('בעוד 6 ימים');
    expect(relativeKickoff(noonOn(25), NOW)).toBeNull(); // > 6 days
  });
});

describe('formatTime', () => {
  it('zero-pads HH:MM (self-consistent with local time)', () => {
    const ms = new Date(2026, 0, 1, 9, 5, 0).getTime();
    expect(formatTime(ms)).toBe('09:05');
    const ms2 = new Date(2026, 0, 1, 23, 59, 0).getTime();
    expect(formatTime(ms2)).toBe('23:59');
    const ms3 = new Date(2026, 0, 1, 0, 0, 0).getTime();
    expect(formatTime(ms3)).toBe('00:00');
  });
});

describe('dayDiff', () => {
  it('counts calendar days regardless of time of day', () => {
    expect(dayDiff(NOW + 6 * HOUR, NOW)).toBe(0); // same day, evening
    expect(dayDiff(new Date(2026, 5, 16, 1, 0, 0).getTime(), NOW)).toBe(1);
    expect(dayDiff(new Date(2026, 5, 14, 23, 0, 0).getTime(), NOW)).toBe(-1);
    expect(dayDiff(new Date(2026, 5, 22, 12, 0, 0).getTime(), NOW)).toBe(7);
  });
});

describe('joinLocation', () => {
  it('field only', () => {
    expect(joinLocation('פארק הירקון', '')).toBe('פארק הירקון');
    expect(joinLocation('פארק הירקון', undefined)).toBe('פארק הירקון');
  });
  it('city only when no field', () => {
    expect(joinLocation('', 'תל אביב')).toBe('תל אביב');
    expect(joinLocation(undefined, 'תל אביב')).toBe('תל אביב');
  });
  it('joins distinct field + city', () => {
    expect(joinLocation('פארק הירקון', 'תל אביב')).toBe('פארק הירקון, תל אביב');
  });
  it('does NOT duplicate a city already inside the field', () => {
    expect(joinLocation('עזריה 21, תל אביב', 'תל אביב')).toBe('עזריה 21, תל אביב');
  });
  it('trims whitespace', () => {
    expect(joinLocation('  מגרש  ', '  חיפה ')).toBe('מגרש, חיפה');
  });
});

describe('the season countdown counts in Hebrew', () => {
  // "נשארו 1 חודשים" reached the club card: days were rounded to months with a
  // single plural form. Hebrew has three shapes here and 1 and 2 are both
  // special.
  it('one and two have their own words', () => {
    expect(he.seasonsProgressDays(1)).toBe('נשאר יום אחד לעונה');
    expect(he.seasonsProgressDays(2)).toBe('נשארו יומיים לעונה');
  });

  it('stays in days while days still read naturally', () => {
    expect(he.seasonsProgressDays(32)).toBe('נשארו 32 ימים לעונה');
    expect(he.seasonsProgressDays(60)).toBe('נשארו 60 ימים לעונה');
  });

  it('and never says "1 חודשים"', () => {
    for (let d = 1; d <= 400; d += 1) {
      expect(he.seasonsProgressDays(d)).not.toMatch(/\b1 חודשים/);
      expect(he.seasonsProgressDays(d)).not.toMatch(/\b2 חודשים/);
    }
  });

  it('a season already past its date says so', () => {
    expect(he.seasonsProgressDays(0)).toContain('בקרוב');
    expect(he.seasonsProgressDays(-5)).toContain('בקרוב');
  });
});

describe('the season title values count in Hebrew too', () => {
  // The 1-form pass fixed the countdown and skipped its neighbours. A title is
  // routinely won on one of something in a young club, so "1 שערים" reaches
  // the screen as easily as "1 חודשים" did.
  it('one of anything has its own word', () => {
    expect(he.seasonTitleValue('topScorer', 1)).toBe('שער אחד');
    expect(he.seasonTitleValue('topAssister', 1)).toBe('בישול אחד');
    expect(he.seasonTitleValue('topWinner', 1)).toBe('ניצחון אחד');
    expect(he.seasonTitleValue('mostLoyal', 1)).toBe('מחזור אחד');
    expect(he.seasonTitleValue('cleanSheetKing', 1)).toBe('שער נקי אחד');
  });

  it('and more than one reads normally', () => {
    expect(he.seasonTitleValue('topScorer', 31)).toBe('31 שערים');
    expect(he.seasonTitleValue('mostLoyal', 24)).toBe('24 מחזורים');
  });

  // ⚠️ The penalty titles left this group on 20.09.2026 (§16). They were
  // decided on a percentage behind a minimum-attempts gate; they are decided
  // on how many were scored and how many were saved. The formatter was left
  // behind by that change for a day, so a winner on two penalties rendered as
  // "200%" — the number was right and the unit was a leftover.
  it('the averages are not counted things', () => {
    // Named, not bare. A lone "8.4" says nothing about its scale, and it is
    // printed on three separate screens.
    expect(he.seasonTitleValue('mvp', 8.37)).toBe('ציון 8.4');
  });

  it('but the penalty titles are counts now, with their own units', () => {
    expect(he.seasonTitleValue('penaltyKing', 2)).toBe('2 פנדלים');
    expect(he.seasonTitleValue('penaltyKeeper', 3)).toBe('3 עצירות');
    // Not "שערים": a scored penalty is a penalty, and the title sits beside
    // מלך השערים on the same shelf.
    expect(he.seasonTitleValue('penaltyKing', 2)).not.toMatch(/שערים/);
  });

  it('no title value can ever print "1 <plural>"', () => {
    for (const k of ['topScorer', 'topAssister', 'topWinner', 'mostLoyal',
                     'cleanSheetKing', 'deadlyDuo', 'penaltyKing', 'penaltyKeeper']) {
      expect(he.seasonTitleValue(k, 1)).not.toMatch(/^1 /);
    }
    expect(he.seasonTitleValue('penaltyKing', 1)).toBe('פנדל אחד');
    expect(he.seasonTitleValue('penaltyKeeper', 1)).toBe('עצירה אחת');
  });

  // ── "1 <plural>" outside the title values ───────────────────────────
  //
  // The rule was stated for `seasonTitleValue` and enforced there, and eleven
  // other strings went on building their own `${n} מחזורים`. The one that
  // surfaced it was on screen during a device pass: "1 מחזורים יחד" under
  // השותף הקבוע, for a pair who had played one evening together.
  it('no count string anywhere prints "1 <plural>"', () => {
    const at1: [string, string][] = [
      ['chemistryGamesTogether', he.chemistryGamesTogether(1)],
      ['chemistryAssistsBetween', he.chemistryAssistsBetween(1)],
      ['chemistryCleanSheetsTogether', he.chemistryCleanSheetsTogether(1)],
      ['roundSummaryStatRounds', he.roundSummaryStatRounds(1)],
      ['roundSummaryStatGoals', he.roundSummaryStatGoals(1)],
      ['roundSummaryStatAssists', he.roundSummaryStatAssists(1)],
      ['communityStatsAssistsUnit', he.communityStatsAssistsUnit(1)],
      ['communityStatsEveningsUnit', he.communityStatsEveningsUnit(1)],
      ['statMostPlayedWithSub', he.statMostPlayedWithSub(1)],
      ['assistantPostGameWeek', he.assistantPostGameWeek(1)],
      ['assistantWeekCount', he.assistantWeekCount(1)],
    ];
    for (const [name, text] of at1) {
      expect(`${name}: ${text}`).not.toMatch(/: 1 /);
    }
  });

  it('and the reported one reads correctly at one and at many', () => {
    expect(he.statMostPlayedWithSub(1)).toBe('מחזור אחד יחד');
    expect(he.statMostPlayedWithSub(7)).toBe('7 מחזורים יחד');
  });

  // ── The coverage note (§ partial ratings) ────────────────────────────
  //
  // שחקן העונה is an average, and an average is only as honest as the nights
  // it covers. On the one season this club has closed, the rating exists for
  // nine of twenty-two evenings, so "ציון 7.7" reads as a whole-season figure
  // and is not one.
  it('says which evenings the rating is built from', () => {
    expect(he.seasonTitleCoverage(9, 22)).toBe(
      'מבוסס על 9 מתוך 22 ערבי העונה שבהם נאספו דירוגים',
    );
  });

  it('names the numerator and the denominator the right way round', () => {
    const t = he.seasonTitleCoverage(9, 22);
    // The trap this guards is the one that makes the sentence a lie: 22 of 9.
    expect(t.indexOf('9')).toBeLessThan(t.indexOf('22'));
    expect(t).not.toContain('22 מתוך 9');
  });

  it('and never claims the rating is the season', () => {
    // The whole point: the note must not read as "the average of the season's
    // 22 evenings". It says which nights were measured, not how long the
    // season was.
    expect(he.seasonTitleCoverage(9, 22)).toContain('מתוך 22');
    expect(he.seasonTitleCoverage(9, 22)).toContain('שבהם נאספו דירוגים');
  });

  it('the peer lines too', () => {
    // Asserting the RULE, not the sentence. The wording was rewritten out of
    // the first person ("ניצחתי אותו" → "ניצחון אחד מולו") and pinning the old
    // literals would have made a copy change look like a regression — while
    // what actually matters is that a count of one never reads "1 ניצחונות".
    for (const line of [
      he.seasonPeerVictimDetail(1),
      he.seasonPeerTormentorDetail(1),
      he.seasonPeerAssistsDetail(1),
    ]) {
      expect(line).not.toMatch(/[0-9]/);
      expect(line).toMatch(/אחד|אחת/);
    }
    // …and more than one still carries the digit.
    expect(he.seasonPeerVictimDetail(4)).toMatch(/4/);
    expect(he.seasonPeerAssistsDetail(3)).toMatch(/3/);
  });
});
