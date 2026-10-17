import { liveSeasonStamp } from '../../functions/src/liveSeasonStamp';
import { assertSeasonOpenForGame } from '../../functions/src/seasonLock';

const club = { seasons: { enabled: true, currentId: 's3', currentNo: 3, count: 2, startedAt: 1000 } };
const board = { seasonId: undefined, status: 'open', liveMatch: { scoreA: 1, scoreB: 1 } };

test('the reported timerless board can be stamped into its current season using server createTime', () => {
  expect(() => assertSeasonOpenForGame(club, board)).toThrow('closedSeasonGame');
  const seasonId = liveSeasonStamp(club, board, 2000);
  expect(seasonId).toBe('s3');
  expect(() => assertSeasonOpenForGame(club, { ...board, seasonId })).not.toThrow();
  expect(board).toEqual({ seasonId: undefined, status: 'open', liveMatch: { scoreA: 1, scoreB: 1 } });
});

test.each([undefined, 0, 999, NaN, Infinity])('an unknown or historical server creation time %s cannot relabel a historical game', time => {
  expect(liveSeasonStamp(club, board, time)).toBeUndefined();
  expect(() => assertSeasonOpenForGame(club, board)).toThrow('closedSeasonGame');
});

test.each(['finished', 'cancelled', 'scheduled'])('a %s evening cannot acquire a current live season', status => {
  expect(liveSeasonStamp(club, { ...board, status }, 2000)).toBeUndefined();
});

test.each(['s1', 's3', 42])('a pre-existing stamp %s is never replaced', seasonId => {
  expect(liveSeasonStamp(club, { ...board, seasonId }, 2000)).toBeUndefined();
});

test('merely creating an open evening does not stamp a season before evidence of play', () => {
  expect(liveSeasonStamp(club, { status: 'open' }, 2000)).toBeUndefined();
});

test.each([{ operation: { kind: 'close' } }, { pendingClose: { closeAt: 3000 } }, { startedAt: undefined }, { currentId: '' }])('uncertain or changing period %j cannot stamp a new evening', override => {
  expect(liveSeasonStamp({ seasons: { ...club.seasons, ...override } }, board, 2000)).toBeUndefined();
});

test('disabled-season periods have their own boundary and never reopen an old season', () => {
  const off = { seasons: { enabled: false, count: 2, disabledAt: 1500 } };
  expect(liveSeasonStamp(off, board, 1000)).toBeUndefined();
  const seasonId = liveSeasonStamp(off, board, 2000);
  expect(seasonId).toBe('off_2_1500');
  expect(() => assertSeasonOpenForGame(off, { ...board, seasonId })).not.toThrow();
});
