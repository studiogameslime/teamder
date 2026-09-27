// Club records — "שיאי המועדון".
//
// The whole point of this module is that the RECORDS ARE DATA. A new record is
// one entry in `buildClubRecords`; the UI (`ClubRecords`) maps over whatever it
// gets back and never learns what a record means. That is the extensibility the
// owner asked for: adding "הכי הרבה גולים בערב" later must not touch the view.
//
// Two rules the copy has to obey, both of them learned the hard way:
//
//  1. `longestStreak` is an ATTENDANCE streak — consecutive game nights a
//     player showed up to. It is NOT a winning streak. Every earlier draft of
//     this card said "ברצף" next to a trophy and read as wins.
//  2. A record with no holder is not a record. A club with no closed evenings
//     has `longestStreak: 0` and `longestStreakUid: null`, and printing
//     "0 מחזורים ברצף" with an empty name is worse than printing nothing.
//     `buildClubRecords` drops those, so an empty club renders an empty area
//     rather than a wall of zeros.

import { he } from '@/i18n/he';

/** One record, already formatted. The view renders this and nothing else. */
export interface ClubRecord {
  key: string;
  /** Ionicons name. */
  icon: string;
  tint: string;
  label: string;
  /** The number, formatted — the view never formats. */
  value: string;
  /** Present only on records that belong to a person. */
  holderUid?: string;
  holderName?: string;
  /**
   * Present only on records that belong to one EVENING. The card names that
   * evening and tapping it opens the evening — a record without a single
   * evening behind it (the attendance streak spans many) must not be made to
   * look navigable.
   */
  gameId?: string;
  /** The evening's date, shown under the value as the record's address. */
  at?: number;
  /** Secondary line, when the number needs a unit spelled out. */
  hint?: string;
}

/** One evening record, already resolved by the caller. */
export interface EveningRecordInput {
  value: number;
  gameId: string;
  at: number;
}

export interface ClubRecordsInput {
  /**
   * Longest run of consecutive game nights attended, and by whom.
   *
   * A record is permanent, so the caller passes the LIFETIME figure — and
   * passes 0 under a season scope, where printing a club's 22-night record
   * beside a table that reads 0 מחזורים was a reported bug.
   */
  longestStreak: number;
  longestStreakUid: string | null;
  /** Finished game nights in scope — gates the records. */
  totalFinished: number;
  /**
   * The three evening records, or null where the measured period holds none.
   * Computed by `eveningRecordsOf` from `roundSummaries`; see that module for
   * what each one counts and why the coverage is partial.
   */
  mostGoalsEvening: EveningRecordInput | null;
  mostShootoutsEvening: EveningRecordInput | null;
  longestEvening: EveningRecordInput | null;
  /** uid → display name. Missing names drop the record rather than show a uid. */
  nameOf: (uid: string) => string | null;
}

// Mirrors `clubAccent` in src/theme/clubAccents.ts, written out rather than
// imported: this module is deliberately import-free apart from the strings, so
// it stays a fast pure unit under jest without dragging the theme (and through
// it react-native) into the test runtime. If the accents move, move these too.
//
// A colour per record, as a CATEGORY marker. This area is the club's honours
// board and the reference gives it rhythm rather than one repeated hue — an
// all-blue version read as a settings list.
const TINT = {
  streak: '#F59A0B',
  goalsEvening: '#0B57FF',
  shootoutsEvening: '#E5322F',
  longestEvening: '#00A84A',
} as const;

export function buildClubRecords(input: ClubRecordsInput): ClubRecord[] {
  const out: ClubRecord[] = [];

  // 1. Longest attendance streak. Needs BOTH a number and a holder — the uid
  //    goes missing on archived seasons whose member left the club.
  if (input.longestStreak > 1 && input.longestStreakUid) {
    const name = input.nameOf(input.longestStreakUid);
    if (name) {
      out.push({
        key: 'streak',
        icon: 'flame',
        tint: TINT.streak,
        label: he.clubRecordStreak,
        value: String(input.longestStreak),
        hint: he.clubRecordStreakHint,
        holderUid: input.longestStreakUid,
        holderName: name,
      });
    }
  }

  // 2-4. The three EVENING records. Each names the evening it was set in and
  //      carries its id, which is what makes the card tappable — the other
  //      record here spans many evenings and deliberately has neither.
  const evening = (
    key: string,
    rec: EveningRecordInput | null,
    icon: string,
    tint: string,
    label: string,
    hint: string,
  ) => {
    if (!rec || rec.value <= 0) return;
    out.push({
      key,
      icon,
      tint,
      label,
      value: String(rec.value),
      hint,
      gameId: rec.gameId,
      at: rec.at,
    });
  };
  evening(
    'goalsEvening',
    input.mostGoalsEvening,
    'football',
    TINT.goalsEvening,
    he.clubRecordMostGoals,
    he.clubRecordMostGoalsHint,
  );
  evening(
    'shootoutsEvening',
    input.mostShootoutsEvening,
    'disc',
    TINT.shootoutsEvening,
    he.clubRecordMostShootouts,
    he.clubRecordMostShootoutsHint,
  );
  evening(
    'longestEvening',
    input.longestEvening,
    'stopwatch',
    TINT.longestEvening,
    he.clubRecordLongestEvening,
    he.clubRecordLongestEveningHint,
  );

  // ⚠️ "ממוצע משתתפים" and "אחוז ארגון" USED to be here and were removed.
  // Neither is a record. The test is whether the sentence "the club's record
  // is …" survives: "the club's record is 11 players per night" is not a
  // record, it is an average, and an average sitting in an honours board
  // devalues the two entries beside it that really are records.
  //
  // What the reference asks for — longest winning run, longest unbeaten run,
  // biggest win, most goals in one mini-game — is NOT computable from the
  // aggregations this app keeps. Round scores live in `rounds/{id}` and
  // deriving a maximum means scanning every mini-game the club has ever
  // played. See the report: a server-side running maximum in the same write
  // as the other counters would make all four exact and free, going forward.

  return out;
}
