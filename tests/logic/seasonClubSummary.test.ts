import { buildSeasonClubNumbers, distinctSeasonWinners, seasonChemistryPairs } from '../../src/utils/seasonClubSummary';
import { pickChemistry, pairKey } from '../../src/utils/clubChemistry';

test('club games are counted once, attendance uses evenings, and top scorer share uses club goals', () => {
  const n = buildSeasonClubNumbers({ rounds: 20, goals: 24, assists: 13, ownGoals: 1 }, [
    { games: 5, rounds: 19, goals: 6, assists: 7, penTaken: 4, penScored: 3 },
    { games: 4, rounds: 18, goals: 5, assists: 6, penTaken: 2, penScored: 1 },
  ], 5);
  expect(n).toMatchObject({ games: 20, players: 2, goals: 24, assists: 13, goalsPerGame: 1.2, averageAttendance: 1.8, topScorerShare: 0.25, penScored: 4, penTaken: 6 });
});
test('missing club counters and denominators are unknown, not personal sums or false zeros', () => {
  const n = buildSeasonClubNumbers({}, [{ games: 2, rounds: 30, goals: 8 }], 0);
  expect(n).toMatchObject({ games: null, goals: null, assists: null, ownGoals: null, penTaken: null, penSaved: null, averageAttendance: null, goalsPerGame: null, topScorerShare: null });
  expect(buildSeasonClubNumbers({ rounds: 0, goals: 0, ownGoals: 0 }, [{ penTaken: 0, penScored: 0 }], 0).ownGoals).toBe(0);
});
test('duo holders are counted by distinct identities rather than pairs or display names', () => {
  expect(distinctSeasonWinners(['a__b', 'b__c', 'a__b', 'd__e'])).toEqual(['a', 'b', 'c', 'd', 'e']);
});
test('canonical pairs retain directional wins and assists even from an unsorted archive', () => {
  const pairs = seasonChemistryPairs([{ a: 'z', b: 'a', winsA: 7, winsB: 2, assistsAToB: 4, assistsBToA: 1, sameTeam: 12, winsTogether: 9, lossesTogether: 2, cleanSheetsTogether: 3 }]);
  expect(pairs[pairKey('a', 'z')]).toMatchObject({ winsA: 2, winsB: 7, assistsAToB: 1, assistsBToA: 4 });
  expect(pickChemistry(pairs).find(p => p.kind === 'bestRatio')).toMatchObject({ value: 75 });
  const tooSmall = seasonChemistryPairs([{ a: 'a', b: 'b', sameTeam: 9, winsTogether: 9 }]);
  expect(pickChemistry(tooSmall).find(p => p.kind === 'bestRatio')).toBeUndefined();
});
