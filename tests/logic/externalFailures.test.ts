/**
 * Two production reports that were not bugs — and what we owed the user anyway.
 *
 * The error panel earns its keep only if everything in it is ours to fix.
 * These two were not, and both sat there for days:
 *
 *   govmapSearch ×4 — the government mapping service answered 504. Free public
 *   service, no uptime promise, and the search that triggered it was a typo.
 *   Four rows we could do nothing about, on top of real failures.
 *
 *   "התחברות עם Google נכשלה" ×13 — "Unable to open Safari", code -1. Our OAuth
 *   wiring was verified correct; Safari was disabled on that iPhone.
 *
 * Not filing them is only half the job: in both cases the user was left with
 * nothing useful. The pitch search said "no results" when the service was down,
 * which sends someone hunting for a field that exists; sign-in said "failed"
 * when the fix was on the next line of the same screen.
 *
 * These pin the classification in BOTH directions. Widening it is the real
 * danger — a rule that swallows everything turns a bug we need to see into
 * silence.
 */
jest.mock('react-native', () => ({ Appearance: {} }), { virtual: true });
jest.mock('@/services/errorLog', () => ({
  logError: jest.fn(),
  isExpectedDenial: () => false,
}));

import { isUpstreamDown } from '@/services/govmapService';
import { isBrowserBlocked } from '@/utils/signInErrors';

describe('govmap: their outage is not our error', () => {
  const err = (message: string, name?: string) =>
    Object.assign(new Error(message), name ? { name } : {});

  it('swallows the 504 that was actually reported', () => {
    expect(isUpstreamDown(err('govmap autocomplete 504'))).toBe(true);
  });

  it('swallows the rest of the 5xx family', () => {
    for (const s of [500, 502, 503, 504, 599]) {
      expect(isUpstreamDown(err(`govmap autocomplete ${s}`))).toBe(true);
    }
  });

  it('swallows a timeout and a rate limit — both are "come back later"', () => {
    expect(isUpstreamDown(err('govmap autocomplete 408'))).toBe(true);
    expect(isUpstreamDown(err('govmap autocomplete 429'))).toBe(true);
  });

  it('swallows our own abort, and a dead network', () => {
    expect(isUpstreamDown(err('Aborted', 'AbortError'))).toBe(true);
    expect(isUpstreamDown(err('Network request failed'))).toBe(true);
  });

  it('still REPORTS a 4xx — that means they changed and we must follow', () => {
    expect(isUpstreamDown(err('govmap autocomplete 400'))).toBe(false);
    expect(isUpstreamDown(err('govmap autocomplete 404'))).toBe(false);
    expect(isUpstreamDown(err('govmap autocomplete 422'))).toBe(false);
  });

  it('still REPORTS a malformed response — that one is ours', () => {
    expect(isUpstreamDown(err('JSON Parse error: Unexpected token'))).toBe(false);
    expect(isUpstreamDown(err('r.shape is not a function'))).toBe(false);
  });

  it('is not fooled by a number that is not a status', () => {
    expect(isUpstreamDown(err('searched 504 places'))).toBe(false);
  });
});

describe('sign-in: a blocked browser is the user’s to fix, not ours', () => {
  const err = (message: string) => new Error(message);

  it('catches the message Google actually sent', () => {
    expect(
      isBrowserBlocked(
        err(
          'RNGoogleSignIn: Unknown error in google sign in., Error Domain=com.google.GIDSignIn Code=-1 "Unable to open Safari." UserInfo={NSLocalizedDescription=Unable to open Safari.}',
        ),
      ),
    ).toBe(true);
  });

  it('catches the Android and generic phrasings too', () => {
    expect(isBrowserBlocked(err('Unable to open URL'))).toBe(true);
    expect(isBrowserBlocked(err('unable to open browser'))).toBe(true);
  });

  it('does NOT swallow every code -1 — that is a catch-all', () => {
    expect(
      isBrowserBlocked(err('RNGoogleSignIn: Unknown error in google sign in.')),
    ).toBe(false);
  });

  it('does NOT swallow a real misconfiguration', () => {
    expect(isBrowserBlocked(err('DEVELOPER_ERROR'))).toBe(false);
    expect(isBrowserBlocked(err('OAuth client ID not configured'))).toBe(false);
  });

  it('survives an error with no message at all', () => {
    expect(isBrowserBlocked(undefined)).toBe(false);
    expect(isBrowserBlocked({})).toBe(false);
  });
});
