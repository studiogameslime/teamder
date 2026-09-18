/**
 * The close, the wind-back and the undo — the arithmetic, under test at last.
 *
 * `closeSeason` and `reopenSeason` had no functional test of any kind. The one
 * file that named them imports a LIST OF FIELD NAMES and asserts the list, so
 * the safety boundary was covered and nothing that boundary protects was: not
 * the subtraction that empties a club's table, not the addition that gives it
 * back, not the key the two of them have to agree on, and not the denominator
 * the titles are decided against. Between them these are the only code in the
 * app that destroys data, and one of the two runs unattended on an hourly
 * cron.
 *
 * They cannot be run end to end from here — both are Firestore transactions
 * over live collections and there is no emulator in this suite. So every
 * number choice they make is now a pure exported function, and this file pins
 * those, on the shape of the real club. What is left untested is the plumbing
 * around them: which documents are read, which batch they land in, and the
 * order the steps run in. Those need the emulator suite (tests/rules), and
 * they are named here so nobody mistakes this file for full coverage.
 */
import {
  __seasonFields,
  awardsDenominatorOf,
  restoreRow,
  sealedCardEvenings,
  seasonPairKey,
  windBackRow,
} from '../../functions/src/seasonRollover';
import {
  ARCHIVED_PLAYER_ROWS,
  PLAYER_ROWS,
  AWARDS_DENOMINATOR,
  SEALED_CARD,
} from '../fixtures/realClub';

const PLAYER = [...__seasonFields.player];
const PAIR = [...__seasonFields.pair];
const CLUB = [...__seasonFields.club];

describe('winding a season back out of a row', () => {
  it('subtracts what was archived and leaves the rest standing', () => {
    // A member with two seasons behind them: the archive holds this season's
    // 10 goals, the row holds a career's 31. Nine of the difference belong to
    // seasons already closed and must survive.
    const live = { goals: 31, games: 60, assists: 12 };
    const archived = { goals: 10, games: 22, assists: 5 };
    expect(windBackRow(live, archived, ['goals', 'games', 'assists'])).toEqual({
      goals: 21,
      games: 38,
      assists: 7,
    });
  });

  it('keeps an evening played between the read and the wipe', () => {
    // THE reason it subtracts instead of writing zeroes. The rows are read at
    // the top of the close and wiped at the end of it; a mini-game committed
    // in between is not in the archive, and a zero would erase it from the
    // live table too. It would then exist nowhere.
    const archived = { goals: 10, rounds: 37 };
    const liveAfterOneMore = { goals: 12, rounds: 43 };
    expect(windBackRow(liveAfterOneMore, archived, ['goals', 'rounds'])).toEqual({
      goals: 2,
      rounds: 6,
    });
  });

  it('clamps at zero rather than writing a negative goal tally', () => {
    expect(windBackRow({ goals: 3 }, { goals: 10 }, ['goals'])).toEqual({
      goals: 0,
    });
  });

  it('zeroes a row that belongs to no season at all', () => {
    // A pair past the archive cap. It is not in the archive, so there is
    // nothing to subtract — and leaving it standing would carry a previous
    // season's chemistry into the next one.
    expect(windBackRow({ sameTeam: 9, winsA: 4 }, null, ['sameTeam', 'winsA'])).toEqual(
      { sameTeam: 0, winsA: 0 },
    );
  });

  it('treats a missing counter as zero on either side', () => {
    // Every counter on these documents arrived at a different time. An absent
    // field is not a reason to write NaN into a club's table.
    expect(windBackRow(undefined, { goals: 4 }, ['goals'])).toEqual({ goals: 0 });
    expect(windBackRow({ goals: 4 }, {}, ['goals'])).toEqual({ goals: 4 });
    expect(windBackRow({ goals: '4' }, { goals: null }, ['goals'])).toEqual({
      goals: 0,
    });
  });

  it('touches only the fields it is given', () => {
    // The named-list rule from the other direction: `bestEvening` is a
    // personal high-water mark that happens to live on a club document, and
    // the wind-back returns a patch rather than a whole row precisely so it
    // cannot reach it.
    const out = windBackRow(
      { goals: 10, bestEvening: 9.4 },
      { goals: 10, bestEvening: 9.4 },
      ['goals'],
    );
    expect(Object.keys(out)).toEqual(['goals']);
  });
});

describe('giving a season back', () => {
  it('adds the archive on, so a round played since the close survives', () => {
    const afterClose = { goals: 2, games: 1 };
    const archived = { goals: 10, games: 22 };
    expect(restoreRow(afterClose, archived, ['goals', 'games'])).toEqual({
      goals: 12,
      games: 23,
    });
  });

  it('and a wind-back followed by an undo is the row it started with', () => {
    // The property the whole undo rests on. Anything that is not a
    // subtract-then-add pair here is a number the club never gets back — and
    // the archive is deleted at the end of the undo, so there is no second
    // chance to notice.
    const before: Record<string, number> = {};
    PLAYER.forEach((f, i) => {
      before[f] = (i + 1) * 3;
    });
    const archived: Record<string, number> = {};
    PLAYER.forEach((f, i) => {
      archived[f] = i + 1;
    });
    const wound = windBackRow(before, archived, PLAYER);
    expect(restoreRow(wound, archived, PLAYER)).toEqual(before);
  });

  it('over every list the two of them share', () => {
    for (const fields of [PLAYER, PAIR, CLUB]) {
      const before = Object.fromEntries(fields.map((f, i) => [f, 10 + i]));
      const archived = Object.fromEntries(fields.map((f, i) => [f, 1 + i]));
      expect(restoreRow(windBackRow(before, archived, fields), archived, fields)).toEqual(
        before,
      );
    }
  });

  it('but NOT after a clamp, which is why the stamp exists', () => {
    // Subtraction is not reversible once it has hit the floor, and it is not
    // idempotent either: winding the same season back twice clamps a row to
    // zero and the undo then hands back only the archive. That is what
    // `seasonWoundBack` and `seasonReopened` are for, per row, and it is why
    // neither of them may ever appear in the reset lists.
    const twice = windBackRow(windBackRow({ goals: 12 }, { goals: 10 }, ['goals']), { goals: 10 }, ['goals']);
    expect(twice).toEqual({ goals: 0 });
    expect(restoreRow(twice, { goals: 10 }, ['goals'])).toEqual({ goals: 10 });
    expect(PLAYER).not.toContain('seasonWoundBack');
    expect(PAIR).not.toContain('seasonWoundBack');
  });
});

describe('the pair key the wipe and the restore have to agree on', () => {
  it('is the same key whichever way round the live document holds it', () => {
    // If these ever disagreed, an undo would restore a season's chemistry onto
    // a pair that never played it and leave the real pair at zero.
    expect(seasonPairKey('zed', 'amy').key).toBe(seasonPairKey('amy', 'zed').key);
    expect(seasonPairKey('zed', 'amy').key).toBe('amy__zed');
  });

  it('and says when the live row’s a/b are the wrong way round', () => {
    // `winsA` and `assistsAToB` are directional. Archiving them without
    // flipping would credit every assist to the wrong player of the pair.
    expect(seasonPairKey('amy', 'zed')).toMatchObject({ lo: 'amy', hi: 'zed', flip: false });
    expect(seasonPairKey('zed', 'amy')).toMatchObject({ lo: 'amy', hi: 'zed', flip: true });
  });

  it('survives a guest id, which sorts like any other string', () => {
    const { key, flip } = seasonPairKey('guest:abc', 'matan');
    expect(key).toBe('guest:abc__matan');
    expect(flip).toBe(false);
  });
});

describe('the two numbers the card carries', () => {
  it('the awards denominator is the best attendance, not the season', () => {
    const attendances = Object.values(ARCHIVED_PLAYER_ROWS).map((r) => r.games);
    expect(awardsDenominatorOf(attendances, 22)).toBe(19);
    expect(awardsDenominatorOf(attendances, 22)).toBe(AWARDS_DENOMINATOR);
  });

  it('falls back to what the caller knew when nobody played', () => {
    // A season with no rows at all. Without the fallback the gate opens for
    // everybody, on a season that has no everybody.
    expect(awardsDenominatorOf([], 22)).toBe(22);
    expect(awardsDenominatorOf([], 0)).toBe(0);
  });

  it('is never negative and never NaN, whatever the rows hold', () => {
    expect(awardsDenominatorOf([-4, -9], 10)).toBe(0);
    expect(awardsDenominatorOf([NaN, 3], 10)).toBe(3);
  });

  it('while the card’s own "N מחזורים" is the season’s length', () => {
    // 22 on the card, 19 as the denominator, on the same season. Storing the
    // denominator as the length is what printed 19 for a club that had watched
    // 22 all year — and the reopen restores the season from that number.
    expect(sealedCardEvenings(undefined, 22, 19)).toBe(22);
    expect(sealedCardEvenings(undefined, 22, 19)).toBe(SEALED_CARD.completedRounds);
  });

  it('and a resume takes it from the archive, not from the half-wiped rows', () => {
    // The first pass may have died mid-wipe. The archive is the protected
    // record, so a resumed close writes the card the first pass would have.
    expect(sealedCardEvenings(22, 3, 19)).toBe(22);
    // Including a genuine zero, which must not fall through to a recount.
    expect(sealedCardEvenings(0, 22, 19)).toBe(0);
  });

  it('falls back to the denominator only when there is no length at all', () => {
    // A season closed by a path that passed nothing. Better than zero, and
    // still the number to be suspicious of.
    expect(sealedCardEvenings(undefined, 0, 19)).toBe(19);
    expect(sealedCardEvenings(undefined, undefined, 19)).toBe(19);
  });
});

describe('the season being closed is the real club’s', () => {
  it('and its rows wind back to empty, because it is their only season', () => {
    // Season 1 of a club that switched seasons on with two years of history:
    // the archive holds everything the row holds, so every counter lands on 0
    // and the next season genuinely starts empty. The 19-vs-22 gap lives in
    // the archive's `games`, not in the wind-back — the row is subtracted from
    // itself, whatever it says.
    for (const [uid, row] of Object.entries(PLAYER_ROWS)) {
      const archived = { ...row, games: ARCHIVED_PLAYER_ROWS[uid].games };
      const wound = windBackRow(row, archived, ['goals', 'assists', 'wins']);
      expect(wound).toEqual({ goals: 0, assists: 0, wins: 0 });
      // `games` is the one that does not, and it is left behind rather than
      // clamped: three evenings nothing ever credited.
      expect(windBackRow(row, archived, ['games']).games).toBe(
        row.games - archived.games,
      );
    }
  });
});
