/**
 * "How many מחזורים did this season hold?" — asked of everything that answers
 * it, over one club, in one test.
 *
 * This is the assertion the audit found missing. The app answers that question
 * in four places — the club screen's games scan, the server's stamped-games
 * count, the club's whole-history count, and the season's progress mirror —
 * and NOTHING anywhere compared them. Every one of them was individually
 * "covered": by a copy of the rule re-declared inside a test file, or by a
 * regular expression run over functions/src/index.ts as a string. So all four
 * could disagree, and all four did:
 *
 *   • The stats screen said 22 מחזורים and the season card said 0.
 *   • `playedEveningsOfSeason` counted only STAMPED games and said 3. Pressing
 *     undo on season 1 wrote that 3 over the 22 the club had been watching.
 *   • `completedRoundsOf` called with two arguments fell through to
 *     `eveningsSealed - roundsAtStart` = 10 - 7 = 3. "סיים עונה עכשיו" would
 *     have archived a 22-evening season as three, irreversibly — a season
 *     summary is written with create().
 *
 * Each of those was fixed on its own, one at a time, and each fix was a guess
 * at what the other three did. The fixture is the real club (see
 * tests/fixtures/realClub.ts) and the rule is simple: every number the app is
 * willing to show a person for this season must be the same number.
 */
import { didEveningHappen, eveningPlayState } from '@/utils/eveningPlayed';
import { inSeason } from '@/utils/seasonScope';
import { countSeasonParticipants } from '@/utils/seasonParticipants';
import {
  completedRoundsFrom,
  countPlayedEvenings,
  countSeasonEvenings,
  eveningInSeason,
} from '../../functions/src/seasonCounters';
import {
  ARCHIVED_PLAYER_ROWS,
  CLUB_SEASON_1,
  EVENINGS,
  EVENINGS_THAT_HAPPENED,
  PLAYER_ROWS,
  AWARDS_DENOMINATOR,
  SEALED_CARD,
  SEASON_1,
  SEASON_2,
  TIMER_ONLY_CARD,
} from '../fixtures/realClub';

/** The club screen's scan, as `gameService.getCommunityStats` performs it:
 *  the exported season rule, then the exported evening rule. Nothing here is
 *  re-implemented — that is the entire point of the file. */
const clientScan = (season?: { currentId: string; currentNo: number }): number =>
  EVENINGS.filter((g) => inSeason(g, season) && didEveningHappen(g)).length;

describe('the four answers to "how many מחזורים"', () => {
  it('agree, on the club the feature actually runs on', () => {
    const answers = {
      // What the stats screen renders under the season heading.
      clubScreenScan: clientScan(SEASON_1),
      // What the server counts from the stamps when it reopens a season.
      serverStampedCount: countSeasonEvenings(
        EVENINGS,
        CLUB_SEASON_1.seasonId,
        CLUB_SEASON_1.seasonNo,
      ),
      // What season 1 was seeded with when the club switched seasons on.
      serverHistoryCount: countPlayedEvenings(EVENINGS),
      // What the card shows and what the sweep closes on.
      seasonProgressMirror: completedRoundsFrom(
        CLUB_SEASON_1.eveningsSealed,
        CLUB_SEASON_1.roundsAtStart,
        CLUB_SEASON_1.playedRounds,
      ),
      // And what the hall of fame prints for the sealed season.
      sealedCard: SEALED_CARD.completedRounds,
    };
    expect(answers).toEqual({
      clubScreenScan: EVENINGS_THAT_HAPPENED,
      serverStampedCount: EVENINGS_THAT_HAPPENED,
      serverHistoryCount: EVENINGS_THAT_HAPPENED,
      seasonProgressMirror: EVENINGS_THAT_HAPPENED,
      sealedCard: EVENINGS_THAT_HAPPENED,
    });
  });

  it('and agree that the next season is empty, which is the other half', () => {
    // Season 2 opened on the close and has not held an evening. The bug that
    // started all of this was the reverse of the one above: a scan with no
    // season filter answered 22 for a season that had held nothing.
    expect(clientScan(SEASON_2)).toBe(0);
    expect(countSeasonEvenings(EVENINGS, 's2', 2)).toBe(0);
  });

  it('count the whole club for a club that runs no seasons at all', () => {
    // 190-odd clubs are in this state. `undefined` is not "season zero", it is
    // "no season scope", and everything terminal counts.
    expect(clientScan(undefined)).toBe(EVENINGS_THAT_HAPPENED);
  });
});

describe('the client rule and the server rule are the same rule', () => {
  // They were not. The client counted an unstamped evening into season 1 and
  // the server did not, which is the whole of the 22-vs-3 disagreement: 19 of
  // these 24 documents carry no stamp.
  it.each(EVENINGS.map((g) => [g.id, g] as const))(
    '%s lands in the same season on both sides',
    (_id, game) => {
      expect(eveningInSeason(game, SEASON_1.currentId, SEASON_1.currentNo)).toBe(
        inSeason(game, SEASON_1),
      );
      expect(eveningInSeason(game, SEASON_2.currentId, SEASON_2.currentNo)).toBe(
        inSeason(game, SEASON_2),
      );
    },
  );

  it('and neither of them invents a season for an unstamped game', () => {
    // An unstamped evening belongs to season 1 and to nothing else. If the
    // club is on season 3, those nineteen evenings are in the archive of
    // season 1, not in the season on screen.
    const unstamped = EVENINGS.filter((g) => !g.seasonId);
    expect(unstamped).toHaveLength(19);
    for (const g of unstamped) {
      expect(inSeason(g, { currentId: 's3', currentNo: 3 })).toBe(false);
      expect(eveningInSeason(g, 's3', 3)).toBe(false);
    }
  });
});

describe('the evenings that must not be counted', () => {
  it('the one the sweep closed with nothing on it counts for nobody', () => {
    const g = EVENINGS.find((e) => e.id === 'g-unverified')!;
    expect(eveningPlayState(g)).toBe('unverified');
    // In the season by its stamp, out of every count by its state. A naive
    // `status === 'finished'` count makes this season 23.
    expect(inSeason(g, SEASON_1)).toBe(true);
    expect(countSeasonEvenings([g], 's1', 1)).toBe(0);
    expect(countPlayedEvenings([g])).toBe(0);
  });

  it('and the cancelled one is not an evening the club held', () => {
    const g = EVENINGS.find((e) => e.id === 'g-cancelled')!;
    expect(countSeasonEvenings([g], 's1', 1)).toBe(0);
    expect(countPlayedEvenings([g])).toBe(0);
  });

  it('the terminal documents outnumber the evenings by exactly those two', () => {
    expect(EVENINGS).toHaveLength(EVENINGS_THAT_HAPPENED + 2);
  });
});

describe('the counter subtraction, which is what disagreeing looks like', () => {
  it('answers 3 for a season of 22 — the number two shipped paths archived', () => {
    // `eveningsSealed` began on 26.08.2026 and has seen ten of this club's
    // twenty-two nights; `roundsAtStart` is 7. This is not a rounding error or
    // a stale read, it is a different question being answered: how much has
    // this season moved SINCE the counter was born.
    const subtraction = completedRoundsFrom(
      CLUB_SEASON_1.eveningsSealed,
      CLUB_SEASON_1.roundsAtStart,
    );
    expect(subtraction).toBe(CLUB_SEASON_1.counterSubtraction);
    expect(subtraction).not.toBe(EVENINGS_THAT_HAPPENED);
  });

  it('so the mirror wins whenever there is one, including at zero', () => {
    // 0 is a real progress value — a season that has just opened — and it has
    // to beat the fallback rather than look absent. `playedRounds ?? 0` in a
    // caller would give the same answer here for the opposite reason, which is
    // why the check is `>= 0` and not truthiness.
    expect(completedRoundsFrom(200, 7, 0)).toBe(0);
    expect(completedRoundsFrom(200, 7, 22)).toBe(22);
  });

  it('and a season opened with no offset is not due the instant it opens', () => {
    // The offset is what stops a club with 200 sealed evenings opening season
    // 2 already past a 24-evening target. Without `roundsAtStart` the fallback
    // answers the club's whole history.
    expect(completedRoundsFrom(200, undefined, undefined)).toBe(200);
    expect(completedRoundsFrom(200, 200, undefined)).toBe(0);
  });

  it('never goes negative, whatever the two counters hold', () => {
    // A counter behind its own offset is a repaired or migrated club, not a
    // season that played a negative number of evenings.
    expect(completedRoundsFrom(3, 7)).toBe(0);
    expect(completedRoundsFrom(-4, 0)).toBe(0);
  });
});

describe('the numbers that are deliberately NOT the same number', () => {
  it('the awards denominator is attendance, the season length is the season', () => {
    // Both are on the card and they differ by three on the real club: the
    // archive's `games` are short by the three evenings that ran with no timer
    // and no rotation. Substituting one for the other is not cosmetic. It used
    // to move מלך הפנדלים, because minPenaltyAttempts(19) is 2 and (22) is 3;
    // since 20.09.2026 the penalty titles are counts and that gate is gone, so
    // the consequence now lands on שחקן העונה instead — eligibilityThreshold
    // is ceil(n/2), which is 10 against 19 and 11 against 22, and that is a
    // different set of eligible players.
    const bestAttendance = Math.max(
      ...Object.values(ARCHIVED_PLAYER_ROWS).map((r) => r.games),
    );
    expect(bestAttendance).toBe(AWARDS_DENOMINATOR);
    expect(SEALED_CARD.completedRounds).toBe(EVENINGS_THAT_HAPPENED);
    expect(bestAttendance).not.toBe(SEALED_CARD.completedRounds);
  });

  it('and מחזורים are not משחקונים, on either club shape', () => {
    // `totals.rounds` is mini-games and `completedRounds` is evenings. On the
    // real advanced-mode club they are 37 and 22 — two numbers for one season,
    // and swapping them is how the summary screen came to say "37 משחקים" for
    // a season the hall of fame calls 22 מחזורים.
    expect(SEALED_CARD.totals.rounds).toBe(37);
    expect(SEALED_CARD.completedRounds).toBe(22);
    expect(SEALED_CARD.totals.rounds).not.toBe(SEALED_CARD.completedRounds);

    // And on the common club shape the mini-game count is 0 for a season of 20
    // nights — so anything that reads it as the season's length reports that
    // nothing was played at all.
    expect(TIMER_ONLY_CARD.totals.rounds).toBe(0);
    expect(TIMER_ONLY_CARD.completedRounds).toBe(20);
  });

  it('a timer-only roster is still a roster', () => {
    // Every row has `games` and no `rounds` at all. Counting participants on
    // mini-games reports 0 שחקנים for a season seven people played all year.
    expect(Object.values(PLAYER_ROWS).every((r) => !('rounds' in r))).toBe(true);
    expect(countSeasonParticipants(PLAYER_ROWS)).toBe(7);
    expect(countSeasonParticipants(PLAYER_ROWS)).toBe(SEALED_CARD.players);
  });
});
