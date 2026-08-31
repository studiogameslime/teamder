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

  it('exempts email-shaped names', () => {
    // Signup seeds `name` from the address when there is nothing better, which
    // is how all 27 App Store review accounts are called this. Blocking it
    // would deny every /users write for them — FCM token included — and an
    // Apple reviewer would meet a broken app.
    expect(isReservedName('appstore.review@teamder.app')).toBe(false);
    expect(isReservedName('qa.teamder.test1@gmail.com')).toBe(false);
  });
});
