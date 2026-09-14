/**
 * One player's season.
 *
 * The numbers are the easy half. The half that can be wrong while still
 * looking right is DIRECTION: a pair document is stored once under a sorted
 * key, so whether I am `a` or `b` is an accident of my user id, and reading
 * `winsA` as "my wins" is correct for exactly half the club. Get it backwards
 * and the summary still renders — it just tells me I dominated the player who
 * has been beating me all season.
 *
 * So most of these cases run the SAME season from both sides and demand the
 * mirror image.
 */
import {
  buildPersonalSeason,
  type SeasonPairRow,
  type SeasonPlayerRow,
} from '@/utils/seasonPersonal';

const player = (
  userId: string,
  over: Partial<SeasonPlayerRow> = {},
): SeasonPlayerRow => ({ userId, rounds: 10, ...over });

const pair = (a: string, b: string, over: Partial<SeasonPairRow> = {}): SeasonPairRow => ({
  a,
  b,
  ...over,
});

describe('my own numbers', () => {
  it('reads them off my row and derives the rates', () => {
    const s = buildPersonalSeason({
      me: 'me',
      players: [player('me', { goals: 9, assists: 6, rounds: 20, wins: 12, losses: 6, ties: 2, cleanSheets: 5, csRounds: 20 })],
      pairs: [],
    });
    expect(s.goals).toBe(9);
    expect(s.assists).toBe(6);
    expect(s.contributions).toBe(15);
    expect(s.goalsPerRound).toBeCloseTo(0.45);
    expect(s.cleanSheetPct).toBeCloseTo(0.25);
  });

  it('win % counts DECIDED rounds — a tie is not a loss', () => {
    const s = buildPersonalSeason({
      me: 'me',
      players: [player('me', { rounds: 10, wins: 6, losses: 2, ties: 2 })],
      pairs: [],
    });
    // 6 of 8 decided, not 6 of 10.
    expect(s.winPct).toBeCloseTo(0.75);
  });

  it('clean-sheet % divides by its OWN denominator, not by rounds', () => {
    // The metric started being collected late: 30 rounds played, 10 measured.
    const s = buildPersonalSeason({
      me: 'me',
      players: [player('me', { rounds: 30, cleanSheets: 5, csRounds: 10 })],
      pairs: [],
    });
    expect(s.cleanSheetPct).toBeCloseTo(0.5);
  });

  it('a rate with no denominator is unknown, not zero', () => {
    const s = buildPersonalSeason({
      me: 'me',
      players: [player('me', { rounds: 0, wins: 0, losses: 0 })],
      pairs: [],
    });
    expect(s.winPct).toBeNull();
    expect(s.goalsPerRound).toBeNull();
    expect(s.hasData).toBe(false);
  });

  it('a player with no row at all does not throw', () => {
    const s = buildPersonalSeason({ me: 'ghost', players: [player('me')], pairs: [] });
    expect(s.hasData).toBe(false);
    expect(s.goals).toBe(0);
    expect(s.partner).toBeNull();
  });
});

describe('where I stand in the club', () => {
  const players = [
    player('me', { goals: 5, assists: 1, wins: 4 }),
    player('x', { goals: 9, assists: 0, wins: 7 }),
    player('y', { goals: 5, assists: 3, wins: 4 }),
    player('z', { goals: 1, assists: 8, wins: 2 }),
  ];

  it('ranks me, and ties share the better position', () => {
    const s = buildPersonalSeason({ me: 'me', players, pairs: [] });
    // x is ahead on goals; y is level, so we are both 2nd.
    expect(s.ranks.goals).toBe(2);
    expect(s.ranks.wins).toBe(2);
    // Assists: z has 8 and y has 3, both ahead; x has 0, behind. So third.
    expect(s.ranks.assists).toBe(3);
  });

  it('counts only players who actually played this season', () => {
    const s = buildPersonalSeason({
      me: 'me',
      players: [...players, player('dormant', { rounds: 0, goals: 0 })],
      pairs: [],
    });
    // The club may have five members; four turned up.
    expect(s.ranks.of).toBe(4);
  });
});

describe('the people — read from MY side of the pair', () => {
  // One season, told twice. 'aaa' sorts before 'zzz', so in the stored row
  // aaa is `a` and zzz is `b`; every asymmetric field has to flip.
  const rows: SeasonPairRow[] = [
    pair('aaa', 'zzz', { sameTeam: 9, against: 4, winsA: 3, winsB: 1, assistsAToB: 5, assistsBToA: 2, winsTogether: 6 }),
  ];

  it('as the FIRST player in the row', () => {
    const s = buildPersonalSeason({ me: 'aaa', players: [player('aaa')], pairs: rows });
    expect(s.partner?.userId).toBe('zzz');
    expect(s.victim?.userId).toBe('zzz');
    expect(s.victim?.count).toBe(3);
    expect(s.tormentor?.count).toBe(1);
    expect(s.assistedMost?.count).toBe(5);
    expect(s.assistedBy?.count).toBe(2);
  });

  it('as the SECOND player — the mirror image, not a copy', () => {
    const s = buildPersonalSeason({ me: 'zzz', players: [player('zzz')], pairs: rows });
    expect(s.partner?.userId).toBe('aaa');
    // zzz won 1 and lost 3: the roles are swapped.
    expect(s.victim?.count).toBe(1);
    expect(s.tormentor?.count).toBe(3);
    expect(s.assistedMost?.count).toBe(2);
    expect(s.assistedBy?.count).toBe(5);
  });
});

describe('picking the right person', () => {
  it('the teammate is the one I played BESIDE most, not the one I faced most', () => {
    const s = buildPersonalSeason({
      me: 'me',
      players: [player('me')],
      pairs: [
        pair('me', 'beside', { sameTeam: 12, against: 1 }),
        pair('me', 'facing', { sameTeam: 2, against: 20 }),
      ],
    });
    expect(s.partner?.userId).toBe('beside');
    expect(s.nemesis?.userId).toBe('facing');
  });

  it('the one I beat most and the one who beat me most can be different people', () => {
    const s = buildPersonalSeason({
      me: 'me',
      players: [player('me')],
      pairs: [
        pair('me', 'easy', { against: 8, winsA: 7, winsB: 1 }),
        pair('me', 'hard', { against: 9, winsA: 2, winsB: 6 }),
      ],
    });
    expect(s.victim?.userId).toBe('easy');
    expect(s.tormentor?.userId).toBe('hard');
  });

  it('a peer I never actually did the thing with is not offered', () => {
    const s = buildPersonalSeason({
      me: 'me',
      players: [player('me')],
      pairs: [pair('me', 'other', { sameTeam: 4, against: 0, winsA: 0, winsB: 0 })],
    });
    expect(s.partner?.userId).toBe('other');
    // Never faced them, never beat them — those lines simply have no answer.
    expect(s.nemesis).toBeNull();
    expect(s.victim).toBeNull();
    expect(s.tormentor).toBeNull();
  });

  it('a tie is broken the same way every time, not by document order', () => {
    const rows = [
      pair('me', 'bbb', { sameTeam: 5, winsTogether: 2 }),
      pair('aaa', 'me', { sameTeam: 5, winsTogether: 2 }),
    ];
    const first = buildPersonalSeason({ me: 'me', players: [player('me')], pairs: rows });
    const again = buildPersonalSeason({ me: 'me', players: [player('me')], pairs: [...rows].reverse() });
    expect(first.partner?.userId).toBe(again.partner?.userId);
    expect(first.partner?.userId).toBe('aaa');
  });

  it('a level tie on games together goes to the one I kept winning with', () => {
    const s = buildPersonalSeason({
      me: 'me',
      players: [player('me')],
      pairs: [
        pair('me', 'lucky', { sameTeam: 6, winsTogether: 5 }),
        pair('me', 'unlucky', { sameTeam: 6, winsTogether: 1 }),
      ],
    });
    expect(s.partner?.userId).toBe('lucky');
  });
});

describe('who is left out', () => {
  it('guests never become my best teammate — they are a different person each week', () => {
    const s = buildPersonalSeason({
      me: 'me',
      players: [player('me')],
      pairs: [
        pair('guest:x', 'me', { sameTeam: 30 }),
        pair('me', 'real', { sameTeam: 3 }),
      ],
    });
    expect(s.partner?.userId).toBe('real');
  });

  it('rows about other people are ignored, so the caller may pass the whole club', () => {
    const s = buildPersonalSeason({
      me: 'me',
      players: [player('me')],
      pairs: [
        pair('someone', 'else', { sameTeam: 99 }),
        pair('me', 'mine', { sameTeam: 2 }),
      ],
    });
    expect(s.partner?.userId).toBe('mine');
  });

  it('a malformed self-pair does not make me my own best teammate', () => {
    const s = buildPersonalSeason({
      me: 'me',
      players: [player('me')],
      pairs: [pair('me', 'me', { sameTeam: 50 })],
    });
    expect(s.partner).toBeNull();
  });

  it('no pairs at all is an ordinary season, not an error', () => {
    const s = buildPersonalSeason({ me: 'me', players: [player('me', { goals: 2 })], pairs: [] });
    expect(s.goals).toBe(2);
    expect(s.partner).toBeNull();
    expect(s.nemesis).toBeNull();
  });
});

describe('the two kinds of "wins" are not interchangeable', () => {
  // The teammate line reads "N mini-games together, you won M of them". M is
  // winsTogether. Reaching for myWins there produces a sentence that is true
  // about the wrong relationship — it counts the games we spent on OPPOSITE
  // sides. Caught on the emulator, where the card claimed 11 and the answer
  // was 15.
  const s = buildPersonalSeason({
    me: 'me',
    players: [player('me')],
    pairs: [
      pair('me', 'mate', {
        sameTeam: 23,
        winsTogether: 15,
        against: 18,
        winsA: 11,
        winsB: 6,
      }),
    ],
  });

  it('the teammate carries what we won TOGETHER', () => {
    expect(s.partner?.winsTogether).toBe(15);
  });

  it('and, separately, our head-to-head record', () => {
    expect(s.partner?.myWins).toBe(11);
    expect(s.partner?.theirWins).toBe(6);
  });

  it('they are different numbers, which is the whole point', () => {
    expect(s.partner?.winsTogether).not.toBe(s.partner?.myWins);
  });
});

describe('evenings attended is its own number', () => {
  // The gate for every season title is half the season's EVENINGS, so a player
  // asking why they did or did not win one has to be able to see it. It is not
  // `rounds`, which counts mini-games — roughly six an evening.
  it('comes from `games`, not from rounds', () => {
    const s = buildPersonalSeason({
      me: 'me',
      players: [player('me', { games: 11, rounds: 64 })],
      pairs: [],
    });
    expect(s.evenings).toBe(11);
    expect(s.rounds).toBe(64);
  });

  it('is zero, not undefined, for a player with no row', () => {
    const s = buildPersonalSeason({ me: 'ghost', players: [], pairs: [] });
    expect(s.evenings).toBe(0);
  });
});
