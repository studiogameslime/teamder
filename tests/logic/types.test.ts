import {
  getAttendanceRate,
  getCancelRate,
  getTeamCreatorId,
  isGuestId,
  toGuestRosterId,
  GUEST_ID_PREFIX,
} from '@/types';
import { stripUndefined } from '@/utils/stripUndefined';

describe('attendance / cancel rate', () => {
  it('0 when no stats or no games (no divide-by-zero)', () => {
    expect(getAttendanceRate(undefined)).toBe(0);
    expect(getAttendanceRate({ totalGames: 0, attended: 0, cancelled: 0 } as never)).toBe(0);
    expect(getCancelRate(undefined)).toBe(0);
  });
  it('rounds to a percentage', () => {
    expect(getAttendanceRate({ totalGames: 4, attended: 3, cancelled: 1 } as never)).toBe(75);
    expect(getCancelRate({ totalGames: 4, attended: 3, cancelled: 1 } as never)).toBe(25);
    expect(getAttendanceRate({ totalGames: 3, attended: 1, cancelled: 0 } as never)).toBe(33);
    expect(getAttendanceRate({ totalGames: 8, attended: 8, cancelled: 0 } as never)).toBe(100);
  });
});

describe('getTeamCreatorId', () => {
  it('prefers creatorId, falls back to first admin', () => {
    expect(getTeamCreatorId({ creatorId: 'u1', adminIds: ['a', 'b'] })).toBe('u1');
    expect(getTeamCreatorId({ creatorId: undefined, adminIds: ['a', 'b'] })).toBe('a');
    expect(getTeamCreatorId({ creatorId: undefined, adminIds: [] })).toBeUndefined();
  });
});

describe('guest ids', () => {
  it('prefix round-trip', () => {
    expect(GUEST_ID_PREFIX).toBe('guest:');
    expect(toGuestRosterId('abc')).toBe('guest:abc');
    expect(isGuestId('guest:abc')).toBe(true);
    expect(isGuestId(toGuestRosterId('xyz'))).toBe(true);
  });
  it('real uids are not guests', () => {
    expect(isGuestId('1IdtNEjbEXfiRSqvLrJVn99NsfI2')).toBe(false);
    expect(isGuestId('')).toBe(false);
  });
});

describe('stripUndefined', () => {
  it('drops undefined keys, keeps falsy-but-defined', () => {
    expect(stripUndefined({ a: 1, b: undefined, c: 0, d: '', e: false, f: null })).toEqual({
      a: 1,
      c: 0,
      d: '',
      e: false,
      f: null,
    });
  });
  it('leaves a clean object untouched', () => {
    expect(stripUndefined({ x: 1, y: 'z' })).toEqual({ x: 1, y: 'z' });
  });
});
