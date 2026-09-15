// A closed season's table, as it survives the archive reader.
//
// The club stats screen now offers a season picker, and picking a past season
// renders the WHOLE screen — the top scorer, the leaders, the donuts, the duo,
// the full table — out of `seasonSummary/{groupId}__{seasonId}`. That only
// holds because closeSeason archives every counter a season owns; the moment a
// field is added there and not named in the reader, it silently does not exist
// on the client and a column on that screen quietly reads zero.
//
// The fixture below is a copy of what closeSeason writes — see
// PLAYER_SEASON_FIELDS / CLUB_SEASON_FIELDS and the `summaryRef.create` call in
// functions/src/seasonRollover.ts. If a field is added there and not here, this
// test is where it should be noticed.
import { parseSeasonTable } from '@/utils/seasonArchive';

const archive = () => ({
  groupId: 'g1',
  groupName: 'חמישי כדורגל',
  seasonId: 's2',
  no: 2,
  startsAt: 1_752_000_000_000,
  endsAt: 1_776_000_000_000,
  completedRounds: 24,
  totals: {
    rounds: 118,
    goals: 642,
    assists: 301,
    guestGoals: 37,
    ownGoals: 11,
    tiedRounds: 21,
    shootoutRounds: 6,
    scorelessRounds: 9,
    cleanSheets: 40,
  },
  players: {
    u_dani: {
      displayName: 'דני כהן',
      goals: 41,
      assists: 12,
      rounds: 24,
      wins: 14,
      losses: 8,
      ties: 2,
      games: 8,
      cleanSheets: 5,
      ownGoals: 1,
      penTaken: 6,
      penScored: 5,
      penMissed: 1,
      penFaced: 0,
      penSaved: 0,
      penConceded: 0,
      csRounds: 24,
      asRounds: 24,
      eveningScoreSum: 640,
      eveningScoreCount: 8,
    },
    u_roi: {
      displayName: 'רועי לוי',
      goals: 18,
      assists: 28,
      rounds: 20,
      wins: 11,
      losses: 7,
      ties: 2,
      games: 6,
      cleanSheets: 4,
      ownGoals: 0,
      penTaken: 2,
      penScored: 1,
      penMissed: 1,
      penFaced: 9,
      penSaved: 4,
      penConceded: 5,
      // No coverage denominators: this player's season predates them.
      eveningScoreSum: 410,
      eveningScoreCount: 6,
    },
  },
  pairs: [
    {
      a: 'u_dani',
      b: 'u_roi',
      sameTeam: 30,
      against: 12,
      winsTogether: 18,
      lossesTogether: 7,
      cleanSheetsTogether: 5,
      winsA: 6,
      winsB: 6,
      assistsAToB: 9,
      assistsBToA: 5,
    },
    // The biggest pair by assists, but one half is not in the sealed player
    // map — a guest, or somebody the close filtered out. The screen has no
    // name for them and no lookup that would find one.
    {
      a: 'u_dani',
      b: 'u_ghost',
      sameTeam: 4,
      against: 1,
      winsTogether: 2,
      lossesTogether: 1,
      cleanSheetsTogether: 0,
      winsA: 1,
      winsB: 0,
      assistsAToB: 40,
      assistsBToA: 0,
    },
  ],
  awards: {},
});

describe('parseSeasonTable', () => {
  it('carries every club total the stats screen renders', () => {
    const t = parseSeasonTable(archive());
    expect(t.totalGoals).toBe(642);
    expect(t.totalRounds).toBe(118);
    expect(t.guestGoals).toBe(37);
    expect(t.ownGoals).toBe(11);
    expect(t.tiedRounds).toBe(21);
    expect(t.shootoutRounds).toBe(6);
    expect(t.scorelessRounds).toBe(9);
  });

  it('carries every player column the table ranks on', () => {
    const t = parseSeasonTable(archive());
    const dani = t.players.find((p) => p.uid === 'u_dani');
    expect(dani).toEqual({
      uid: 'u_dani',
      goals: 41,
      assists: 12,
      rounds: 24,
      wins: 14,
      ties: 2,
      losses: 8,
      games: 8,
      cleanSheets: 5,
      ownGoals: 1,
      penTaken: 6,
      penScored: 5,
      penFaced: 0,
      penSaved: 0,
      csRounds: 24,
      asRounds: 24,
    });
  });

  it('leaves a missing coverage denominator absent rather than zero', () => {
    const roi = parseSeasonTable(archive()).players.find(
      (p) => p.uid === 'u_roi',
    )!;
    // A 0 would mean "measured across zero mini-games", which is what the
    // reader's fallback exists to tell apart from a real zero.
    expect('csRounds' in roi).toBe(false);
    expect('asRounds' in roi).toBe(false);
  });

  it('freezes the names, so a season reads after a player leaves', () => {
    const t = parseSeasonTable(archive());
    expect(t.names.u_dani).toBe('דני כהן');
    expect(t.names.u_roi).toBe('רועי לוי');
  });

  it('picks the duo with the most assists between them, both directions', () => {
    const t = parseSeasonTable(archive());
    expect(t.duo).toEqual({ uidA: 'u_dani', uidB: 'u_roi', assists: 14 });
  });

  it('skips a pair whose other half has no sealed name', () => {
    const t = parseSeasonTable(archive());
    // The 40-assist pair outranks every real one but cannot be rendered.
    expect(t.duo?.uidB).not.toBe('u_ghost');
  });

  it('survives an archive with no pairs and no players at all', () => {
    const t = parseSeasonTable({ totals: {}, players: {}, pairs: [] });
    expect(t.players).toEqual([]);
    expect(t.duo).toBeNull();
    expect(t.totalGoals).toBe(0);
  });
});
