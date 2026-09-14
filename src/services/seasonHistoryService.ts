// seasonHistoryService — a club's finished seasons, and who won what.
//
// Everything here comes out of the sealed archive and nothing is recomputed:
// a past season is a record, and a record that changes because the code did is
// not a record. That includes the NAMES — each archive froze its players'
// display names at closing time, precisely so a season still reads after
// somebody deletes their account or leaves the club.

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

/**
 * Resolve a winner id to a name using the season's OWN frozen roster.
 *
 * The duo title is held under a joined `a__b` key; both halves are looked up.
 * An id with no row in this archive renders as a dash rather than as an empty
 * string, so a missing name looks deliberate instead of broken.
 */
function nameOf(
  winnerId: string,
  players: Record<string, Record<string, unknown>>,
): string {
  return winnerId
    .split('__')
    .map((uid) => str(players[uid]?.displayName) || '—')
    .join(' + ');
}

function toSeason(d: Record<string, unknown>): FinishedSeason | null {
  const seasonId = str(d.seasonId);
  if (!seasonId) return null;
  const players = (d.players ?? {}) as Record<string, Record<string, unknown>>;
  const awards = (d.awards ?? {}) as Record<string, unknown>;
  const totals = (d.totals ?? {}) as Record<string, unknown>;

  const winners: SeasonWinner[] = [];
  for (const key of SEASON_TITLE_KEYS) {
    const a = awards[key] as { winners?: unknown; value?: unknown } | null | undefined;
    if (!a || !Array.isArray(a.winners) || a.winners.length === 0) continue;
    winners.push({
      key,
      names: a.winners
        .filter((w): w is string => typeof w === 'string')
        .map((w) => nameOf(w, players)),
      value: num(a.value),
    });
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
    // Only people who actually played. A member who never turned up has a row
    // of zeros and did not take part in the season.
    players: Object.values(players).filter((p) => num(p.rounds) > 0).length,
    endedEarly: d.endedEarly === true,
    partialData: d.partialData === true,
    winners,
  };
}

export const seasonHistoryService = {
  /** Finished seasons for one club, newest first. */
  async list(groupId: string): Promise<FinishedSeason[]> {
    if (!groupId) return [];
    if (USE_MOCK_DATA) return mockHistory();
    try {
      const { db } = getFirebase();
      // Filtered on the FIELD, never on the document id: a list query does not
      // bind the path wildcard, and reading groupId off the path denies the
      // whole query with a null-value error.
      const snap = await getDocs(
        query(collection(db, 'seasonSummary'), where('groupId', '==', groupId)),
      );
      const out: FinishedSeason[] = [];
      snap.forEach((doc) => {
        const s = toSeason(doc.data() as Record<string, unknown>);
        if (s) out.push(s);
      });
      return out.sort((a, b) => b.no - a.no);
    } catch (err) {
      logError('seasonHistoryList', err, { groupId });
      return [];
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
