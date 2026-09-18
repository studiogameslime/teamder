// The club's season block, as it survives the reader.
//
// `src/firebase/firestore.ts` rebuilds every document field by field, so a
// field the reader does not name DOES NOT EXIST on the client no matter what
// Firestore holds. That is not a hypothetical here: it is what made the whole
// seasons feature invisible in 1.1.6, and every other reader in that file
// (readLiveMatch, readDraftTeams, readRotation, readTeamBalanceMeta) has a
// persistence test for exactly this reason. This one did not.
//
// The fixture below is a byte-for-byte copy of what the server writes — see
// the `seasons: { … }` blocks in functions/src/index.ts (runSeasonRollovers,
// endSeasonNow, enableClubSeasons, reopenLastSeason). If a field is added
// there and not here, this test is where it should be noticed.
import { readGroupSeasons } from '@/firebase/firestore';

/** Exactly the block runSeasonRollovers writes when it opens a new season. */
const serverBlock = () => ({
  enabled: true,
  currentNo: 4,
  currentId: 's4',
  startedAt: 1_790_000_000_000,
  roundsAtStart: 212,
  playedRounds: 7,
  cadence: { type: 'date', months: 6, endsAt: 1_805_000_000_000 },
  targetHistory: [],
  count: 3,
});

describe('the season block a club reads', () => {
  it('carries every field the server writes', () => {
    const s = readGroupSeasons(serverBlock());
    expect(s).toEqual({
      enabled: true,
      currentNo: 4,
      currentId: 's4',
      startedAt: 1_790_000_000_000,
      roundsAtStart: 212,
      playedRounds: 7,
      cadence: { type: 'date', months: 6, endsAt: 1_805_000_000_000 },
      targetHistory: [],
      count: 3,
    });
  });

  // This file exists to catch a field the reader drops — and it did not catch
  // this one, because the expectation above omitted it too. `targetHistory` is
  // written by updateSeasonTarget on every change and typed as "kept and
  // shown… never quietly"; the reader never named it, so it was undefined on
  // every client and no screen could ever show it.
  it('keeps targetHistory, the only record that a target was moved', () => {
    const s = readGroupSeasons({
      ...serverBlock(),
      targetHistory: [
        { at: 1_790_000_100_000, by: 'u1', byName: 'מתן', from: { type: 'rounds', targetRounds: 24 }, to: { type: 'rounds', targetRounds: 30 } },
      ],
    });
    expect(s?.targetHistory).toHaveLength(1);
    expect(s?.targetHistory?.[0]).toMatchObject({ byName: 'מתן' });
  });

  it('keeps playedRounds, which is the whole progress line', () => {
    // `he.seasonsProgressRounds(seasons.playedRounds ?? 0, target)` is the club
    // card's only source for "N of M". Dropped here it silently reads 0 all
    // season, on a season the server is about to close.
    const s = readGroupSeasons({ ...serverBlock(), playedRounds: 0 });
    expect(s?.playedRounds).toBe(0);
  });

  it('keeps roundsAtStart, which is what makes a rounds target mean anything', () => {
    const s = readGroupSeasons(serverBlock());
    expect(s?.roundsAtStart).toBe(212);
  });

  it('carries a rounds cadence, target and all', () => {
    const s = readGroupSeasons({
      ...serverBlock(),
      cadence: { type: 'rounds', targetRounds: 24 },
    });
    expect(s?.cadence).toEqual({ type: 'rounds', targetRounds: 24 });
  });

  it('does not invent the two optional counters when the server omitted them', () => {
    // A season opened by enableClubSeasons({ closeFirstNow: true }) has neither.
    // Reading them as 0 would hide that; leaving them undefined lets the card
    // fall back on purpose.
    const { roundsAtStart, playedRounds, ...bare } = serverBlock();
    const s = readGroupSeasons(bare);
    expect(s).not.toHaveProperty('roundsAtStart');
    expect(s).not.toHaveProperty('playedRounds');
  });
});

describe('a block that cannot be trusted', () => {
  it('is nothing at all without a season id', () => {
    // Every screen keys off currentId; a block without one is not a season.
    expect(readGroupSeasons({ enabled: true, currentNo: 2 })).toBeUndefined();
  });

  it('survives a malformed cadence rather than taking the card down', () => {
    const s = readGroupSeasons({ ...serverBlock(), cadence: 'שש' });
    expect(s?.currentId).toBe('s4');
    expect(s?.cadence.type).toBe('date');
  });

  it('is undefined for a club that never had one', () => {
    expect(readGroupSeasons(undefined)).toBeUndefined();
    expect(readGroupSeasons(null)).toBeUndefined();
  });

  it('reads a disabled block, so the app can tell off from absent', () => {
    // disableClubSeasons merges { enabled: false } and leaves the ids standing.
    const s = readGroupSeasons({ ...serverBlock(), enabled: false });
    expect(s?.enabled).toBe(false);
    expect(s?.currentId).toBe('s4');
  });
});
