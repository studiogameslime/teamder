// eveningSummaryService — builds the shareable "סיכום הערב" model for one
// player in one finished game, from data across phases:
//   • phase 1  goals/assists/wins/losses/rounds → gamePlayerStats + eveningScore
//   • phase 2  contribution% / held-the-pitch / GF-GA → games/{id}/roundHistory
//   • phase 3  physical panel + funny numbers → games/{id}/physical/{uid}
//   • phase 4  heatmap + DNA radar → the same physical doc (heatGrid + metrics)
//
// Every richer section is OPTIONAL: when its data doesn't exist yet (a game
// finished before phase 2 shipped, a player with no wearable) the field is
// null and the card simply doesn't render that section.

import {
  collection,
  doc,
  getDoc,
  getDocs,
} from 'firebase/firestore';
import { gameService } from '@/services/gameService';
import { userService } from '@/services/userService';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { logError } from '@/services/errorLog';
import { eveningScore } from '@/utils/eveningScore';
import {
  pickEveningTitle,
  pickEveningInsights,
  type InsightLine,
  type NarrativeStats,
} from '@/utils/eveningNarrative';
import {
  reduceRounds,
  type RoundHistoryDoc,
} from '@/utils/eveningStats';
import type { UserId } from '@/types';
import { eveningHighlights, type EveningHighlight, type PersonalEveningRecord } from '@/utils/eveningHighlights';
import { readPersonalEveningRecords } from '@/services/eveningRecordService';
import { eveningPlayState } from '@/utils/eveningPlayed';

export { eveningScore } from '@/utils/eveningScore';

/** One club-table metric (goals / assists / wins) as of tonight. */
export interface EveningMetric {
  key: 'goals' | 'assists' | 'wins';
  /** The player's SEASON total after tonight (communityPlayerStats is zeroed
   *  on every season close, so this is not a career figure). */
  value: number;
  rank: number;
  /** Places climbed tonight (+ = up). */
  delta: number;
  /** What tonight alone contributed to `value`, so `value - tonight` is what
   *  the player brought into the evening. The server sends the cumulative
   *  figure only, and without the other half "first with a delta of 0" cannot
   *  be told apart from "first because everyone is on zero and the tie fell to
   *  my uid" — see the crown guard in eveningProgress.
   *
   *  It does NOT come from the standing doc; `readMetrics` fills it from this
   *  game's own gamePlayerStats row, which the card has already read, so every
   *  block the reader emits carries it. Optional only because `mockModel` and
   *  any future caller build this type by hand — a `tonight == null` branch
   *  downstream is a belt, not a live path, and the real way `before` comes
   *  back null is the SERVER omitting the metric block entirely (`hadTable` in
   *  onGameRosterChanged), which is a different condition. */
  tonight?: number;
  /** Who you went past tonight — NAMES are capped, the count is the truth. */
  passed: string[];
  passedCount: number;
  /** Who went past you. Same split. */
  passedBy: string[];
  passedByCount: number;
  /** The player directly above you, and by how much. */
  aheadName: string | null;
  aheadGap: number | null;
}

const METRIC_ORDER: EveningMetric['key'][] = ['goals', 'assists', 'wins'];

/**
 * Read the server-computed per-metric block. Everything is validated on the
 * way in: a metric with no rank is dropped rather than rendered as "מקום 0",
 * and names are filtered to real strings so a partial write can't put
 * "undefined" on the card.
 */
function readMetrics(raw: unknown, tonight: GameStatRow): EveningMetric[] {
  if (!raw || typeof raw !== 'object') return [];
  const src = raw as Record<string, unknown>;
  const strList = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];
  const out: EveningMetric[] = [];
  for (const key of METRIC_ORDER) {
    const m = src[key];
    if (!m || typeof m !== 'object') continue;
    const d = m as Record<string, unknown>;
    const rank = typeof d.rank === 'number' ? d.rank : 0;
    if (rank <= 0) continue;
    out.push({
      key,
      value: typeof d.value === 'number' ? d.value : 0,
      rank,
      delta: typeof d.delta === 'number' ? d.delta : 0,
      // Tonight's half comes from THIS game's own stat row, not from the
      // standing doc — same evening, same player, and it is already read.
      tonight:
        key === 'goals'
          ? tonight.goals
          : key === 'assists'
            ? tonight.assists
            : tonight.wins,
      passed: strList(d.passed),
      passedCount:
        typeof d.passedCount === 'number' ? d.passedCount : strList(d.passed).length,
      passedBy: strList(d.passedBy),
      passedByCount:
        typeof d.passedByCount === 'number'
          ? d.passedByCount
          : strList(d.passedBy).length,
      aheadName: typeof d.aheadName === 'string' ? d.aheadName : null,
      aheadGap: typeof d.aheadGap === 'number' ? d.aheadGap : null,
    });
  }
  return out;
}

export interface EveningSummaryModel {
  gameId: string;
  uid: UserId;
  playerName: string;
  dateLabel: string;
  communityName: string;
  /** mini-games the player was on the field for. */
  rounds: number;
  /** total mini-games in the evening (≥ rounds); player sat the rest out. */
  totalRounds: number;
  /** whether the evening total is actually KNOWN (roundHistory exists). Old
   *  games predating roundHistory can't know it — don't claim "played all". */
  totalKnown: boolean;
  wins: number;
  losses: number;
  winRate: number;
  goals: number;
  assists: number;
  score: number;
  title: string;
  titleEmoji: string;
  /** situational "alive" strips picked by this player's actual performance. */
  insights: InsightLine[];
  // Comparison vs the player's previous evening + their community-table standing.
  // Computed at end-of-evening (onGameRosterChanged) AFTER the ranking is final,
  // stored at eveningStandings/{gameId__uid} — the card reads it, never re-ranks.
  scoreDelta: number | null; // score − previous evening's score
  rank: number | null; // 1-based place in the community table
  rankTotal: number | null;
  rankDelta: number | null; // places climbed since before this evening (+ = up)
  /** Where tonight's score placed me among everyone who played tonight. */
  scoreRank: number | null;
  scoreTotal: number | null;
  /** Per-metric standing in the club, with the names actually passed tonight.
   *  Computed server-side at end-of-evening from the before/after orderings. */
  metrics: EveningMetric[];
  // phase 2
  heldPitch: number;
  teamGoalsFor: number;
  teamGoalsAgainst: number;
  highlights?: EveningHighlight[];
  personalRecords?: PersonalEveningRecord[];
  /** Exact committed outcomes, only when every played round is present. */
  outcomes?: Array<'win' | 'loss' | 'draw'>;
  teamGoalsKnown?: boolean;
  penalties?: NarrativeStats['pen'];
  recordScope?: { groupId: string; startsAt: number };
}

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function formatDateLabel(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `יום ${WEEKDAYS[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}`;
}

interface GameStatRow {
  goals: number;
  assists: number;
  wins: number;
  losses: number;
  rounds: number;
  teamGoalsFor: number;
  teamGoalsAgainst: number;
  /** whether gamePlayerStats carried the authoritative team-goals fields (they
   *  were added with this feature; older per-game docs lack them). */
  hasTeamGoals: boolean;
  pen: NarrativeStats['pen'];
  hasPenaltyStats: boolean;
}

function readStatRow(data: Record<string, unknown> | undefined): GameStatRow {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    goals: n(data?.goals),
    assists: n(data?.assists),
    wins: n(data?.wins),
    losses: n(data?.losses),
    rounds: n(data?.rounds),
    teamGoalsFor: n(data?.teamGoalsFor),
    teamGoalsAgainst: n(data?.teamGoalsAgainst),
    hasTeamGoals: ['teamGoalsFor', 'teamGoalsAgainst'].every((k) => typeof data?.[k] === 'number' && Number.isFinite(data[k])),
    pen: { scored: n(data?.penScored), saved: n(data?.penSaved), missed: n(data?.penMissed), conceded: n(data?.penConceded) },
    hasPenaltyStats: ['penScored', 'penSaved', 'penMissed', 'penConceded'].some((k) => typeof data?.[k] === 'number'),
  };
}

function mockModel(gameId: string, uid: UserId): EveningSummaryModel {
  if (__DEV__ && gameId === 'qa-summary-quiet') {
    return { gameId, uid, playerName: 'אלירן צברי', communityName: 'כדורגל אנשים טובים', dateLabel: 'יום רביעי, 7.10',
      rounds: 3, totalRounds: 8, totalKnown: true, wins: 1, losses: 2, winRate: 33, goals: 0, assists: 0,
      score: eveningScore({ goals: 0, assists: 0, wins: 1, gamesPlayed: 3, pen: { scored: 0, saved: 0, missed: 0, conceded: 0 } }),
      title: '', titleEmoji: '', insights: [], scoreDelta: null, rank: null, rankTotal: null, rankDelta: null,
      scoreRank: null, scoreTotal: null, metrics: [], heldPitch: 0, teamGoalsFor: 0, teamGoalsAgainst: 0,
      highlights: [], personalRecords: [], outcomes: ['loss', 'win', 'loss'], teamGoalsKnown: false };
  }
  const goals = 4;
  const assists = 3;
  const wins = 5;
  const losses = 2;
  const rounds = 7;
  const mockNarrative: NarrativeStats = {
    goals, assists, wins, losses, gamesPlayed: rounds, totalRounds: 12,
    heldPitch: 2, scoringStreak: 3,
    bestMiniGame: { round: 3, goals: 2, assists: 1 },
    pen: { scored: 1, saved: 1, missed: 0, conceded: 0 },
  };
  const t = pickEveningTitle(mockNarrative, `${gameId}:${uid}`);
  return {
    gameId,
    uid,
    playerName: 'מתן לוי',
    dateLabel: 'יום רביעי, 8.7',
    communityName: 'מכבי חולון',
    rounds,
    totalRounds: 12,
    totalKnown: true,
    wins,
    losses,
    winRate: Math.round((wins / (wins + losses)) * 100),
    goals,
    assists,
    score: eveningScore({
      goals, assists, wins, gamesPlayed: rounds,
      pen: mockNarrative.pen,
    }),
    title: t.title,
    titleEmoji: t.emoji,
    insights: pickEveningInsights(mockNarrative, `${gameId}:${uid}`),
    scoreDelta: 0.6,
    rank: 3,
    rankTotal: 24,
    rankDelta: 2,
    scoreRank: __DEV__ && gameId === 'qa-summary-top' ? 1 : 3,
    scoreTotal: 15,
    metrics: [
      // `tonight` matches the goals/assists/wins this mock player scored above,
      // the way the real reader builds it — a mock whose halves disagree tests
      // a shape the code cannot produce.
      {
        key: 'goals', value: 31, rank: 4, delta: 3, tonight: goals,
        passed: ['שלומי', 'יוסי', 'נדב'], passedCount: 3,
        passedBy: [], passedByCount: 0,
        aheadName: 'דניאל', aheadGap: 2,
      },
      {
        key: 'assists', value: 23, rank: 6, delta: -1, tonight: assists,
        passed: [], passedCount: 0,
        passedBy: ['אבי'], passedByCount: 1,
        aheadName: 'אבי', aheadGap: 2,
      },
      {
        key: 'wins', value: 48, rank: 2, delta: 0, tonight: wins,
        passed: [], passedCount: 0, passedBy: [], passedByCount: 0,
        aheadName: 'דניאל', aheadGap: 5,
      },
    ],
    heldPitch: 5,
    teamGoalsFor: 17,
    teamGoalsAgainst: 9,
    highlights: eveningHighlights(mockNarrative, true),
    personalRecords: [{ metric: 'goals', value: goals, previous: 3, kind: 'new' }],
    outcomes: ['win', 'win', 'loss', 'win', 'loss', 'win', 'win'],
    teamGoalsKnown: true,
    penalties: mockNarrative.pen,
  };
}

export const eveningSummaryService = {
  async getEveningSummary(
    gameId: string,
    uid: UserId,
    viewerName?: string,
  ): Promise<EveningSummaryModel | null> {
    if (!gameId || !uid) return null;
    if (USE_MOCK_DATA) return mockModel(gameId, uid);

    try {
      const db = getFirebase().db;
      // The core reads (game, per-game stat, name) drive the always-present
      // sections. The roundHistory read is OPTIONAL — an old game predating it,
      // or a denied/failed read, degrades to "no contribution", never crashes.
      const [game, statSnap, roundSnap, name, standSnap] =
        await Promise.all([
          gameService.getGameById(gameId).catch(() => null),
          getDoc(doc(db, 'gamePlayerStats', `${gameId}__${uid}`)).catch(() => null),
          getDocs(collection(db, 'games', gameId, 'roundHistory')).catch(() => null),
          (viewerName
            ? Promise.resolve(viewerName)
            : userService.getUserById(uid).then((u) => u?.name ?? '')
          ).catch(() => ''),
          getDoc(doc(db, 'eveningStandings', `${gameId}__${uid}`)).catch(
            () => null,
          ),
        ]);
      const stand =
        standSnap && standSnap.exists()
          ? (standSnap.data() as Record<string, unknown>)
          : null;
      const numOrNull = (v: unknown) =>
        typeof v === 'number' && Number.isFinite(v) ? v : null;

      const row = readStatRow(
        statSnap && statSnap.exists() ? statSnap.data() : undefined,
      );

      // phase 2 — derive from round history (empty for old games)
      const rounds = roundSnap
        ? roundSnap.docs.map((d) => d.data() as RoundHistoryDoc)
        : [];
      const rs = reduceRounds(uid, rounds);

      const decided = row.wins + row.losses;
      // Evening total = number of roundHistory docs (one per committed mini-
      // game). Accurate for games from this feature onward; OLD games have no
      // roundHistory, so we fall back to the played count (total unknowable).
      const totalRounds = Math.max(rounds.length, row.rounds);
      // roundHistory docs are written best-effort (outside the atomic stats
      // batch), so some can be missing while gamePlayerStats.rounds (the
      // player's authoritative played count) is complete. If roundHistory shows
      // FEWER of this player's rounds than they actually played, the log is
      // incomplete and its total can't be trusted — so don't claim the total is
      // "known" (which would make the card assert "played ALL N" to a player who
      // sat rounds out).
      const totalKnown = rounds.length > 0 && rs.playedRounds >= row.rounds;

      // GF/GA: prefer the AUTHORITATIVE gamePlayerStats team goals (committed in
      // the atomic round batch) over the best-effort roundHistory reduction,
      // which under-counts when a roundHistory write failed.
      const teamGoalsFor = row.hasTeamGoals ? row.teamGoalsFor : rs.teamGoalsFor;
      const teamGoalsAgainst = row.hasTeamGoals ? row.teamGoalsAgainst : rs.teamGoalsAgainst;

      // Community benchmark: the "perfect 10" goals/assists targets are the
      // group's historical average of the top scorer's / top assister's evening
      // total (the club's מלך השערים, per מחזור), maintained on communityStats
      // by the evening-standings Cloud Function. Absent (new group / read failed) →
      // eveningScore falls back to its DEFAULT_*_FOR_10. Never blocks the card.
      const benchSnap = game?.groupId
        ? await getDoc(doc(db, 'communityStats', game.groupId)).catch(() => null)
        : null;
      const bench =
        benchSnap && benchSnap.exists()
          ? (benchSnap.data() as {
              kingGoalsSum?: number;
              kingGoalsCount?: number;
              kingAssistsSum?: number;
              kingAssistsCount?: number;
            })
          : null;
      const avgOrUndef = (sum?: number, count?: number) =>
        typeof sum === 'number' && typeof count === 'number' && count > 0
          ? sum / count
          : undefined;
      const goalsFor10 = avgOrUndef(bench?.kingGoalsSum, bench?.kingGoalsCount);
      const assistsFor10 = avgOrUndef(
        bench?.kingAssistsSum,
        bench?.kingAssistsCount,
      );

      // Score + adaptive narrative, from the full performance picture. Seed the
      // copy per (game, player) so it's varied across players yet stable for a
      // given game.
      const narrative: NarrativeStats = {
        goals: row.goals,
        assists: row.assists,
        wins: row.wins,
        losses: row.losses,
        gamesPlayed: row.rounds,
        totalRounds,
        heldPitch: rs.heldPitch,
        scoringStreak: rs.scoringStreak,
        bestMiniGame: rs.bestMiniGame,
        pen: row.hasPenaltyStats ? row.pen : rs.pen,
      };
      const seed = `${gameId}:${uid}`;
      // Prefer the score the SERVER stored. It is the one that ranked this
      // evening's players against each other, the one saved as the club's
      // lastEveningScore, and the one every other surface reads — so a card
      // showing a locally recomputed number put "מקום 12 מתוך 15" next to a
      // score that wasn't what produced that place. The local computation
      // stays as the fallback for evenings with no standing doc (and it also
      // folds in penalties, which the server's stats rows don't carry).
      const localScore = eveningScore({
        goals: row.goals,
        assists: row.assists,
        wins: row.wins,
        gamesPlayed: row.rounds,
        goalsFor10,
        assistsFor10,
        pen: narrative.pen,
      });
      const storedScore = numOrNull(stand?.score);
      const score = storedScore ?? localScore;
      // Title AFTER the score: it is gated on it, so a middling evening can't
      // be crowned by a stats rule that never looked at the result.
      const t = pickEveningTitle(narrative, seed, score);

      // A quick game has no club table to stand in. Its "community" is the
      // creator's hidden personal group, so the server ranked the player
      // against a table of one — every metric came back rank 1 / delta 0, and
      // the card cheerfully announced "שמרת על התואר מלך השערים" for a title
      // that had never existed, under "מקום 1 מתוך 1 בטבלת המועדון"
      // (Eliran's report). Drop the whole club-comparison block; the personal
      // stats and tonight's own ranking below it are still real.
      const clubRanked = game?.isOrphanContext !== true;

      const metrics = clubRanked ? readMetrics(stand?.metrics, row) : [];

      // ── "▲3" needs a table to have climbed in ────────────────────────
      // The club table is season-scoped: a season close zeroes goals, assists
      // and wins on every communityPlayerStats row, so on the first evening of
      // a season the server's "before" ordering is every player on 0 points,
      // ordered by `a.uid.localeCompare(b.uid)`. rankDelta is then the distance
      // between an alphabetical list and a real one — a green ▲ or a red ▼ of
      // arbitrary size for movement in a table that did not exist. The only
      // seasons club is sitting on exactly this: eveningsSealed 10 against
      // roundsAtStart 10, so its next sealed evening is evening 1 of a season.
      //
      // The combined table ranks on goals*2 + assists, so the player's own
      // "before" points are computable here from the two halves we now have.
      // Zero means there was no place to climb from — after a rollover that is
      // everybody, and for a first-ever evening it is the honest reading too:
      // the player was in a block of zeros whose internal order was uids. The
      // place itself ("מקום 4 מתוך 20") and the value-based overtake lines
      // ("עקפת את X") are unaffected — those are true either way.
      //
      // Costs a genuine newcomer their first-night ▲. That is the side to err
      // on: the chip is decoration, and a wrong one is a claim.
      //
      // A metric MISSING from the block is not the same as the block being
      // missing, and reading the two the same way had this guard leaning on
      // the server to do its job. The server omits a metric precisely when
      // nobody in the club had anything in that column before tonight
      // (`hadTable` in onGameRosterChanged) — the very condition this is
      // written for — so treating that as "unknown" let the arrow through and
      // left it standing only because `hadPointsTable` had already nulled
      // `rankDelta` on the same evidence. Belt and braces, and the braces are
      // in another file. An absent `metrics` map IS unknown: that is a standing
      // doc written before the server sent one, and its delta is all there is.
      const hasMetricsBlock = !!stand?.metrics && typeof stand.metrics === 'object';
      const before = (key: EveningMetric['key']) => {
        const m = metrics.find((x) => x.key === key);
        if (!m) return hasMetricsBlock ? 0 : null;
        if (m.tonight == null) return null;
        return m.value - m.tonight;
      };
      const beforeGoals = before('goals');
      const beforeAssists = before('assists');
      const beforePoints =
        beforeGoals == null || beforeAssists == null
          ? null // no metrics map at all (an old standing doc) — nothing to judge on
          : beforeGoals * 2 + beforeAssists;
      const movementReal = beforePoints == null || beforePoints > 0;

      const historyComplete = totalKnown && rs.playedRounds === row.rounds;
      const detailedHighlights = eveningHighlights(narrative, historyComplete);
      if (!historyComplete && row.hasPenaltyStats) {
        // Atomically committed penalty totals do not require a complete event log.
        const penaltyFacts = eveningHighlights(narrative, true).filter((h) => h.id === 'saved' || h.id === 'penalty');
        detailedHighlights.push(...penaltyFacts);
      }
      const exactTeamGoals = historyComplete && rounds.every((r) => Number.isFinite(r.scoreA) && Number.isFinite(r.scoreB))
        ? rounds.reduce((sum, r) => {
          const side = r.teamA?.includes(uid) ? 'A' : r.teamB?.includes(uid) ? 'B' : null;
          if (side) { sum.for += side === 'A' ? r.scoreA : r.scoreB; sum.against += side === 'A' ? r.scoreB : r.scoreA; }
          return sum;
        }, { for: 0, against: 0 }) : undefined;
      const outcomes = historyComplete ? [...rounds].sort((a, b) => a.at - b.at)
        .filter((r) => r.teamA?.includes(uid) || r.teamB?.includes(uid))
        .map((r): 'win' | 'loss' | 'draw' => {
          if (r.winnerSide === 'tie') return 'draw';
          const side = r.teamA?.includes(uid) ? 'A' : 'B';
          return r.winnerSide === side ? 'win' : 'loss';
        }) : undefined;

      return {
        gameId,
        uid,
        playerName: (name as string) || 'שחקן',
        dateLabel: formatDateLabel(game?.startsAt),
        communityName: game?.title || 'המשחק',
        rounds: row.rounds,
        totalRounds,
        totalKnown,
        wins: row.wins,
        losses: row.losses,
        winRate: decided > 0 ? Math.round((row.wins / decided) * 100) : 0,
        goals: row.goals,
        assists: row.assists,
        score,
        title: t.title,
        titleEmoji: t.emoji,
        insights: pickEveningInsights(narrative, seed),
        scoreDelta: numOrNull(stand?.scoreDelta),
        rank: clubRanked ? numOrNull(stand?.rank) : null,
        rankTotal: clubRanked ? numOrNull(stand?.rankTotal) : null,
        rankDelta: clubRanked && movementReal ? numOrNull(stand?.rankDelta) : null,
        scoreRank: numOrNull(stand?.scoreRank),
        scoreTotal: numOrNull(stand?.scoreTotal),
        metrics,
        heldPitch: rs.heldPitch,
        teamGoalsFor: row.hasTeamGoals ? teamGoalsFor : exactTeamGoals?.for ?? teamGoalsFor,
        teamGoalsAgainst: row.hasTeamGoals ? teamGoalsAgainst : exactTeamGoals?.against ?? teamGoalsAgainst,
        teamGoalsKnown: row.hasTeamGoals || exactTeamGoals != null,
        highlights: detailedHighlights,
        personalRecords: [],
        recordScope: clubRanked && game?.groupId && game.startsAt && eveningPlayState(game) === 'happened'
          ? { groupId: game.groupId, startsAt: game.startsAt } : undefined,
        penalties: row.hasPenaltyStats ? row.pen : historyComplete ? rs.pen : undefined,
        // Reject inconsistent history instead of presenting it as an exact sequence.
        outcomes: outcomes && outcomes.filter((o) => o === 'win').length === row.wins
          && outcomes.filter((o) => o === 'loss').length === row.losses ? outcomes : undefined,
      };
    } catch (err) {
      logError('getEveningSummary', err, { gameId, uid });
      return null;
    }
  },
  async getPersonalRecords(model: EveningSummaryModel): Promise<PersonalEveningRecord[]> {
    if (USE_MOCK_DATA) return model.personalRecords ?? [];
    if (!model.recordScope || model.rounds <= 0) return [];
    try {
      return await readPersonalEveningRecords(model.recordScope.groupId, model.uid, model.recordScope.startsAt, model);
    } catch (err) {
      logError('readPersonalEveningRecords', err, { gameId: model.gameId, uid: model.uid });
      return [];
    }
  },
};
