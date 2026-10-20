jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false, getFirebase: () => ({ db: 'db' }) }));
jest.mock('firebase/firestore', () => ({ collection: jest.fn((...parts) => parts), getDocs: jest.fn() }));
import { getDocs } from 'firebase/firestore';
import { groupHeldSeasonTitles, readHeldSeasonTitle, seasonTitlesService } from '@/services/seasonTitlesService';

test('the actual reader carries frozen award value, source ids and name into the cabinet', async () => {
  (getDocs as jest.Mock).mockResolvedValue({ docs: [{ id: 'club-id__s2__topWinner', data: () => ({ titleKey: 'topWinner', value: 13, groupId: 'club-id', groupName: 'שם בעת הזכייה', seasonId: 's2', seasonNo: 2, at: 200 }) }] });
  expect(await seasonTitlesService.list('owner-id')).toEqual([{ id: 'club-id__s2__topWinner', titleKey: 'topWinner', value: 13, groupId: 'club-id', groupName: 'שם בעת הזכייה', seasonId: 's2', seasonNo: 2, at: 200 }]);
});
test('a missing value stays unknown, zero stays zero and unknown award keys are skipped', () => {
  expect(readHeldSeasonTitle('id', { titleKey: 'topScorer' })?.value).toBeUndefined();
  expect(readHeldSeasonTitle('id', { titleKey: 'topScorer', value: 0 })?.value).toBe(0);
  expect(readHeldSeasonTitle('id', { titleKey: 'topScorer', value: Infinity })?.value).toBeUndefined();
  expect(readHeldSeasonTitle('id', { titleKey: 'futureAward' })).toBeNull();
});
test('clubs with the same name and different seasons keep separate groups; newest leads', () => {
  const make = (id: string, groupId: string, seasonId: string, at: number) => readHeldSeasonTitle(id, { titleKey: 'topWinner', value: 13, groupId, groupName: 'אותו שם', seasonId, seasonNo: Number(seasonId.slice(1)), at })!;
  const groups = groupHeldSeasonTitles([make('a','club-a','s1',10),make('b','club-b','s1',10),make('c','club-a','s2',20)]);
  expect(groups.map(group => group.titles.map(title => title.id))).toEqual([['c'], ['a'], ['b']]);
});
test('failed reads reject instead of claiming an empty cabinet', async () => {
  (getDocs as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  await expect(seasonTitlesService.list('owner')).rejects.toThrow('offline');
  await expect(seasonTitlesService.list('')).rejects.toThrow('owner required');
});

test('the frozen percentage unit survives the real reader while legacy counts keep no unit', () => {
  expect(readHeldSeasonTitle('new', {titleKey:'topWinner',value:66.67,valueUnit:'percent'})).toMatchObject({value:66.67,valueUnit:'percent'});
  expect(readHeldSeasonTitle('old', {titleKey:'topWinner',value:1})).not.toHaveProperty('valueUnit');
});
