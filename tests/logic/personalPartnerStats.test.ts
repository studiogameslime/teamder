import { personalPartnerResults } from '../../src/utils/personalPartnerStats';
test('same-team results include ties in the win-rate denominator', () => {
  expect(personalPartnerResults({ sameTeam: 8, winsTogether: 4, lossesTogether: 3 })).toEqual({ games: 8, wins: 4, losses: 3, ties: 1, winRate: 50 });
});
test('missing historic counters cannot claim zero losses or infer draws', () => {
  expect(personalPartnerResults({ sameTeam: 8, winsTogether: 4 })).toBeNull();
  expect(personalPartnerResults({ sameTeam: 0, winsTogether: 0, lossesTogether: 0 })).toBeNull();
});
test.each([-1, NaN, 1.5, '3'])('invalid result %s is rejected', value => {
  expect(personalPartnerResults({ sameTeam: 8, winsTogether: value, lossesTogether: 1 })).toBeNull();
});
test('contradictory totals are not displayed', () => {
  expect(personalPartnerResults({ sameTeam: 3, winsTogether: 3, lossesTogether: 1 })).toBeNull();
});
