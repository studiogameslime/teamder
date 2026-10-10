/** Official SDK: identify links anonymous history; reset separates accounts. */

jest.mock(
  'react-native',
  () => ({ Platform: { OS: 'ios', Version: '17.0', select: (o: Record<string, unknown>) => o.ios ?? o.default } }),
  { virtual: true },
);
jest.mock(
  'expo-constants',
  () => ({ __esModule: true, default: { expoConfig: { version: '1.1.14' } } }),
  { virtual: true },
);
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false }));
jest.mock('@/services/errorLog', () => ({ logUnexpected: jest.fn() }));

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const sdk = {
  initialize: jest.fn().mockResolvedValue(undefined),
  identify: jest.fn(),
  alias: jest.fn(),
  setAttributes: jest.fn(),
  reset: jest.fn(),
};
jest.mock('@joryio/react-native-sdk', () => ({ __esModule: true, default: sdk }), {
  virtual: true,
});

import {
  bindIdentity,
  resetIdentity,
  __resetIdentityStateForTests,
} from '@/services/joryio';

const GUEST = { uid: 'anon-abc', isAnonymous: true };
const ALICE = { uid: 'uid-alice', isAnonymous: false, email: 'a@x.com', name: 'Alice' };
const BOB = { uid: 'uid-bob', isAnonymous: false, email: 'b@x.com', name: 'Bob' };

beforeEach(() => {
  sdk.identify.mockReset();
  sdk.alias.mockReset();
  sdk.setAttributes.mockReset();
  sdk.reset.mockReset();
  __resetIdentityStateForTests();
});

/** Order of the two identity calls across the whole run. */
function callOrder(): string[] {
  const out: Array<{ at: number; what: string }> = [];
  sdk.alias.mock.invocationCallOrder.forEach((n, i) =>
    out.push({ at: n, what: `alias(${sdk.alias.mock.calls[i][0]})` }),
  );
  sdk.identify.mock.invocationCallOrder.forEach((n, i) =>
    out.push({ at: n, what: `identify(${sdk.identify.mock.calls[i][0]})` }),
  );
  return out.sort((a, b) => a.at - b.at).map((x) => x.what);
}

// ─── 1 · never identify an anonymous uid ──────────────────────────────────

describe('a guest', () => {
  it('is not identified and not aliased', async () => {
    expect(await bindIdentity(GUEST)).toBe('none');
    expect(sdk.identify).not.toHaveBeenCalled();
    expect(sdk.alias).not.toHaveBeenCalled();
  });

  it('stays unidentified across many emissions', async () => {
    for (let i = 0; i < 5; i++) await bindIdentity(GUEST);
    expect(sdk.identify).not.toHaveBeenCalled();
    expect(sdk.alias).not.toHaveBeenCalled();
  });

  it('a null user is a no-op too', async () => {
    expect(await bindIdentity(null)).toBe('none');
    expect(sdk.identify).not.toHaveBeenCalled();
  });

  it('an empty uid is a no-op', async () => {
    expect(await bindIdentity({ uid: '', isAnonymous: false })).toBe('none');
    expect(sdk.identify).not.toHaveBeenCalled();
  });
});

// ─── the upgrade ──────────────────────────────────────────────────────────

describe('guest → account, in one session', () => {
  it('identifies once using the official anonymous linking flow', async () => {
    await bindIdentity(GUEST);
    expect(await bindIdentity(ALICE)).toBe('aliased');
    expect(callOrder()).toEqual(['identify(uid-alice)']);
  });

  it('passes the real uid to identify, never the Firebase anonymous uid', async () => {
    await bindIdentity(GUEST);
    await bindIdentity(ALICE);
    expect(sdk.identify).toHaveBeenCalledTimes(1);
    expect(sdk.identify).toHaveBeenCalledWith('uid-alice');
    expect(sdk.identify).not.toHaveBeenCalledWith('anon-abc');
  });

  it('carries the profile attributes through identify', async () => {
    await bindIdentity(GUEST);
    await bindIdentity(ALICE);
    expect(sdk.identify).toHaveBeenCalledWith('uid-alice');
    expect(sdk.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@x.com', name: 'Alice' }),
    );
  });

  it('aliases once even after a long anonymous run', async () => {
    for (let i = 0; i < 10; i++) await bindIdentity(GUEST);
    await bindIdentity(ALICE);
    expect(sdk.identify).toHaveBeenCalledTimes(1);
  });
});

// ─── 3 · no alias on a plain restore ──────────────────────────────────────

describe('an existing account on cold start', () => {
  // No anonymous run happened in this process, so there is nothing to claim.
  it('identifies without aliasing', async () => {
    expect(await bindIdentity(ALICE)).toBe('identified');
    expect(sdk.identify).toHaveBeenCalledWith('uid-alice');
    expect(sdk.alias).not.toHaveBeenCalled();
  });

  it('still does not alias after repeated restores', async () => {
    await bindIdentity(ALICE);
    await bindIdentity(ALICE);
    await bindIdentity(ALICE);
    expect(sdk.alias).not.toHaveBeenCalled();
  });
});

// ─── 2 · no duplicate identify ────────────────────────────────────────────

describe('token refresh re-emissions', () => {
  it('identifies the same person exactly once', async () => {
    expect(await bindIdentity(ALICE)).toBe('identified');
    expect(await bindIdentity(ALICE)).toBe('none');
    expect(await bindIdentity(ALICE)).toBe('none');
    expect(sdk.identify).toHaveBeenCalledTimes(1);
  });

  it('an anonymous emission after an identify does not re-identify', async () => {
    await bindIdentity(ALICE);
    await bindIdentity(GUEST);
    await bindIdentity(ALICE);
    expect(sdk.identify).toHaveBeenCalledTimes(1);
  });

  it('a different person IS identified', async () => {
    await bindIdentity(ALICE);
    expect(await bindIdentity(BOB)).toBe('identified');
    expect(sdk.identify).toHaveBeenCalledTimes(2);
  });
});

// ─── 4 · sign out must not merge two people ───────────────────────────────

describe('sign out, then somebody else signs in', () => {
  it('resetIdentity starts a fresh anonymous session', () => {
    resetIdentity();
    expect(sdk.reset).toHaveBeenCalledTimes(1);
  });

  // The whole point of the reset. Without it, Alice's anonymous history would
  // be aliased onto Bob.
  it('does not alias Bob onto the session that was Alice', async () => {
    await bindIdentity(GUEST);
    await bindIdentity(ALICE);
    expect(sdk.identify).toHaveBeenCalledTimes(1);

    resetIdentity();
    sdk.alias.mockReset();

    await bindIdentity(BOB);
    expect(sdk.alias).not.toHaveBeenCalled();
    expect(sdk.identify).toHaveBeenLastCalledWith('uid-bob');
  });

  it('re-identifies the SAME person after a sign-out and back in', async () => {
    await bindIdentity(ALICE);
    expect(sdk.identify).toHaveBeenCalledTimes(1);
    resetIdentity();
    // The SDK forgot her, so binding again must actually re-identify.
    await bindIdentity(ALICE);
    expect(sdk.identify).toHaveBeenCalledTimes(2);
  });

  // After the reset the new anonymous session belongs to whoever is here NOW,
  // so browsing before signing in as Bob is correctly attributed to Bob.
  it('a guest run AFTER the reset is aliased to the next person', async () => {
    await bindIdentity(ALICE);
    resetIdentity();
    sdk.alias.mockReset();
    await bindIdentity(GUEST);
    expect(await bindIdentity(BOB)).toBe('aliased');
    expect(sdk.identify).toHaveBeenLastCalledWith('uid-bob');
    expect(sdk.alias).not.toHaveBeenCalled();
  });
});

// ─── failure posture ──────────────────────────────────────────────────────

describe('when the SDK throws', () => {
  it('reports none and does not propagate', async () => {
    sdk.identify.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(await bindIdentity(ALICE)).toBe('none');
  });

  // A throw must not leave the module believing the person is bound, or the
  // retry on the next emission would be skipped.
  it('leaves the person unbound so the next emission retries', async () => {
    sdk.identify.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await bindIdentity(ALICE);
    expect(await bindIdentity(ALICE)).toBe('identified');
    expect(sdk.identify).toHaveBeenCalledTimes(2);
  });
});
