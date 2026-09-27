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

import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { logError } from '@/services/errorLog';
import { SEASON_TITLE_KEYS, type SeasonTitleKey } from '@/utils/seasonAwards';
import { type PairTotals } from '@/utils/clubChemistry';
import { parseSeasonTable, type FinishedSeasonTable } from '@/utils/seasonArchive';

import type { ChampionshipRow } from '@/utils/championship';
import { mockPlayers } from '@/data/mockData';
import { readSeasonCoverage } from '@/utils/seasonCoverage';

export { parseSeasonTable, type FinishedSeasonTable };

export interface SeasonWinner {
  key: SeasonTitleKey;
  /**
   * How much of the season a RATING was really built from — present only on
   * titles whose value is an average, and only when the archive recorded it.
   *
   * ⚠️ OPTIONAL by design. Every season closed before 20.09.2026 has winners
   * with no such field, and they must keep rendering exactly as they do now.
   * Absent means "no claim either way", never "zero of zero".
   */
  coverage?: { rated: number; of: number };
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
    const coverage = readSeasonCoverage(x);
    winners.push({
      key: key as SeasonTitleKey,
      names,
      value: num(x.value),
      ...(coverage ? { coverage } : {}),
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
    players: num(d.players),
    endedEarly: d.endedEarly === true,
    partialData: d.partialData === true,
    winners,
  };
}

export const seasonHistoryService = {
  async table(
    groupId: string,
    seasonId: string,
  ): Promise<FinishedSeasonTable | null> {
    if (!groupId || !seasonId) return null;
    if (USE_MOCK_DATA) return mockTable();
    try {
      const { db } = getFirebase();
      const snap = await getDoc(
        doc(db, 'seasonSummary', `${groupId}__${seasonId}`),
      );
      if (!snap.exists()) return null;
      return parseSeasonTable(snap.data() as Record<string, unknown>);
    } catch (err) {
      logError('seasonHistoryTable', err, { groupId, seasonId });
      return null;
    }
  },

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

/**
 * A closed season in mock mode.
 *
 * Built from the real mock players so the picker's past-season view has
 * avatars and names that resolve — plus one player who is NOT in the mock
 * roster, standing in for somebody who has since left the club. That row must
 * still render, off the frozen name alone; it is the whole reason the archive
 * keeps names at all.
 */
function mockTable(): FinishedSeasonTable {
  const row = (
    uid: string,
    goals: number,
    assists: number,
    rounds: number,
    wins: number,
    games: number,
  ): ChampionshipRow => ({
    uid,
    goals,
    assists,
    rounds,
    wins,
    games,
    ties: 2,
    losses: Math.max(0, rounds - wins - 2),
    penTaken: 0,
    penScored: 0,
    penFaced: 0,
    penSaved: 0,
    ownGoals: 0,
    cleanSheets: Math.round(rounds / 5),
    csRounds: rounds,
  });
  const p = (i: number) => mockPlayers[i % mockPlayers.length];
  return {
    totalGoals: 642,
    totalRounds: 118,
    tiedRounds: 21,
    countedRounds: 118,
    shootoutRounds: 6,
    scorelessRounds: 9,
    guestGoals: 37,
    ownGoals: 11,
    duo: { uidA: p(6).id, uidB: p(2).id, assists: 14 },
    // A closed season's chemistry, so the mock exercises the same section the
    // running season draws. Deliberately uneven: one pair that plays together
    // constantly, one that wins when it does, a wall, and a rivalry that is
    // nearly even — one card each, rather than six views of one shape.
    pairs: (() => {
      const k = (x: string, y: string) => (x < y ? `${x}__${y}` : `${y}__${x}`);
      const pair = (o: Partial<PairTotals>): PairTotals => ({
        sameTeam: 0, winsTogether: 0, lossesTogether: 0, cleanSheetsTogether: 0,
        against: 0, winsA: 0, winsB: 0, assistsAToB: 0, assistsBToA: 0, ...o,
      });
      return {
        [k(p(6).id, p(2).id)]: pair({
          sameTeam: 61, winsTogether: 38, lossesTogether: 15,
          cleanSheetsTogether: 9, assistsAToB: 9, assistsBToA: 5,
        }),
        [k(p(4).id, p(9).id)]: pair({
          sameTeam: 24, winsTogether: 19, lossesTogether: 3,
          cleanSheetsTogether: 11, assistsAToB: 2, assistsBToA: 1,
        }),
        [k(p(6).id, p(4).id)]: pair({
          against: 47,
          ...(p(6).id < p(4).id ? { winsA: 25, winsB: 22 } : { winsA: 22, winsB: 25 }),
        }),
        [k(p(2).id, p(9).id)]: pair({
          against: 31,
          ...(p(2).id < p(9).id ? { winsA: 23, winsB: 8 } : { winsA: 8, winsB: 23 }),
        }),
      };
    })(),
    players: [
      row(p(6).id, 41, 12, 24, 14, 8),
      row(p(2).id, 18, 28, 20, 11, 6),
      row(p(4).id, 22, 9, 12, 5, 4),
      row(p(9).id, 7, 15, 18, 9, 7),
      row('u_left_the_club', 13, 4, 9, 4, 3),
    ],
    names: {
      [p(6).id]: p(6).displayName,
      [p(2).id]: p(2).displayName,
      [p(4).id]: p(4).displayName,
      [p(9).id]: p(9).displayName,
      u_left_the_club: 'שחקן שעזב',
    },
  };
}

