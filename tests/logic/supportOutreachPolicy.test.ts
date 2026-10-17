import { DEFAULT_OUTREACH, nextOutreachTime, outreachEligible, outreachText, readOutreachConfig } from '../../functions/src/supportOutreachPolicy';
import { OUTREACH_DEFAULTS, validateOutreachSettings } from '../../pulse/src/services/supportOutreachService';
jest.mock('../../pulse/src/services/firestoreRest', () => ({}));
test('client/server defaults agree and never enable automatic sending implicitly', () => {
  expect(OUTREACH_DEFAULTS).toEqual(DEFAULT_OUTREACH); expect(readOutreachConfig().enabled).toBe(false);
  expect(DEFAULT_OUTREACH.delayHours).toBe(24);
});
test('new-user cutoff is inclusive, adjustable and excludes missing dates', () => {
  expect(outreachEligible(1, 1 + 7 * 86400_000, DEFAULT_OUTREACH)).toBe(true);
  expect(outreachEligible(1, 2 + 7 * 86400_000, DEFAULT_OUTREACH)).toBe(false);
  expect(outreachEligible(1, 1 + 90 * 86400_000, { ...DEFAULT_OUTREACH, newUserDays: 0 })).toBe(true);
  expect(outreachEligible(0, 100, DEFAULT_OUTREACH)).toBe(false);
  expect(outreachEligible(100, 90, DEFAULT_OUTREACH)).toBe(false);
});
test.each(['2026-10-13T07:00:00Z', '2026-10-13T16:59:00Z'])('does not delay an allowed Israeli time %s', value => {
  const at = Date.parse(value); expect(nextOutreachTime(at, DEFAULT_OUTREACH)).toBe(at);
});
test('quiet hours delay to morning and preserve the configured waiting period', () => {
  expect(new Date(nextOutreachTime(Date.parse('2026-10-13T18:00:00Z'), DEFAULT_OUTREACH)).toISOString()).toBe('2026-10-14T06:00:00.000Z');
  expect(new Date(nextOutreachTime(Date.parse('2026-10-13T05:30:00Z'), DEFAULT_OUTREACH)).toISOString()).toBe('2026-10-13T06:00:00.000Z');
});
test('uses a known user zone and survives a DST transition without fixed-offset arithmetic', () => {
  const at = Date.parse('2026-10-25T01:30:00Z');
  expect(new Date(nextOutreachTime(at, DEFAULT_OUTREACH)).toISOString()).toBe('2026-10-25T07:00:00.000Z');
  expect(nextOutreachTime(Date.parse('2026-10-13T12:00:00Z'), DEFAULT_OUTREACH, 'UTC')).toBe(Date.parse('2026-10-13T12:00:00Z'));
  expect(nextOutreachTime(at, DEFAULT_OUTREACH, 'bad-zone')).toBe(nextOutreachTime(at, DEFAULT_OUTREACH));
});
test('invalid remote settings fall back safely and invalid editor values are rejected', () => {
  const settings = readOutreachConfig({ delayHours: -1, newUserDays: NaN, startHour: 20, endHour: 9, timeZone: 'bad', template: '' });
  expect(settings).toEqual(DEFAULT_OUTREACH);
  for (const change of [{ delayHours: NaN }, { newUserDays: -1 }, { startHour: 22, endHour: 9 }, { timeZone: 'bad' }, { template: 'x'.repeat(701) }]) expect(validateOutreachSettings({ ...OUTREACH_DEFAULTS, ...change })).not.toBeNull();
  expect(validateOutreachSettings(OUTREACH_DEFAULTS)).toBeNull();
});
test('focus follows actual club progress; hostile names cannot inject controls or placeholders', () => {
  const text = (players: number, round: boolean) => outreachText(DEFAULT_OUTREACH, '\u202eMatan\nLevi', '{focus} United', players, round);
  expect(text(1, false)).toContain('בהזמנת החבר׳ה');
  expect(text(5, false)).toContain('לארגן את המחזור הראשון');
  expect(text(5, true)).toContain('איך הולך עם המועדון והמחזור הראשון');
  expect(text(1, false)).not.toContain('\u202e'); expect(text(1, false).length).toBeLessThanOrEqual(1000);
  expect(text(1, false)).toContain('{focus} United'); // replacement values are never re-expanded
});
