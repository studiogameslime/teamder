/**
 * The club's story of one evening.
 *
 * Most of these cases exist because the summary makes CLAIMS — "a club record",
 * "the first time ever", "the pair of the evening" — and a claim that turns out
 * to be an artefact of thin history or double counting is worse than no summary
 * at all. So the tests lean on the boundaries: no baseline, equal-not-better,
 * ties everywhere, and the two data sources that disagree after a correction.
 */
import {
  buildRoundSummary,
  selectEvents,
  nextRecordBaseline,
  MIN_RECORD_BASIS,
  type PlayerEvening,
  type RoundRec,
  type RoundSummaryInput,
  type SummaryEvent,
} from '@/utils/roundSummary';

const P = (userId: string, o: Partial<PlayerEvening> = {}): PlayerEvening => ({
  userId,
  goals: 0,
  assists: 0,
  wins: 0,
  cleanSheets: 0,
  rounds: 0,
  ...o,
});

const R = (o: Partial<RoundRec> = {}): RoundRec => ({
  teamAIndex: 0,
  teamBIndex: 1,
  winnerSide: 'A',
  goals: [],
  shootout: false,
  ...o,
});

const goal = (scorerId: string | null, assisterId: string | null = null, ownGoal = false) => ({
  scorerId,
  assisterId,
  ownGoal,
  team: 'A' as const,
});

function input(o: Partial<RoundSummaryInput> = {}): RoundSummaryInput {
  return {
    gameId: 'g1',
    groupId: 'c1',
    at: 1_700_000_000_000,
    players: [],
    rounds: [],
    career: [],
    club: { goals: 0, assists: 0, rounds: 0, cleanSheets: 0, shootoutRounds: 0, evenings: 0 },
    records: null,
    personalBests: {},
    standings: [],
    basis: { since: 1, eveningsCompared: 10 },
    now: 1_700_000_100_000,
    ...o,
  };
}

// ─── 1. the four numbers ──────────────────────────────────────────────────

describe('the evening in numbers', () => {
  it('counts mini-games as documents, not as player-appearances', () => {
    // Ten players each played 3 mini-games. There were 3 mini-games, not 30 —
    // summing the players' `rounds` is the obvious wrong answer.
    const players = Array.from({ length: 10 }, (_, i) => P(`u${i}`, { rounds: 3 }));
    const s = buildRoundSummary(input({ players, rounds: [R(), R(), R()] })).stats;
    expect(s.rounds).toBe(3);
  });

  it('takes goals and assists from the player rows, which a correction reaches', () => {
    // A goal completed after the fact lands on the player row and never on the
    // mini-game history, so the two sources disagree by exactly that goal.
    const s = buildRoundSummary(
      input({
        players: [P('a', { goals: 3, assists: 1 }), P('b', { goals: 1, assists: 2 })],
        rounds: [R({ goals: [goal('a'), goal('b', 'a')] })],
      }),
    ).stats;
    expect(s.goals).toBe(4);
    expect(s.assists).toBe(3);
  });

  it('adds own goals once — they are on the scoreboard and on nobody’s tally', () => {
    const s = buildRoundSummary(
      input({
        players: [P('a', { goals: 2 })],
        rounds: [R({ goals: [goal('a'), goal('a'), goal(null, null, true)] })],
      }),
    ).stats;
    expect(s.goals).toBe(3);
  });

  it('counts shootouts as decided mini-games, not as kicks', () => {
    const s = buildRoundSummary(
      input({ rounds: [R({ shootout: true }), R(), R({ shootout: true })] }),
    ).stats;
    expect(s.shootouts).toBe(2);
  });
});

// ─── 2. stars ─────────────────────────────────────────────────────────────

describe('stars of the evening', () => {
  it('crowns everyone tied at the top', () => {
    const l = buildRoundSummary(
      input({ players: [P('a', { goals: 5 }), P('b', { goals: 5 }), P('c', { goals: 2 }) ] }),
    ).leaders.topScorers;
    expect(l).toEqual({ userIds: ['a', 'b'], value: 5 });
  });

  it('crowns nobody when the metric never happened', () => {
    const l = buildRoundSummary(input({ players: [P('a', { goals: 3 })] })).leaders;
    expect(l.topAssisters).toBeNull();
    expect(l.topCleanSheets).toBeNull();
  });

  it('leaves guests out of the titles but keeps their goals in the total', () => {
    const s = buildRoundSummary(
      input({
        players: [P('guest:1', { goals: 9, isGuest: true }), P('a', { goals: 2 })],
      }),
    );
    expect(s.leaders.topScorers).toEqual({ userIds: ['a'], value: 2 });
    expect(s.stats.goals).toBe(11);
  });

  it('scores involvement as goals plus assists', () => {
    const l = buildRoundSummary(
      input({
        players: [P('a', { goals: 4, assists: 0 }), P('b', { goals: 2, assists: 3 })],
      }),
    ).leaders.topGoalInvolvement;
    expect(l).toEqual({ userIds: ['b'], value: 5 });
  });
});

// ─── 3. records ───────────────────────────────────────────────────────────

describe('records', () => {
  const withBasis = (o: Partial<RoundSummaryInput>) => input({ ...o });

  it('says nothing at all when the history is too thin to compare against', () => {
    const s = buildRoundSummary(
      withBasis({
        players: [P('a', { goals: 9 })],
        records: { goals: { value: 2, userIds: ['b'] } },
        basis: { since: 1, eveningsCompared: MIN_RECORD_BASIS - 1 },
      }),
    );
    expect(s.events).toHaveLength(0);
  });

  it('calls beating it a new record, with what it beat', () => {
    const e = buildRoundSummary(
      withBasis({ players: [P('a', { goals: 6 })], records: { goals: { value: 5, userIds: ['b'] } } }),
    ).events.find((x) => x.type === 'club_record');
    expect(e).toMatchObject({ metric: 'goals', userIds: ['a'], value: 6, previousValue: 5, tied: false });
  });

  it('calls equalling it equalling — never a new record', () => {
    const e = buildRoundSummary(
      withBasis({ players: [P('a', { goals: 5 })], records: { goals: { value: 5, userIds: ['b'] } } }),
    ).events.find((x) => x.type === 'club_record');
    expect(e).toMatchObject({ userIds: ['a'], value: 5, previousValue: 5, tied: true });
  });

  it('does not tell the holder he equalled himself', () => {
    const e = buildRoundSummary(
      withBasis({ players: [P('a', { goals: 5 })], records: { goals: { value: 5, userIds: ['a'] } } }),
    ).events.find((x) => x.type === 'club_record');
    expect(e).toBeUndefined();
  });

  it('claims no personal record without a personal baseline', () => {
    // A player's first measured evening is not their best evening — it is their
    // only one.
    const s = buildRoundSummary(withBasis({ players: [P('a', { goals: 7 })], personalBests: {} }));
    expect(s.events.some((e) => e.type === 'personal_record')).toBe(false);
  });

  it('reports a personal best against the player’s own previous best', () => {
    const e = buildRoundSummary(
      withBasis({ players: [P('a', { assists: 4 })], personalBests: { a: { assists: 2 } } }),
    ).events.find((x) => x.type === 'personal_record');
    expect(e).toMatchObject({ metric: 'assists', userIds: ['a'], value: 4, previousValue: 2, tied: false });
  });

  it('drops the personal record when the same player set the club record for it', () => {
    const events = buildRoundSummary(
      withBasis({
        players: [P('a', { goals: 6 })],
        records: { goals: { value: 5, userIds: ['b'] } },
        personalBests: { a: { goals: 4 } },
      }),
    ).events;
    expect(events.filter((e) => e.type === 'club_record')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'personal_record' && e.metric === 'goals')).toHaveLength(0);
  });
});

// ─── 4. milestones ────────────────────────────────────────────────────────

describe('milestones', () => {
  it('fires on the evening the total is crossed, not after', () => {
    const e = buildRoundSummary(
      input({
        players: [P('a', { goals: 3 })],
        career: [{ userId: 'a', goals: 51, assists: 0, rounds: 0, wins: 0, cleanSheets: 0, games: 1 }],
      }),
    ).events.find((x) => x.type === 'player_milestone' && x.metric === 'goals');
    expect(e).toMatchObject({ threshold: 50, total: 51 });
  });

  it('does not re-fire for someone who was already past it', () => {
    const s = buildRoundSummary(
      input({
        players: [P('a', { goals: 1 })],
        career: [{ userId: 'a', goals: 80, assists: 0, rounds: 0, wins: 0, cleanSheets: 0, games: 1 }],
      }),
    );
    expect(s.events.some((e) => e.type === 'player_milestone' && e.metric === 'goals')).toBe(false);
  });

  it('groups everyone who crossed the same mark into one line', () => {
    const e = buildRoundSummary(
      input({
        players: [P('a', { goals: 2 }), P('b', { goals: 2 })],
        career: [
          { userId: 'a', goals: 10, assists: 0, rounds: 0, wins: 0, cleanSheets: 0, games: 1 },
          { userId: 'b', goals: 11, assists: 0, rounds: 0, wins: 0, cleanSheets: 0, games: 1 },
        ],
      }),
    ).events.find((x) => x.type === 'player_milestone');
    expect(e).toMatchObject({ threshold: 10, userIds: ['a', 'b'] });
  });

  it('counts an evening attended as exactly one towards the evenings mark', () => {
    const e = buildRoundSummary(
      input({
        players: [P('a', { rounds: 4 })],
        career: [{ userId: 'a', goals: 0, assists: 0, rounds: 0, wins: 0, cleanSheets: 0, games: 25 }],
      }),
    ).events.find((x) => x.type === 'player_milestone' && x.metric === 'evenings');
    expect(e).toMatchObject({ threshold: 25, total: 25 });
  });

  it('recognises a club milestone reached tonight', () => {
    const e = buildRoundSummary(
      input({
        players: [P('a', { goals: 4 })],
        rounds: [R()],
        club: { goals: 252, assists: 0, rounds: 0, cleanSheets: 0, shootoutRounds: 0, evenings: 0 },
      }),
    ).events.find((x) => x.type === 'club_milestone');
    expect(e).toMatchObject({ metric: 'goals', threshold: 250, total: 252 });
  });
});

// ─── 5. table movement ────────────────────────────────────────────────────

describe('table movement', () => {
  const table = (rows: Array<[string, number, number, number]>) =>
    rows.map(([userId, rank, rankDelta, score]) => ({
      userId,
      rank,
      rankDelta,
      score,
      rankTotal: rows.length,
    }));

  it('ignores a table too small for a position to mean anything', () => {
    const s = buildRoundSummary(
      input({ standings: table([['a', 1, 2, 90], ['b', 2, -1, 80]]) }),
    );
    expect(s.events.filter((e) => e.type.startsWith('rank_'))).toHaveLength(0);
  });

  it('invents nothing on the FIRST evening of a season', () => {
    // rankDelta is derived by subtracting tonight from the cumulative rows, so
    // after a season closes every "before" value is zero, the previous
    // ordering is alphabetical by uid, and a table that did not exist produces
    // a dozen dramatic climbs. The club's all-time counter cannot see the
    // boundary; the season's own count can.
    const rows = table([['a', 1, 5, 90], ['b', 2, 3, 80], ['c', 3, 2, 70], ['d', 4, 1, 60], ['e', 5, 4, 50], ['f', 6, 2, 40]]);
    const s = buildRoundSummary(input({ standings: rows, seasonEvenings: 1 }));
    expect(s.events.filter((e) => e.type.startsWith('rank_'))).toHaveLength(0);
  });

  it('but reports movement from the second evening on', () => {
    const rows = table([['a', 1, 5, 90], ['b', 2, 3, 80], ['c', 3, 2, 70], ['d', 4, 1, 60], ['e', 5, 4, 50], ['f', 6, 2, 40]]);
    const s = buildRoundSummary(input({ standings: rows, seasonEvenings: 2 }));
    expect(s.events.some((e) => e.type.startsWith('rank_'))).toBe(true);
  });

  it('and a club with no seasons is untouched', () => {
    const rows = table([['a', 1, 5, 90], ['b', 2, 3, 80], ['c', 3, 2, 70], ['d', 4, 1, 60], ['e', 5, 4, 50], ['f', 6, 2, 40]]);
    const s = buildRoundSummary(input({ standings: rows }));
    expect(s.events.some((e) => e.type.startsWith('rank_'))).toBe(true);
  });

  it('reports a new leader only when someone climbed into first', () => {
    const rows = table([['a', 1, 3, 90], ['b', 2, 0, 80], ['c', 3, 0, 70], ['d', 4, 0, 60], ['e', 5, 0, 50], ['f', 6, 0, 40]]);
    const e = buildRoundSummary(input({ standings: rows })).events.find((x) => x.type === 'rank_first_place');
    expect(e).toMatchObject({ userIds: ['a'] });
  });

  it('says nothing when the leader simply stayed', () => {
    const rows = table([['a', 1, 0, 90], ['b', 2, 0, 80], ['c', 3, 0, 70], ['d', 4, 0, 60], ['e', 5, 0, 50], ['f', 6, 0, 40]]);
    const s = buildRoundSummary(input({ standings: rows }));
    expect(s.events.some((e) => e.type === 'rank_first_place')).toBe(false);
  });

  it('never names anyone for falling', () => {
    const rows = table([['a', 1, 0, 90], ['b', 2, 0, 80], ['c', 3, 0, 70], ['d', 4, 0, 60], ['e', 5, 0, 50], ['f', 6, -9, 40]]);
    const s = buildRoundSummary(input({ standings: rows }));
    const named = s.events.flatMap((e) => ('userIds' in e ? e.userIds : []));
    expect(named).not.toContain('f');
  });

  it('reports a tight race at the top and not a comfortable one', () => {
    const close = table([['a', 1, 0, 82], ['b', 2, 0, 81], ['c', 3, 0, 80.5], ['d', 4, 0, 60], ['e', 5, 0, 50], ['f', 6, 0, 40]]);
    const clear = table([['a', 1, 0, 92], ['b', 2, 0, 71], ['c', 3, 0, 60], ['d', 4, 0, 55], ['e', 5, 0, 50], ['f', 6, 0, 40]]);
    expect(buildRoundSummary(input({ standings: close })).events.some((e) => e.type === 'rank_tight_top')).toBe(true);
    expect(buildRoundSummary(input({ standings: clear })).events.some((e) => e.type === 'rank_tight_top')).toBe(false);
  });
});

// ─── 6. teams ─────────────────────────────────────────────────────────────

describe('teams of the evening', () => {
  it('counts by bib colour, which is the only identity a team keeps all night', () => {
    const t = buildRoundSummary(
      input({
        rounds: [
          R({ teamAIndex: 1, teamBIndex: 0, winnerSide: 'A' }),
          R({ teamAIndex: 1, teamBIndex: 2, winnerSide: 'A' }),
          R({ teamAIndex: 1, teamBIndex: 0, winnerSide: 'B' }),
        ],
      }),
    ).teamHighlights;
    expect(t.best).toEqual([{ colourIndex: 1, wins: 2, losses: 1, played: 3 }]);
  });

  it('shows a tie as a tie rather than picking a winner', () => {
    const t = buildRoundSummary(
      input({
        rounds: [
          R({ teamAIndex: 0, teamBIndex: 1, winnerSide: 'A' }),
          R({ teamAIndex: 1, teamBIndex: 0, winnerSide: 'A' }),
        ],
      }),
    ).teamHighlights;
    expect(t.best.map((x) => x.colourIndex).sort()).toEqual([0, 1]);
  });

  it('skips a mini-game whose colours were never recorded', () => {
    const t = buildRoundSummary(
      input({ rounds: [R({ teamAIndex: -1, teamBIndex: -1 }), R({ teamAIndex: 0, teamBIndex: 1 })] }),
    ).teamHighlights;
    expect(t.best).toEqual([{ colourIndex: 0, wins: 1, losses: 0, played: 1 }]);
  });

  it('leaves a drawn mini-game out of both columns', () => {
    const t = buildRoundSummary(
      input({ rounds: [R({ winnerSide: 'tie' })] }),
    ).teamHighlights;
    expect(t.best).toEqual([]);
    expect(t.worst).toEqual([]);
  });
});

// ─── 7. the pair ──────────────────────────────────────────────────────────

describe('the pair of the evening', () => {
  it('sums direct assists in both directions', () => {
    const p = buildRoundSummary(
      input({
        rounds: [
          R({ goals: [goal('b', 'a'), goal('b', 'a'), goal('a', 'b')] }),
        ],
      }),
    ).pairHighlight;
    expect(p).toMatchObject({ userIds: ['a', 'b'], goals: 3 });
    expect(p?.breakdown).toEqual(
      expect.arrayContaining([
        { assisterId: 'a', scorerId: 'b', goals: 2 },
        { assisterId: 'b', scorerId: 'a', goals: 1 },
      ]),
    );
  });

  it('calls a single pass a pass, not a partnership', () => {
    const p = buildRoundSummary(input({ rounds: [R({ goals: [goal('b', 'a')] })] })).pairHighlight;
    expect(p).toBeNull();
  });

  it('ignores unassisted and own goals', () => {
    const p = buildRoundSummary(
      input({ rounds: [R({ goals: [goal('a'), goal('b'), goal(null, null, true)] })] }),
    ).pairHighlight;
    expect(p).toBeNull();
  });

  it('never builds a pair out of shared victories', () => {
    // Two players on the same winning side, all night, with no assist between
    // them: a shared result is not a connection.
    const p = buildRoundSummary(
      input({
        players: [P('a', { wins: 6 }), P('b', { wins: 6 })],
        rounds: [R({ goals: [goal('a'), goal('a')] }), R({ goals: [goal('b')] })],
      }),
    ).pairHighlight;
    expect(p).toBeNull();
  });
});

// ─── 8. first ever ────────────────────────────────────────────────────────

describe('first ever', () => {
  const base = { players: [P('a', { goals: 4 }), P('b', { goals: 4 })] };

  it('fires once', () => {
    const s = buildRoundSummary(input(base));
    expect(s.events.some((e) => e.type === 'first_ever' && e.code === 'two_players_4_goals')).toBe(true);
  });

  it('stays quiet forever after, because the ledger remembers it', () => {
    const s = buildRoundSummary(
      input({ ...base, records: { firstEverSeen: ['two_players_4_goals'] } }),
    );
    expect(s.events.some((e) => e.type === 'first_ever')).toBe(false);
  });

  it('is suppressed entirely while the history is thin', () => {
    const s = buildRoundSummary(
      input({ ...base, basis: { since: 1, eveningsCompared: 2 } }),
    );
    expect(s.events.some((e) => e.type === 'first_ever')).toBe(false);
  });

  it('notices an evening of three shootouts', () => {
    const s = buildRoundSummary(
      input({ rounds: [R({ shootout: true }), R({ shootout: true }), R({ shootout: true })] }),
    );
    expect(s.events.some((e) => e.type === 'first_ever' && e.code === 'three_shootouts')).toBe(true);
  });
});

// ─── 9. selection ─────────────────────────────────────────────────────────

describe('choosing what makes the cut', () => {
  const ev = (type: SummaryEvent['type'], userIds: string[] = ['x']): SummaryEvent =>
    ({ type, userIds, metric: 'goals', value: 5, previousValue: 4, tied: false, threshold: 10, total: 10, from: 5, to: 1, rank: 1, tier: 3, code: 'every_team_won', entries: [] }) as unknown as SummaryEvent;

  it('puts a club record above everything else', () => {
    const out = selectEvents([ev('rank_jump'), ev('player_milestone'), ev('club_record')]);
    expect(out[0].type).toBe('club_record');
  });

  it('keeps the summary short', () => {
    const many = Array.from({ length: 30 }, (_, i) => ev('player_milestone', [`u${i}`]));
    expect(selectEvents(many).length).toBeLessThanOrEqual(6);
  });

  it('will not let one player fill the summary', () => {
    const hogging = [
      ev('club_record', ['a']),
      ev('club_milestone', ['a']),
      ev('personal_record', ['a']),
      ev('player_milestone', ['a']),
      ev('rank_jump', ['a']),
    ];
    const out = selectEvents(hogging);
    const mine = out.filter((e) => 'userIds' in e && e.userIds.includes('a'));
    expect(mine.length).toBeLessThanOrEqual(2);
  });

  it('will not let one kind of event fill it either', () => {
    const out = selectEvents(Array.from({ length: 5 }, (_, i) => ev('player_milestone', [`u${i}`])));
    expect(out).toHaveLength(2);
  });
});

// ─── 10. sealing ──────────────────────────────────────────────────────────

describe('the record baseline after the evening', () => {
  it('raises a record and names the new holder', () => {
    const players = [P('a', { goals: 6 })];
    const s = buildRoundSummary(input({ players, records: { goals: { value: 5, userIds: ['b'] } } }));
    const next = nextRecordBaseline({ goals: { value: 5, userIds: ['b'] } }, s, players);
    expect(next.goals).toEqual({ value: 6, userIds: ['a'] });
  });

  it('adds a joint holder rather than replacing one', () => {
    const players = [P('a', { goals: 5 })];
    const s = buildRoundSummary(input({ players, records: { goals: { value: 5, userIds: ['b'] } } }));
    const next = nextRecordBaseline({ goals: { value: 5, userIds: ['b'] } }, s, players);
    expect(next.goals).toEqual({ value: 5, userIds: ['a', 'b'] });
  });

  it('remembers every first-ever it announced, so it never announces it twice', () => {
    const players = [P('a', { goals: 4 }), P('b', { goals: 4 })];
    const s = buildRoundSummary(input({ players }));
    const next = nextRecordBaseline(null, s, players);
    expect(next.firstEverSeen).toContain('two_players_4_goals');
    const again = buildRoundSummary(input({ players, records: next }));
    expect(again.events.some((e) => e.type === 'first_ever')).toBe(false);
  });

  it('does not credit a guest with a club record', () => {
    const players = [P('guest:9', { goals: 12, isGuest: true }), P('a', { goals: 2 })];
    const s = buildRoundSummary(input({ players }));
    const next = nextRecordBaseline(null, s, players);
    expect(next.goals).toEqual({ value: 2, userIds: ['a'] });
  });
});

describe('a round whose colours were never recorded', () => {
  it('is skipped, not counted under a phantom team', () => {
    // `undefined < 0` is false, so a missing index used to slip past the guard
    // and every such round piled onto one key — producing a team that had
    // played more games than the evening contained.
    const noColours = { ...R(), teamAIndex: undefined, teamBIndex: undefined } as unknown as RoundRec;
    const t = buildRoundSummary(
      input({ rounds: [noColours, R({ teamAIndex: 0, teamBIndex: 1 })] }),
    ).teamHighlights;
    expect(t.best).toEqual([{ colourIndex: 0, wins: 1, losses: 0, played: 1 }]);
  });

  it('never reports a team as having played more games than there were', () => {
    const rounds = [R(), R({ teamAIndex: 2, teamBIndex: 1 }), R({ teamAIndex: 2, teamBIndex: 0 })];
    const s = buildRoundSummary(input({ rounds }));
    for (const line of [...s.teamHighlights.best, ...s.teamHighlights.worst]) {
      expect(line.played).toBeLessThanOrEqual(rounds.length);
    }
  });
});
