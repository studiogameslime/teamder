/**
 * Saving availability makes the app agree with what was saved.
 *
 * The bug this exists for had a long, quiet chain. A guest fills the grid,
 * meets the auth sheet, signs in, and the RESUMER writes the document — from a
 * place where `AvailabilityEditScreen` is long gone. The write succeeded;
 * `currentUser.availability` kept whatever it held before; and the first
 * consumer to ask, the notification bridge reading `acceptsFillerPush`, got a
 * stale `false` and silently declined to offer notifications.
 *
 * The bridge was the symptom. The defect was that a domain operation left its
 * own invariant to a caller, so every future reader of availability had the
 * same trap waiting. These tests are about the invariant, not the bridge:
 * after a save that succeeded, local state reflects the saved values — on BOTH
 * paths, and on NEITHER when the write failed.
 */

const updateDoc = jest.fn();
const setAuthUserJson = jest.fn();
const getAuthUserJson = jest.fn();
const ensureUserDoc = jest.fn();
const invalidate = jest.fn();
const logEvent = jest.fn();
const state: { currentUser: unknown } = { currentUser: null };
const setState = jest.fn((patch: { currentUser: unknown }) => {
  state.currentUser = patch.currentUser;
});

jest.mock('react-native', () => ({ Appearance: {} }), { virtual: true });
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false }));
jest.mock('firebase/firestore', () => ({ updateDoc: (...a: unknown[]) => updateDoc(...a) }));
jest.mock('@/firebase/firestore', () => ({ docs: { user: (id: string) => ({ id }) } }));
jest.mock('@/firebase/authRace', () => ({
  withAuthRaceRetry: (fn: () => unknown) => fn(),
}));
jest.mock('@/services/storage', () => ({
  storage: {
    getAuthUserJson: (...a: unknown[]) => getAuthUserJson(...a),
    setAuthUserJson: (...a: unknown[]) => setAuthUserJson(...a),
  },
}));
jest.mock('@/services/userService', () => ({
  userService: { ensureUserDoc: (...a: unknown[]) => ensureUserDoc(...a) },
}));
jest.mock('@/services/availabilityFeedService', () => ({
  availabilityFeedService: { invalidate: () => invalidate() },
}));
jest.mock('@/services/analyticsService', () => ({
  AnalyticsEvent: new Proxy({}, { get: (_t, k) => String(k) }),
  logEvent: (...a: unknown[]) => logEvent(...a),
}));
jest.mock('@/store/userStore', () => ({
  useUserStore: {
    getState: () => state,
    setState: (p: { currentUser: unknown }) => setState(p),
  },
}));

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

import { persistAvailability } from '@/services/availabilitySave';
import type { UserAvailability } from '@/types';

const AV: UserAvailability = {
  preferredDays: [2, 5],
  preferredTimes: ['evening'],
  availabilitySlots: { '2': ['evening'] },
  availabilityRadiusKm: 25,
  isAvailableForInvites: true,
  acceptsFillerPush: true,
} as UserAvailability;

const COORDS = { lat: 32.1, lng: 34.8 };

beforeEach(() => {
  jest.clearAllMocks();
  updateDoc.mockResolvedValue(undefined);
  // Somebody whose stored availability says the OPPOSITE of what they are
  // about to save — which is the shape of the stale read that caused this.
  state.currentUser = {
    id: 'u1',
    name: 'אליס',
    availability: { preferredDays: [], acceptsFillerPush: false },
  };
});

const patched = () =>
  (state.currentUser as { availability: UserAvailability }).availability;

// ─── the invariant ────────────────────────────────────────────────────────

describe('after a save that succeeded', () => {
  it('local state carries the values that were written', async () => {
    await persistAvailability('u1', AV, COORDS);

    expect(patched()).toMatchObject({
      preferredDays: [2, 5],
      availabilityRadiusKm: 25,
      isAvailableForInvites: true,
      homeCityLat: 32.1,
      homeCityLng: 34.8,
    });
  });

  // The specific field the notification bridge reads. Named on its own
  // because it is the one that was wrong, and because it is a PREFERENCE:
  // the local value must mirror what was saved, never be set to make an
  // offer appear.
  it('acceptsFillerPush reflects what was saved, in both directions', async () => {
    await persistAvailability('u1', AV, COORDS);
    expect(patched().acceptsFillerPush).toBe(true);

    await persistAvailability('u1', { ...AV, acceptsFillerPush: false }, COORDS);
    expect(patched().acceptsFillerPush).toBe(false);
  });

  it('returns the saved shape, so a caller need not re-derive it', async () => {
    const saved = await persistAvailability('u1', AV, COORDS);
    expect(saved.acceptsFillerPush).toBe(true);
    expect(saved).toEqual(patched());
  });

  // The home-calendar counts are derived from radius and location; both just
  // changed. Also a screen-side effect until now, and just as absent from the
  // resume path.
  it('drops the availability feed cache', async () => {
    await persistAvailability('u1', AV, COORDS);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  // One save, one event — and from the values written, not from a screen's
  // local state. It used to live in the screen, so the resumed save (the
  // guest path) was measured as nothing at all.
  it('reports the save exactly once, from what was written', async () => {
    await persistAvailability('u1', AV, COORDS);
    const calls = logEvent.mock.calls.filter((c) => c[0] === 'AvailabilitySet');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({
      days: '2,5',
      radiusKm: 25,
      locationEnabled: 'true',
      acceptsFillerPush: 'true',
    });
  });

  it('says the home area is off when no coords were written', async () => {
    await persistAvailability('u1', { ...AV, acceptsFillerPush: false }, null);
    const call = logEvent.mock.calls.find((c) => c[0] === 'AvailabilitySet');
    expect(call?.[1]).toMatchObject({
      locationEnabled: 'false',
      acceptsFillerPush: 'false',
    });
  });

  // No `getCurrentUser`, no second document read. The write knows what it
  // wrote; paying a read to find out was both a cost and a read-after-write
  // window where the server could still answer with the previous value.
  it('costs no extra read', async () => {
    await persistAvailability('u1', AV, COORDS);
    expect(updateDoc).toHaveBeenCalledTimes(1);
  });
});

// ─── the same on both paths ───────────────────────────────────────────────

describe('the screen path and the resume path', () => {
  // There is only one persistence function, and the invariant is inside it —
  // which is the whole point. This asserts the property the resumer depends
  // on: nothing about the caller is required for the state to be consistent.
  it('are the same call, so neither can be the one that forgets', async () => {
    await persistAvailability('u1', AV, COORDS);
    expect(setState).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});

// ─── whose state ──────────────────────────────────────────────────────────

describe('a save for somebody else', () => {
  // A patch applied to the wrong session would be worse than the staleness it
  // is fixing.
  it('leaves the current session alone', async () => {
    await persistAvailability('someone-else', AV, COORDS);
    expect(setState).not.toHaveBeenCalled();
  });

  it('with no session at all, patches nothing and does not throw', async () => {
    state.currentUser = null;
    await expect(persistAvailability('u1', AV, COORDS)).resolves.toBeTruthy();
    expect(setState).not.toHaveBeenCalled();
  });
});

// ─── failure ──────────────────────────────────────────────────────────────

describe('a save that failed', () => {
  it('does not tell local state it succeeded', async () => {
    updateDoc.mockRejectedValue(new Error('offline'));
    await expect(persistAvailability('u1', AV, COORDS)).rejects.toThrow();
    expect(setState).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(logEvent.mock.calls.filter((c) => c[0] === 'AvailabilitySet')).toHaveLength(0);
  });

  // The production recovery: one account had no /users document at all, so
  // the update rule read `resource.data` against nothing and answered
  // permission-denied. Rebuilt and retried — and the state patch belongs
  // after the RETRY, not after the first attempt.
  it('patches only once the recovered retry lands', async () => {
    updateDoc
      .mockRejectedValueOnce(Object.assign(new Error('d'), { code: 'permission-denied' }))
      .mockResolvedValueOnce(undefined);
    ensureUserDoc.mockResolvedValue(true);

    await persistAvailability('u1', AV, COORDS);
    expect(setState).toHaveBeenCalledTimes(1);
    expect(patched().acceptsFillerPush).toBe(true);
  });

  it('leaves state alone when the recovery cannot help', async () => {
    updateDoc.mockRejectedValue(
      Object.assign(new Error('d'), { code: 'permission-denied' }),
    );
    ensureUserDoc.mockResolvedValue(false);

    await expect(persistAvailability('u1', AV, COORDS)).rejects.toThrow();
    expect(setState).not.toHaveBeenCalled();
  });
});
