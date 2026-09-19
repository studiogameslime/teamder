// The badge and the name block are the two halves of one anti-impersonation
// story, and both are pure functions — so they're worth pinning here. The
// firestore.rules mirror of RESERVED_NAME_RE is exercised separately against
// the deployed ruleset; these tests pin the CLIENT copy's behaviour and, with
// it, the shape the rule has to match.

import {
  TEAMDER_UID,
  isOfficialSender,
  isReservedName,
} from '@/utils/officialAccount';

describe('isOfficialSender', () => {
  it('accepts only the reserved sender id', () => {
    expect(isOfficialSender(TEAMDER_UID)).toBe(true);
  });

  it('rejects a real uid, however it is named elsewhere', () => {
    // The whole point: the badge comes from the ID, so an account that copied
    // the name and the logo still cannot earn it.
    expect(isOfficialSender('YIZlKWBvvjae3oqgIoAMr9nzQEi1')).toBe(false);
    expect(isOfficialSender('Teamder')).toBe(false);
    expect(isOfficialSender('teamder ')).toBe(false);
    expect(isOfficialSender(undefined)).toBe(false);
    expect(isOfficialSender(null)).toBe(false);
    expect(isOfficialSender('')).toBe(false);
  });
});

describe('isReservedName', () => {
  it('blocks the brand name in either script', () => {
    expect(isReservedName('Teamder')).toBe(true);
    expect(isReservedName('teamder')).toBe(true);
    expect(isReservedName('טימדר')).toBe(true);
    expect(isReservedName('טיאמדר')).toBe(true);
  });

  it('blocks it as a substring, not just standalone', () => {
    // "Teamder Support" impersonates exactly as well as the bare word.
    expect(isReservedName('Teamder Support')).toBe(true);
    expect(isReservedName('צוות טימדר')).toBe(true);
    expect(isReservedName('the teamder team')).toBe(true);
  });

  it('blocks separator padding used to slip past a naive match', () => {
    expect(isReservedName('T e a m d e r')).toBe(true);
    expect(isReservedName('team-der')).toBe(true);
    expect(isReservedName('team.der')).toBe(true);
    expect(isReservedName('team_der')).toBe(true);
  });

  it('leaves ordinary names alone', () => {
    expect(isReservedName('מתן לוי')).toBe(false);
    expect(isReservedName('Eliran Tzabari')).toBe(false);
    expect(isReservedName('Hippo Support')).toBe(false);
    expect(isReservedName('')).toBe(false);
  });

  // This case used to assert the OPPOSITE — that an email-shaped name is
  // exempt from the brand check — on two grounds. One was false and one was
  // real, and they are worth separating because the real one still binds.
  //
  // FALSE: "signup seeds `name` from the address when there is nothing
  // better". It does not, and never did. All five signup paths in
  // `userService` seed `name: fbUser.displayName ?? ''` — the Auth profile
  // name. Nothing in this codebase has ever written an address into `name`.
  // The 47 accounts that carry one (verified live on 19.09.2026; every single
  // one is the Google Play pre-launch robot) got it by having the string TYPED
  // into the name field on ProfileSetupScreen.
  //
  // REAL, and still honoured: blocking the name must not deny every /users
  // write for an account that already carries one — FCM token included — or
  // an Apple reviewer meets a broken app. That is why firestore.rules polices
  // the name only when it CHANGES (`nameNotNewlyReserved` /
  // `nameNotNewlyEmail`), and why the client check below sits inside
  // `if (typeof patch.name === 'string')` in `updateProfile` rather than
  // running on every write. Both properties are pinned in
  // tests/rules/displayName.test.mjs against the rules themselves.
  it('no longer exempts email-shaped names — that was the hole', () => {
    // The robot's name contains "teamder". The exemption is the only reason
    // the brand check did not refuse it at the very first signup.
    expect(isReservedName('appstore.review@teamder.app')).toBe(true);
    expect(isReservedName('qa.teamder.test1@gmail.com')).toBe(true);
  });

  it('and an address with no brand in it is still not a RESERVED name', () => {
    // isReservedName answers "does this impersonate us". isEmailLikeName is
    // the separate check that answers "is this an address at all"; they are
    // deliberately two functions with two error messages.
    expect(isReservedName('hazelblake.54551@gmail.com')).toBe(false);
  });
});
