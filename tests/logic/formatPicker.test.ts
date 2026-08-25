// The open format picker: 3–11 players per team × 2–7 teams.
//
// The numbers used to be four chips (4v4–7v7) and four more (2–5 teams), and
// the ceilings only ever existed in that markup — every consumer underneath
// derived the size from the string, and every one of them fell through to 5
// for a string it did not recognise. So the cases here are less about the
// stepper's arithmetic than about the promise the stepper now makes: a number
// the user can reach is a number the rest of the app actually honours.

import {
  TEAM_COUNT_BOUNDS,
  TEAM_SIZE_BOUNDS,
  clampToBounds,
  commitTyped,
  fitAgainstRoster,
  stepBy,
  totalPlayers,
} from '@/utils/formatPicker';
import {
  DEFAULT_FORMAT,
  DEFAULT_TEAM_COUNT,
  DEFAULT_TEAM_SIZE,
  TEAM_COUNT_MAX,
  TEAM_COUNT_MIN,
  TEAM_SIZE_MAX,
  TEAM_SIZE_MIN,
  formatFromTeamSize,
  teamSizeFromFormat,
} from '@/types';
import { gameFormatLabel } from '@/utils/format';
import { MAX_TEAMS, MIN_TEAMS, TEAM_LETTERS, teamName } from '@/utils/draft';
import { he } from '@/i18n/he';

const size = TEAM_SIZE_BOUNDS;
const count = TEAM_COUNT_BOUNDS;

// 1 — the default a new game opens with.
describe('defaults', () => {
  it('a new game is 5 × 5 with 3 teams', () => {
    expect(DEFAULT_TEAM_SIZE).toBe(5);
    expect(DEFAULT_TEAM_COUNT).toBe(3);
    expect(DEFAULT_FORMAT).toBe('5v5');
    expect(teamSizeFromFormat(DEFAULT_FORMAT)).toBe(DEFAULT_TEAM_SIZE);
    expect(he.formatSummary(DEFAULT_TEAM_SIZE, DEFAULT_TEAM_COUNT)).toBe(
      '5 × 5 · 3 קבוצות',
    );
  });
});

// 2, 3, 4 — the steppers.
describe('stepping', () => {
  it('+ on players goes 5 → 6, and the format string follows', () => {
    const next = stepBy(5, +1, size);
    expect(next).toBe(6);
    expect(formatFromTeamSize(next)).toBe('6v6');
  });

  it('− on players goes 5 → 4', () => {
    expect(stepBy(5, -1, size)).toBe(4);
  });

  it('+ on teams goes 3 → 4', () => {
    expect(stepBy(3, +1, count)).toBe(4);
  });

  it('stops at the ends instead of drifting past them', () => {
    expect(stepBy(TEAM_SIZE_MIN, -1, size)).toBe(TEAM_SIZE_MIN);
    expect(stepBy(TEAM_SIZE_MAX, +1, size)).toBe(TEAM_SIZE_MAX);
    expect(stepBy(TEAM_COUNT_MIN, -1, count)).toBe(TEAM_COUNT_MIN);
    expect(stepBy(TEAM_COUNT_MAX, +1, count)).toBe(TEAM_COUNT_MAX);
  });

  it('a burst of presses lands where the same presses one at a time would', () => {
    let v = 5;
    for (let i = 0; i < 20; i++) v = stepBy(v, +1, size);
    expect(v).toBe(TEAM_SIZE_MAX);
    for (let i = 0; i < 20; i++) v = stepBy(v, -1, size);
    expect(v).toBe(TEAM_SIZE_MIN);
  });
});

// 5 — typing into the number field.
describe('typing a value directly', () => {
  it('takes a valid number', () => {
    expect(commitTyped('9', 5, size)).toBe(9);
    expect(commitTyped(' 7 ', 5, size)).toBe(7);
  });

  // 8 — invalid entries.
  it('keeps the current value for anything that is not a number', () => {
    // '' is the legitimate mid-edit state: the user cleared the field to type
    // a two-digit number. It must not become NaN and reach Firestore.
    expect(commitTyped('', 5, size)).toBe(5);
    expect(commitTyped('-', 5, size)).toBe(5);
    expect(commitTyped('abc', 5, size)).toBe(5);
  });

  it('clamps out-of-range entries rather than rejecting them', () => {
    expect(commitTyped('0', 5, size)).toBe(TEAM_SIZE_MIN);
    expect(commitTyped('-4', 5, size)).toBe(TEAM_SIZE_MIN);
    expect(commitTyped('99', 5, size)).toBe(TEAM_SIZE_MAX);
    expect(commitTyped('1', 3, count)).toBe(TEAM_COUNT_MIN);
    expect(commitTyped('40', 3, count)).toBe(TEAM_COUNT_MAX);
  });

  it('never yields NaN', () => {
    for (const raw of ['', ' ', '-', '+', '.', 'NaN', '1e5', '٣']) {
      expect(Number.isFinite(commitTyped(raw, 5, size))).toBe(true);
    }
    expect(clampToBounds(Number.NaN, size)).toBe(TEAM_SIZE_MIN);
    expect(clampToBounds(Number.POSITIVE_INFINITY, size)).toBe(TEAM_SIZE_MIN);
  });
});

// 6, 7 — the live total. n is PER TEAM; this is the number the old copy got
// wrong often enough that the summary spells it out.
describe('total players', () => {
  it('5 × 5 with 3 teams is 15', () => {
    expect(totalPlayers(5, 3)).toBe(15);
    expect(he.formatTotalPlayers(totalPlayers(5, 3))).toBe('סך הכל 15 שחקנים');
  });

  it('6 × 6 with 4 teams is 24', () => {
    expect(totalPlayers(6, 4)).toBe(24);
  });

  it('the biggest reachable structure is 11 × 7 = 77', () => {
    expect(totalPlayers(TEAM_SIZE_MAX, TEAM_COUNT_MAX)).toBe(77);
  });
});

// 9, 10 — what is stored and what comes back.
describe('persistence round-trip', () => {
  it('every reachable size survives format → string → size', () => {
    for (let n = TEAM_SIZE_MIN; n <= TEAM_SIZE_MAX; n++) {
      expect(teamSizeFromFormat(formatFromTeamSize(n))).toBe(n);
    }
  });

  it('reopening a stored 5v5 shows 5 × 5', () => {
    expect(teamSizeFromFormat('5v5')).toBe(5);
    expect(gameFormatLabel('5v5')).toBe('5 × 5');
  });

  // 12 — the sizes the old four-chip whitelist did not know about.
  it('reopening a stored 8v8 shows 8 × 8, not 5 × 5', () => {
    expect(teamSizeFromFormat('8v8')).toBe(8);
    expect(gameFormatLabel('8v8')).toBe('8 × 8');
    expect(gameFormatLabel('11v11')).toBe('11 × 11');
  });

  it('a corrupt or missing format still reads as the default, never NaN', () => {
    expect(teamSizeFromFormat(undefined)).toBe(DEFAULT_TEAM_SIZE);
    expect(teamSizeFromFormat('')).toBe(DEFAULT_TEAM_SIZE);
    expect(teamSizeFromFormat('5v7')).toBe(5);
    expect(teamSizeFromFormat('99v99')).toBe(DEFAULT_TEAM_SIZE);
  });
});

// 11, 13 — more than five teams.
describe('six and seven teams', () => {
  it('the draft screen no longer clamps below what the picker offers', () => {
    // MAX_TEAMS was 4 while the picker already offered 5, so a 5-team game
    // silently drafted into 4 and the fifth team's players sat on the bench.
    expect(MIN_TEAMS).toBe(TEAM_COUNT_MIN);
    expect(MAX_TEAMS).toBe(TEAM_COUNT_MAX);
  });

  it('every team has its own name and letter', () => {
    const names = Array.from({ length: TEAM_COUNT_MAX }, (_, i) => teamName(i));
    expect(new Set(names).size).toBe(TEAM_COUNT_MAX);
    expect(names.every((n) => !/\d/.test(n))).toBe(true);
    expect(names[4]).toBe('קבוצה כתומה');
    expect(names[6]).toBe('קבוצה שחורה');
    expect(TEAM_LETTERS).toHaveLength(TEAM_COUNT_MAX);
  });
});

// The roster-fit line, edit flow only.
describe('fit against the registered roster', () => {
  it('says nothing when there is no roster to compare with', () => {
    expect(fitAgainstRoster(15, undefined)).toBeNull();
    expect(fitAgainstRoster(15, 0)).toBeNull();
  });

  it('counts the gap in both directions', () => {
    expect(fitAgainstRoster(20, 20)).toEqual({ kind: 'exact', by: 0 });
    expect(fitAgainstRoster(20, 18)).toEqual({ kind: 'short', by: 2 });
    expect(fitAgainstRoster(20, 23)).toEqual({ kind: 'over', by: 3 });
  });

  it('reads as Hebrew for one player, not "חסרים 1"', () => {
    expect(he.formatFitShort(1)).toBe('חסר שחקן אחד למבנה שבחרת');
    expect(he.formatFitShort(2)).toBe('חסרים 2 שחקנים למבנה שבחרת');
    expect(he.formatFitOver(1)).toBe('שחקן אחד מעבר למבנה שבחרת');
  });
});

// 14 — the shape almost every real game uses.
describe('no regression on 5 × 5 with 3 teams', () => {
  it('behaves exactly as before end to end', () => {
    const fmt = formatFromTeamSize(5);
    expect(fmt).toBe('5v5');
    expect(teamSizeFromFormat(fmt)).toBe(5);
    expect(totalPlayers(teamSizeFromFormat(fmt), 3)).toBe(15);
    expect(gameFormatLabel(fmt)).toBe('5 × 5');
    expect(teamName(0)).toBe('קבוצה אדומה');
    expect(teamName(2)).toBe('קבוצה ירוקה');
  });
});
