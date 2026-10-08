// Demo-mode data for the two-player screen.
//
// Hand-built for the same reason `mockClubChemistry` is: the mock club has no
// mini-game history for a pair record to have arisen from, and the point of
// the screen is what a pair with a season behind them looks like.
//
// The numbers here are DEMO numbers and nothing derives from them. They exist
// so the screen can be opened, read and screenshotted without a Firebase.
import { EMPTY_PAIR, type PairTotals } from '@/utils/clubChemistry';
import { mockPlayers } from '@/data/mockData';
import { mockGroup } from '@/data/mockUsers';
import { orientPair, winPct } from '@/utils/pairOrientation';
import type { ChampionshipRow } from '@/utils/championship';
import type {
  CompareRow,
  PairCompareInput,
  PairCompareModel,
  PairSide,
} from '@/services/pairCompareService';

const rowOf = (uid: string, o: Partial<ChampionshipRow>): ChampionshipRow => ({
  uid,
  goals: 0,
  assists: 0,
  rounds: 0,
  wins: 0,
  ties: 0,
  losses: 0,
  games: 0,
  penTaken: 0,
  penScored: 0,
  penFaced: 0,
  penSaved: 0,
  ownGoals: 0,
  cleanSheets: 0,
  ...o,
});

export function mockPairCompare(input: PairCompareInput): PairCompareModel {
  const { viewerId, otherId, groupId, scope } = input;
  const nameOf = (uid: string) =>
    mockPlayers.find((p) => p.id === uid)?.displayName ?? 'שחקן';
  // The mock roster carries a URL, not a built-in avatar id — the screen's
  // avatar falls back to the initial, which is the demo's own look.
  const photoOf = (uid: string) =>
    mockPlayers.find((p) => p.id === uid)?.avatarUrl;

  // A historical season is deliberately THINNER than the running one, so the
  // screenshot run can show that the scope actually changes the numbers.
  const past = scope.k === 'season';

  const rowA = rowOf(viewerId, {
    goals: past ? 11 : 42,
    assists: past ? 7 : 28,
    rounds: past ? 24 : 61,
    wins: past ? 13 : 35,
    ties: past ? 3 : 7,
    losses: past ? 8 : 19,
    games: past ? 9 : 26,
    penScored: past ? 1 : 4,
    penSaved: 0,
    cleanSheets: past ? 5 : 14,
  });
  const rowB = rowOf(otherId, {
    goals: past ? 8 : 28,
    assists: past ? 5 : 16,
    rounds: past ? 21 : 48,
    wins: past ? 9 : 24,
    ties: past ? 2 : 4,
    losses: past ? 10 : 20,
    games: past ? 7 : 18,
    penScored: 0,
    penSaved: past ? 1 : 3,
    cleanSheets: past ? 3 : 9,
  });

  const totals: PairTotals = {
    ...EMPTY_PAIR,
    sameTeam: past ? 9 : 26,
    winsTogether: past ? 5 : 15,
    lossesTogether: past ? 3 : 9,
    cleanSheetsTogether: past ? 2 : 7,
    against: past ? 7 : 19,
    // Stored by sorted uid; `orientPair` turns them round, exactly as in
    // production — so the demo exercises the mapping rather than bypassing it.
    winsA: past ? 4 : 11,
    winsB: past ? 2 : 7,
    assistsAToB: past ? 2 : 6,
    assistsBToA: past ? 1 : 3,
  };
  const pair = orientPair(viewerId, otherId, totals);

  const side = (uid: string, r: ChampionshipRow): PairSide => ({
    uid,
    name: nameOf(uid),
    avatarId: undefined,
    photoUrl: photoOf(uid),
    played: true,
    row: r,
  });

  const mk = (
    key: string,
    label: string,
    a: number | null,
    b: number | null,
    format: CompareRow['format'],
    unscored = false,
  ): CompareRow => ({
    key,
    label,
    a,
    b,
    format,
    winner:
      unscored || a === null || b === null || a === b ? 'tie' : (key === 'losses' ? a < b : a > b) ? 'a' : 'b',
    unscored,
  });
  const gpg = (r: ChampionshipRow) =>
    r.games > 0 ? Math.round((r.goals / r.games) * 10) / 10 : 0;

  const comparison: CompareRow[] = [
    mk('goals', 'גולים', rowA.goals, rowB.goals, 'int'),
    mk('assists', 'בישולים', rowA.assists, rowB.assists, 'int'),
    mk('wins', 'ניצחונות', rowA.wins, rowB.wins, 'int'),
    mk('losses', 'הפסדים', rowA.losses, rowB.losses, 'int'),
    mk('winPct', 'אחוז ניצחון', winPct(rowA.wins, rowA.losses), winPct(rowB.wins, rowB.losses), 'pct'),
    mk('rounds', 'משחקונים', rowA.rounds, rowB.rounds, 'int'),
    mk('games', 'מחזורים', rowA.games, rowB.games, 'int'),
    mk('gpg', 'ממוצע גולים למחזור', gpg(rowA), gpg(rowB), 'avg1'),
    mk('cleanSheets', 'שערים נקיים', rowA.cleanSheets, rowB.cleanSheets, 'int'),
    mk('penScored', 'פנדלים שהוכנסו', rowA.penScored, rowB.penScored, 'int'),
    mk('penSaved', 'פנדלים שנעצרו', rowA.penSaved, rowB.penSaved, 'int'),
  ];
  const scored = comparison.filter((r) => !r.unscored);
  const aLeads = scored.filter((r) => r.winner === 'a').length;
  const bLeads = scored.filter((r) => r.winner === 'b').length;

  return {
    club: { id: groupId, name: mockGroup.name },
    a: side(viewerId, rowA),
    b: side(otherId, rowB),
    pair,
    pairKnown: true,
    together: {
      winPct: winPct(pair.winsTogether, pair.lossesTogether),
      cleanSheetPct:
        pair.roundsTogether > 0
          ? Math.round((pair.cleanSheetsTogether / pair.roundsTogether) * 100)
          : null,
      assistsTotal: pair.assistsViewerToOther + pair.assistsOtherToViewer,
    },
    h2h: {
      winPctViewer: winPct(pair.winsViewer, pair.winsOther),
      winPctOther: winPct(pair.winsOther, pair.winsViewer),
      leader:
        pair.winsViewer > pair.winsOther
          ? 'a'
          : pair.winsOther > pair.winsViewer
            ? 'b'
            : 'tie',
    },
    comparison,
    verdict: {
      leader: aLeads > bLeads ? 'a' : bLeads > aLeads ? 'b' : 'tie',
      aLeads,
      bLeads,
      total: scored.length,
    },
    rankA: past ? 3 : 1,
    rankB: past ? 6 : 5,
    rankTotal: past ? 14 : 29,
    // A fixed demo date: the note it feeds is part of what the screen has to
    // show, and a `Date.now()`-relative one would move between screenshots.
    chemistrySince: past ? null : Date.UTC(2026, 6, 15),
  };
}
