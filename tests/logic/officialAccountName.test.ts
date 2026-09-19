import { isEmailLikeName, isReservedName } from '@/utils/officialAccount';

// The client mirror of `nameNotEmail` / `nameNotReserved` in firestore.rules.
// The rule is the enforcement; these functions exist so a real person gets a
// sentence instead of a permission error. The two must agree — the same cases
// are pinned against the rules themselves in tests/rules/displayName.test.mjs.

describe('isEmailLikeName', () => {
  // The name the Google Play pre-launch robot signs up with. Forty-seven of
  // these accumulated between 22.06 and 19.09.2026, joined real clubs, and two
  // of them played in a real club's game.
  it.each([
    'appstore.review@teamder.app',
    'hazelblake.54551@gmail.com',
    'RAMONACARPENTER.29111@GMAIL.COM',
    'eugene.burns+footy@googlemail.co.uk',
    'מתן someone@gmail.com',
  ])('rejects %s', (name) => {
    expect(isEmailLikeName(name)).toBe(true);
  });

  // A bare '@' is not an address, and a person may legitimately use one.
  it.each([
    'מתן לוי',
    'Idan Almaliach',
    'עידן @ נחלים',
    'DJ @Khaled',
    'user@localhost',
    'a@b.c',
    '',
  ])('allows %s', (name) => {
    expect(isEmailLikeName(name)).toBe(false);
  });
});

describe('isReservedName no longer exempts an email-shaped name', () => {
  // This was the actual hole: the brand check skipped any name containing '@',
  // so `appstore.review@teamder.app` — which contains "teamder" — was waved
  // past the one check that would have caught it on the very first signup.
  it('catches the brand inside an address', () => {
    expect(isReservedName('appstore.review@teamder.app')).toBe(true);
    expect(isReservedName('support@teamder.app')).toBe(true);
  });

  it('and still catches it without one', () => {
    expect(isReservedName('Teamder Support')).toBe(true);
    expect(isReservedName('T e a m d e r')).toBe(true);
    expect(isReservedName('טימדר רשמי')).toBe(true);
  });

  it('and still leaves ordinary names alone', () => {
    expect(isReservedName('מתן לוי')).toBe(false);
    expect(isReservedName('someone@gmail.com')).toBe(false);
  });
});
