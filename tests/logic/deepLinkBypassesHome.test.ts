/**
 * A link goes to the thing it names — not to Home.
 *
 * The Option A Home is ORGANIC entry: it is the answer to "somebody opened the
 * app with nothing to consume". A person who tapped a link to a specific match
 * already told us what they came for, and putting a "what do you want to do?"
 * screen in front of that answer would be the app ignoring them.
 *
 * Structurally this holds because `navigateInvite` addresses the tabs that own
 * those screens — GameTab, CommunitiesTab — and the Home lives in ProfileTab.
 * It is one edited string away from not holding, which is why it is asserted
 * rather than assumed.
 */

const navigate = jest.fn();
const isReady = jest.fn<boolean, []>(() => true);

jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }), {
  virtual: true,
});
jest.mock('@react-navigation/native', () => ({
  createNavigationContainerRef: () => ({
    isReady: () => isReady(),
    navigate: (...a: unknown[]) => navigate(...a),
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
