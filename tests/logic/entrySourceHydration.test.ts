import { entryGuestAfterHydration } from '../../src/services/entrySource';

test('source resolution before guest hydration must wait instead of reporting a member', () => {
  expect(entryGuestAfterHydration(false, null)).toBeNull();
  expect(entryGuestAfterHydration(true, null)).toBeNull();
  expect(entryGuestAfterHydration(false, { id: 'guest', isGuest: true })).toBeNull();
  expect(entryGuestAfterHydration(true, { id: 'guest', isGuest: true })).toBe(true);
});

test('restored full accounts do not receive the new guest-entry notification', () => {
  expect(entryGuestAfterHydration(false, { id: 'member' })).toBeNull();
  expect(entryGuestAfterHydration(true, { id: 'member' })).toBe(false);
});
