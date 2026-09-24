/**
 * Which completed actions earn the notification question — and which do not.
 *
 * The ordering property lives in `actionCoordinator` (see the wiring guard);
 * this is the mapping. Two things it protects:
 *
 *   • a create never announces. An organiser gets real pushes, but a create
 *     lands on a celebrating screen and a permission sheet on top of that is
 *     the bombardment this design exists to avoid.
 *   • availability carries its own precondition, because the push it promises
 *     only goes to people who left filler push on.
 */

const announceCompleted = jest.fn();
const currentUser: { value: unknown } = { value: null };

jest.mock('react-native', () => ({ Appearance: {} }), { virtual: true });
jest.mock('@/services/notificationOffer', () => ({
  announceCompleted: (...a: unknown[]) => announceCompleted(...a),
}));
jest.mock('@/store/userStore', () => ({
  useUserStore: { getState: () => ({ currentUser: currentUser.value }) },
}));

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

import { announceOfferFor } from '@/services/actionOfferBridge';

const ok = (outcome: string) =>
  ({ outcome, terminal: true }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  currentUser.value = { id: 'u1' };
});

// ─── the three that map ───────────────────────────────────────────────────

describe('a completed join', () => {
  it('announces the game context', () => {
    announceOfferFor('join_game', ok('joined'));
    expect(announceCompleted).toHaveBeenCalledWith('join_game', { applicable: true });
  });

  it('announces the club context', () => {
    announceOfferFor('join_club', ok('joined'));
    expect(announceCompleted).toHaveBeenCalledWith('join_club', { applicable: true });
  });

  // Being told a place opened up is the whole reason a waitlist is bearable,
  // so these count at least as much as a straight join.
  it.each(['waitlisted', 'approval_pending'])('counts %s too', (outcome) => {
    announceOfferFor('join_game', ok(outcome));
    expect(announceCompleted).toHaveBeenCalled();
  });
});

// ─── the ones that deliberately do not ────────────────────────────────────

describe('a create', () => {
  it.each(['create_club', 'create_game'])('%s announces nothing', (kind) => {
    announceOfferFor(kind as never, ok('created'));
    expect(announceCompleted).not.toHaveBeenCalled();
  });
});

describe('a navigate-only kind', () => {
  it.each(['open_game', 'open_club', 'open_invite'])('%s announces nothing', (kind) => {
    announceOfferFor(kind as never, ok('navigated'));
    expect(announceCompleted).not.toHaveBeenCalled();
  });
});

// ─── only a real outcome ──────────────────────────────────────────────────

describe('an action that did not actually land', () => {
  it('says nothing when the outcome is not terminal', () => {
    announceOfferFor('join_game', { outcome: 'joined', terminal: false } as never);
    expect(announceCompleted).not.toHaveBeenCalled();
  });

  // `reason` present means the outcome was not reached — a rejected join is
  // not a moment to ask somebody for permission.
  it('says nothing when the result carries a failure reason', () => {
    announceOfferFor('join_game', {
      outcome: 'joined',
      terminal: true,
      reason: 'game_join_rejected',
    } as never);
    expect(announceCompleted).not.toHaveBeenCalled();
  });

  it('says nothing for a navigated outcome', () => {
    announceOfferFor('join_game', ok('navigated'));
    expect(announceCompleted).not.toHaveBeenCalled();
  });
});

// ─── availability tells the truth about itself ────────────────────────────

describe('availability', () => {
  it('is applicable when filler push is on', () => {
    currentUser.value = { id: 'u1', availability: { acceptsFillerPush: true } };
    announceOfferFor('save_availability', ok('created'));
    expect(announceCompleted).toHaveBeenCalledWith('availability', { applicable: true });
  });

  // The copy promises `fillerOpportunity`, and that only ever goes to people
  // with the toggle on. Saying it to anybody else is a promise the backend
  // will not keep.
  it('is not applicable when they turned filler push off', () => {
    currentUser.value = { id: 'u1', availability: { acceptsFillerPush: false } };
    announceOfferFor('save_availability', ok('created'));
    expect(announceCompleted).toHaveBeenCalledWith('availability', { applicable: false });
  });

  it('treats an absent preference as not applicable', () => {
    currentUser.value = { id: 'u1' };
    announceOfferFor('save_availability', ok('created'));
    expect(announceCompleted).toHaveBeenCalledWith('availability', { applicable: false });
  });
});
