/**
 * A link opens the thing it names — not Home.
 *
 * ─── What this file does and does not say any more ──────────────────────
 *
 * It used to argue that a link should skip the entry flow entirely. That is no
 * longer the product: a NEW person who follows an invitation meets Welcome and
 * the intent question first, with the invitation offered as a card at the top
 * (see `tests/entryOnboarding.test.ts`). Only once they accept it — or once
 * they are past onboarding — does this consumer run.
 *
 * What still holds, and is what these assertions are actually about, is where
 * it lands WHEN it runs: `navigateInvite` addresses the tabs that own those
 * screens — GameTab, CommunitiesTab — and never ProfileTab, where Home lives.
 * It is one edited string away from not holding, which is why it is asserted
 * rather than assumed.
 */

const navigate = jest.fn();
const isReady = jest.fn<boolean, []>(() => true);
// The tab names the root navigator currently owns. `navigateInvite` addresses
// a tab BY NAME, and a navigate into a navigator that is not mounted is a
// silent no-op — so the helper now checks before claiming success, and this
// mock has to answer that check. Empty = MainTabs is not on screen (the entry
// stack or a splash is).
const routeNames = jest.fn<string[], []>(() => [
  'ProfileTab',
  'CommunitiesTab',
  'GameTab',
  'ChatTab',
]);

jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }), {
  virtual: true,
});
jest.mock('@react-navigation/native', () => ({
  createNavigationContainerRef: () => ({
    isReady: () => isReady(),
    navigate: (...a: unknown[]) => navigate(...a),
    getRootState: () => ({ routeNames: routeNames() }),
  }),
}));
jest.mock('@/services/analyticsService', () => ({
  AnalyticsEvent: new Proxy({}, { get: (_t, k) => String(k) }),
  logEvent: jest.fn(),
}));

import { navigateInvite } from '@/navigation/navigationRef';

beforeEach(() => {
  jest.clearAllMocks();
  isReady.mockReturnValue(true);
  routeNames.mockReturnValue([
    'ProfileTab',
    'CommunitiesTab',
    'GameTab',
    'ChatTab',
  ]);
});

const target = () => navigate.mock.calls[0];

// ─── games ────────────────────────────────────────────────────────────────

describe('a game link', () => {
  it('opens the match, inside the games tab', () => {
    expect(navigateInvite({ type: 'session', id: 'g1' })).toBe(true);
    const [tab, opts] = target();
    expect(tab).toBe('GameTab');
    expect(opts).toMatchObject({
      screen: 'MatchDetails',
      params: { gameId: 'g1' },
    });
  });

  it('does not touch the tab that hosts Home', () => {
    navigateInvite({ type: 'session', id: 'g1' });
    expect(target()[0]).not.toBe('ProfileTab');
  });
});

// ─── clubs ────────────────────────────────────────────────────────────────

describe('a club link', () => {
  it('opens the public club for somebody who is not a member', () => {
    navigateInvite({ type: 'team', id: 'c1', isMember: false });
    const [tab, opts] = target();
    expect(tab).toBe('CommunitiesTab');
    expect(opts).toMatchObject({
      screen: 'CommunityDetailsPublic',
      params: { groupId: 'c1' },
    });
  });

  it('opens the full club for a member', () => {
    navigateInvite({ type: 'team', id: 'c1', isMember: true });
    expect(target()[1]).toMatchObject({ screen: 'CommunityDetails' });
  });

  it('does not touch the tab that hosts Home', () => {
    navigateInvite({ type: 'team', id: 'c1' });
    expect(target()[0]).not.toBe('ProfileTab');
  });
});

// ─── the navigator not being ready is not a silent detour ─────────────────

describe('before the navigator is ready', () => {
  // Returning false is what lets App.tsx HOLD the link and replay it. Silently
  // doing nothing would strand the person on whatever rendered first — which,
  // for a fresh install, is now the Home this file exists to keep out of the
  // way.
  it('reports failure rather than navigating anywhere', () => {
    isReady.mockReturnValue(false);
    expect(navigateInvite({ type: 'session', id: 'g1' })).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});

// ─── and it does not pretend ──────────────────────────────────────────────

describe('when the tabs are not on screen', () => {
  // The organic entry gate can render Welcome — or the splash while it
  // resolves — INSTEAD of MainTabs. A `navigate('GameTab', …)` at that moment
  // is a no-op React Navigation only logs. The old helper returned true
  // anyway, and its callers read that as "landed": the stash gets cleared and
  // the personal-invite latch gets set, so the thing the person tapped is lost
  // with no error anywhere.
  it('reports failure so the caller keeps its stash', () => {
    routeNames.mockReturnValue([]);
    expect(navigateInvite({ type: 'session', id: 'g1' })).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
