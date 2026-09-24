/**
 * When Teamder is allowed to ask about notifications.
 *
 * The behaviour this protects: the OS dialog is the LAST step, it happens once
 * per person per moment that earns it, and every state the OS has already
 * answered is a hard stop. A permission dialog raised at the wrong time is
 * answered "no" once and — on iOS — permanently, so the expensive mistake here
 * is asking, not failing to ask.
 */

const store = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (k: string) => store.get(k) ?? null,
  setItem: async (k: string, v: string) => void store.set(k, v),
  multiRemove: async (ks: string[]) => ks.forEach((k) => store.delete(k)),
}));

const getPushPermissionState = jest.fn();
jest.mock('@/services/pushPermission', () => ({
  getPushPermissionState: () => getPushPermissionState(),
}));

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

import {
  shouldOffer,
  markOffered,
  resetOffers,
  announceCompleted,
  setOfferListener,
  COOLDOWN_MS,
  __clearPendingAnnouncement,
} from '@/services/notificationOffer';

const NOW = 1_800_000_000_000;

beforeEach(async () => {
  store.clear();
  jest.clearAllMocks();
  getPushPermissionState.mockResolvedValue('undetermined');
  setOfferListener(null);
  __clearPendingAnnouncement();
  await resetOffers();
});

// ─── the only state that earns a question ─────────────────────────────────

describe('permission state', () => {
  it('offers when the OS has never been asked', async () => {
    const d = await shouldOffer('join_game', { now: NOW });
    expect(d.show).toBe(true);
    expect(d.state).toBe('undetermined');
  });

  // Already works. A sheet here is pure noise.
  it('says nothing when push is already granted', async () => {
    getPushPermissionState.mockResolvedValue('granted');
    expect(await shouldOffer('join_game', { now: NOW })).toMatchObject({
      show: false,
      reason: 'granted',
    });
  });

  // Settled on a device. Android cannot say "never asked": expo-notifications
  // reports `denied` + `canAskAgain:true` for POST_NOTIFICATIONS that has
  // never been requested, so treating denied as a hard stop meant a fresh
  // Android phone was never offered anything — the feature would have shipped
  // doing nothing on its main platform. `blocked` is the real line, and our
  // own cooldown is what stops re-asking somebody who did decline.
  it('still educates somebody the OS reports as denied-but-askable', async () => {
    getPushPermissionState.mockResolvedValue('denied');
    const d = await shouldOffer('join_game', { now: NOW });
    expect(d.show).toBe(true);
    // Carried so the funnel can separate a first ask from a second.
    expect(d.state).toBe('denied');
  });

  it('respects the cooldown for a denied device too', async () => {
    getPushPermissionState.mockResolvedValue('denied');
    await markOffered('join_game', NOW);
    expect(await shouldOffer('join_club', { now: NOW + 60_000 })).toMatchObject({
      show: false,
      reason: 'cooldown',
    });
  });

  it('does not ask when the OS will not ask again', async () => {
    getPushPermissionState.mockResolvedValue('blocked');
    expect(await shouldOffer('join_game', { now: NOW })).toMatchObject({
      show: false,
      reason: 'blocked',
    });
  });

  // No native module (Expo Go, mock mode). We know nothing, so we say
  // nothing — "unsupported" must never be treated as "denied".
  it('says nothing on a build that cannot answer', async () => {
    getPushPermissionState.mockResolvedValue('unsupported');
    expect(await shouldOffer('join_game', { now: NOW })).toMatchObject({
      show: false,
      reason: 'unsupported',
    });
  });
});

// ─── no nagging ───────────────────────────────────────────────────────────

describe('frequency', () => {
  it('asks a given context once, ever', async () => {
    expect((await shouldOffer('join_game', { now: NOW })).show).toBe(true);
    await markOffered('join_game', NOW);
    expect(await shouldOffer('join_game', { now: NOW + COOLDOWN_MS * 3 })).toMatchObject({
      show: false,
      reason: 'already_asked',
    });
  });

  // The case this exists for: joining a match, joining a club and saving
  // availability inside five minutes is one person having a productive
  // session, not three invitations to grant permission.
  it('holds every other context for the cooldown', async () => {
    await markOffered('join_game', NOW);
    expect(await shouldOffer('join_club', { now: NOW + 60_000 })).toMatchObject({
      show: false,
      reason: 'cooldown',
    });
  });

  it('lets a different context ask once the cooldown has passed', async () => {
    await markOffered('join_game', NOW);
    const d = await shouldOffer('join_club', { now: NOW + COOLDOWN_MS + 1 });
    expect(d.show).toBe(true);
  });

  // Deciding is not asking. A decision that never reached a screen must not
  // burn the context.
  it('does not consume a context just by being asked about it', async () => {
    await shouldOffer('join_game', { now: NOW });
    expect((await shouldOffer('join_game', { now: NOW })).show).toBe(true);
  });
});

// ─── a context can disqualify itself ──────────────────────────────────────

describe('context preconditions', () => {
  // `fillerOpportunity` only ever goes to users with `acceptsFillerPush` on.
  // Promising it to somebody who turned it off would be a lie the backend
  // would never make good on.
  it('skips a context whose own precondition fails', async () => {
    expect(
      await shouldOffer('availability', { applicable: false, now: NOW }),
    ).toMatchObject({ show: false, reason: 'context_not_applicable' });
  });

  it('offers it when the precondition holds', async () => {
    expect((await shouldOffer('availability', { applicable: true, now: NOW })).show).toBe(
      true,
    );
  });
});

// ─── the seam ─────────────────────────────────────────────────────────────

describe('announcing a completion', () => {
  it('reaches the listener with the context', () => {
    const seen: unknown[] = [];
    setOfferListener((c, o) => seen.push([c, o]));
    announceCompleted('join_club', { applicable: true });
    expect(seen).toEqual([['join_club', { applicable: true }]]);
  });

  // The whole contract: a join that succeeded reports success even if every
  // line of the presentation layer is broken.
  it('never throws, whatever the listener does', () => {
    setOfferListener(() => {
      throw new Error('presentation exploded');
    });
    expect(() => announceCompleted('join_game')).not.toThrow();
  });

  it('is a no-op with nobody listening', () => {
    setOfferListener(null);
    expect(() => announceCompleted('join_game')).not.toThrow();
  });

  // The race the emulator caught. The commonest path in the product is
  // guest → tap join → sign in → the coordinator resumes and completes the
  // join, all inside a few hundred milliseconds — and the host only becomes
  // active once React has re-rendered with the new session. Dropping the
  // announcement would mean the context that matters most for a new person is
  // the one that never asks.
  it('holds an announcement that arrives before anyone is listening', () => {
    setOfferListener(null);
    announceCompleted('join_game', { applicable: true });

    const seen: unknown[] = [];
    setOfferListener((c, o) => seen.push([c, o]));
    expect(seen).toEqual([['join_game', { applicable: true }]]);
  });

  it('delivers a held announcement exactly once', () => {
    setOfferListener(null);
    announceCompleted('join_club');
    const seen: unknown[] = [];
    setOfferListener((c) => seen.push(c));
    setOfferListener(null);
    setOfferListener((c) => seen.push(c));
    expect(seen).toEqual(['join_club']);
  });

  // Two completions before the host is ready is one person having a fast
  // session, not two invitations. The most recent is what they are looking at.
  it('holds only the most recent', () => {
    setOfferListener(null);
    announceCompleted('join_game');
    announceCompleted('join_club');
    const seen: unknown[] = [];
    setOfferListener((c) => seen.push(c));
    expect(seen).toEqual(['join_club']);
  });
});
