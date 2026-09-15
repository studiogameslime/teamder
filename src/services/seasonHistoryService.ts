// seasonHistoryService — a club's finished seasons, and who won what.
//
// Nothing here is recomputed: a past season is a record, and a record that
// changes because the code did is not a record. That includes the NAMES — the
// close froze its players' display names, precisely so a season still reads
// after somebody deletes their account or leaves the club.
//
// It reads `seasonCards`, not the archives. The archive holds every player's
// row and every pair's ten counters and is the record; the card is what this
// screen needs — a date, three numbers, nine names — written by the same close
// from the same numbers. One source, two sizes.

import { collection, getDocs, query, where } from 'firebase/firestore';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { logError } from '@/services/errorLog';
import { SEASON_TITLE_KEYS, type SeasonTitleKey } from '@/utils/seasonAwards';

export interface SeasonWinner {
  key: SeasonTitleKey;
  /** Every holder — ties are shared, never broken. */
  names: string[];
  value: number;
}

export interface FinishedSeason {
  seasonId: string;
  no: number;
  startsAt: number;
  endsAt: number;
  /** Rounds the club finished, from the sealed count. */
  completedRounds: number;
  /** Mini-games, goals and assists the club recorded that season. */
  totals: { rounds: number; goals: number; assists: number };
  /** How many people played at all. */
  players: number;
  /** Closed early by an admin rather than by reaching its target. */
  endedEarly: boolean;
  /**
   * Season 1 of a club older than some of the metrics. The titles were still
   * awarded; the summary says so rather than pretending the numbers are whole.
   */
  partialData: boolean;
  winners: SeasonWinner[];
}

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A card is already the shape this screen wants; only validation is left. */
function fromCard(d: Record<string, unknown>): FinishedSeason | null {
  const seasonId = str(d.seasonId);
  if (!seasonId) return null;
  const totals = (d.totals ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(d.winners) ? d.winners : [];
  const known = new Set<string>(SEASON_TITLE_KEYS);
  const winners: SeasonWinner[] = [];
  for (const w of raw) {
    if (typeof w !== 'object' || w === null) continue;
    const x = w as Record<string, unknown>;
    const key = str(x.key);
    // A title this build does not know about is skipped rather than rendered
    // as a blank row.
    if (!known.has(key)) continue;
    const names = Array.isArray(x.names)
      ? x.names.filter((n): n is string => typeof n === 'string')
      : [];
    if (names.length === 0) continue;
    winners.push({ key: key as SeasonTitleKey, names, value: num(x.value) });
  }
  return {
    seasonId,
    no: num(d.no),
    startsAt: num(d.startsAt),
    endsAt: num(d.endsAt),
    completedRounds: num(d.completedRounds),
    totals: {
      rounds: num(totals.rounds),
      goals: num(totals.goals),
      assists: num(totals.assists),
    },
    players: num(d.players),
    endedEarly: d.endedEarly === true,
    partialData: d.partialData === true,
    winners,
  };
}

export const seasonHistoryService = {
  /** Finished seasons for one club, newest first. */
  async list(groupId: string): Promise<FinishedSeason[] | 'error'> {
    if (!groupId) return [];
    if (USE_MOCK_DATA) return mockHistory();
    try {
      const { db } = getFirebase();
      // Read the CARDS, not the archives.
      //
      // The archive holds every player's row and every pair's ten counters. A
      // five-season, sixty-player club is well over a megabyte, and this screen
      // shows a date, three numbers and nine names. `seasonCards` is written by
      // the same close, from the same numbers, with the winners already
      // resolved — so it is the same truth at a hundredth of the size.
      //
      // Filtered on the FIELD, never on the document id: a list query does not
      // bind the path wildcard, and reading groupId off the path denies the
      // whole query with a null-value error.
      const snap = await getDocs(
        query(collection(db, 'seasonCards'), where('groupId', '==', groupId)),
      );
      const out: FinishedSeason[] = [];
      snap.forEach((doc) => {
        const s = fromCard(doc.data() as Record<string, unknown>);
        if (s) out.push(s);
      });
      return out.sort((a, b) => b.no - a.no);
    } catch (err) {
      logError('seasonHistoryList', err, { groupId });
      // NOT []. An empty list means "this club has finished no seasons", and a
      // club with five archives told that on a dropped connection reads as
      // having lost them.
      return 'error';
    }
  },
};

function mockHistory(): FinishedSeason[] {
  return [
    {
      seasonId: 's1',
      no: 1,
      startsAt: 1_752_000_000_000,
      endsAt: 1_776_000_000_000,
      completedRounds: 26,
      totals: { rounds: 118, goals: 642, assists: 301 },
      players: 19,
      endedEarly: false,
      partialData: true,
      winners: [
        { key: 'topScorer', names: ['דני'], value: 41 },
        { key: 'topAssister', names: ['רועי'], value: 28 },
        { key: 'topWinner', names: ['דני', 'עומר'], value: 64 },
        { key: 'mostLoyal', names: ['רועי'], value: 24 },
        { key: 'cleanSheetKing', names: ['עומר'], value: 17 },
        { key: 'deadlyDuo', names: ['דני + רועי'], value: 14 },
      ],
    },
  ];
}
