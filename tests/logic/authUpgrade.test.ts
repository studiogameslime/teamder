/**
 * Turning an anonymous session into a real account.
 *
 * Two cases, and the difference between them is invisible to the person:
 *
 *   A — the credential belongs to nobody. Link it, keep the uid, keep the
 *       session, keep the screen. Nothing is torn down.
 *   B — the credential is already somebody's. Sign in with it and abandon the
 *       anonymous uid. The session DOES change, which is what PendingAction and
 *       draftStore exist to survive.
 *
 * What is asserted here is mostly about what must NOT happen: a cancellation
 * must not read as a failure, a failure must not alias, and an
 * already-in-use error must not surface as an error when it has a perfectly
 * good resolution. Each of those, got wrong, is somebody losing a filled-in
 * form to a message they did not deserve.
 */

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }), { virtual: true });
jest.mock('@/firebase/config', () => ({
  USE_MOCK_DATA: false,
  getFirebase: () => ({ auth: authStub }),
}));

const logEvent = jest.fn();
jest.mock('@/services/analyticsService', () => ({
  AnalyticsEvent: new Proxy({}, { get: (_t, k) => String(k) }),
  logEvent: (...a: unknown[]) => logEvent(...a),
}));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn() }));

const bindIdentity = jest.fn();
jest.mock('@/services/joryio', () => ({
  joryio: { bindIdentity: (...a: unknown[]) => bindIdentity(...a) },
}));

const acquireGoogleCredential = jest.fn();
const acquireAppleCredential = jest.fn();
const mirrorCredentialToNativeAuth = jest.fn();
jest.mock('@/firebase/auth', () => ({
  acquireGoogleCredential: (...a: unknown[]) => acquireGoogleCredential(...a),
  acquireAppleCredential: (...a: unknown[]) => acquireAppleCredential(...a),
  mirrorCredentialToNativeAuth: (...a: unknown[]) => mirrorCredentialToNativeAuth(...a),
  currentAuthProviderId: () => 'google.com',
}));

const linkWithCredential = jest.fn();
const signInWithCredential = jest.fn();
jest.mock('firebase/auth', () => ({
  GoogleAuthProvider: {
    credential: (t: string) => ({ providerId: 'google.com', token: t }),
    credentialFromError: () => null,
  },
  OAuthProvider: class {
    credential(o: unknown) {
      return { providerId: 'apple.com', ...(o as object) };
    }
    static credentialFromError() {
      return null;
    }
  },
  EmailAuthProvider: { credential: (e: string) => ({ providerId: 'password', e }) },
  linkWithCredential: (...a: unknown[]) => linkWithCredential(...a),
  signInWithCredential: (...a: unknown[]) => signInWithCredential(...a),
}));

const authStub: { currentUser: { uid: string; isAnonymous: boolean } | null } = {
  currentUser: null,
};

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

import { upgradeAnonymous } from '@/services/authUpgrade';

const err = (code: string) => Object.assign(new Error(code), { code });

beforeEach(() => {
  jest.clearAllMocks();
  authStub.currentUser = { uid: 'anon1', isAnonymous: true };
  acquireGoogleCredential.mockResolvedValue({ idToken: 'tok' });
  acquireAppleCredential.mockResolvedValue({
    identityToken: 'atok',
    rawNonce: 'n',
    fullName: 'אליס כהן',
  });
  bindIdentity.mockResolvedValue('aliased');
});

const fired = (n: string) => logEvent.mock.calls.filter((c) => c[0] === n);

// ─── Case A ───────────────────────────────────────────────────────────────

describe('a credential nobody owns', () => {
  it('links in place and keeps the same uid', async () => {
    linkWithCredential.mockResolvedValue({ user: { uid: 'anon1' } });
    const out = await upgradeAnonymous('google');

    expect(out).toEqual({ status: 'linked', uid: 'anon1', isNewAccount: true });
    // The uid is UNCHANGED — that is the whole value of linking.
    expect(signInWithCredential).not.toHaveBeenCalled();
  });

  it('re-establishes the native session the widget and watch read', async () => {
    linkWithCredential.mockResolvedValue({ user: { uid: 'anon1' } });
    await upgradeAnonymous('google');
    expect(mirrorCredentialToNativeAuth).toHaveBeenCalledTimes(1);
  });

  it('works the same for Apple', async () => {
    linkWithCredential.mockResolvedValue({ user: { uid: 'anon1' } });
    const out = await upgradeAnonymous('apple');
    expect(out).toMatchObject({ status: 'linked', isNewAccount: true });
    expect(acquireAppleCredential).toHaveBeenCalled();
  });
});

// ─── Case B ───────────────────────────────────────────────────────────────

describe('a credential that already belongs to an account', () => {
  // Three codes mean this, not one — and each of them has a resolution, so
  // none of them may reach the person as an error.
  for (const code of [
    'auth/credential-already-in-use',
    'auth/email-already-in-use',
    'auth/provider-already-linked',
  ]) {
    it(`falls back to signing in on ${code}`, async () => {
      linkWithCredential.mockRejectedValue(err(code));
      signInWithCredential.mockResolvedValue({ user: { uid: 'existing' } });

      const out = await upgradeAnonymous('google');
      expect(out).toEqual({ status: 'switched', uid: 'existing', isNewAccount: false });
    });
  }

  it('does not ask the person to authenticate twice', async () => {
    linkWithCredential.mockRejectedValue(err('auth/credential-already-in-use'));
    signInWithCredential.mockResolvedValue({ user: { uid: 'existing' } });
    await upgradeAnonymous('google');
    // The provider was consulted ONCE; the fallback reuses the credential.
    expect(acquireGoogleCredential).toHaveBeenCalledTimes(1);
  });

  it('mirrors the native session on this path too', async () => {
    linkWithCredential.mockRejectedValue(err('auth/credential-already-in-use'));
    signInWithCredential.mockResolvedValue({ user: { uid: 'existing' } });
    await upgradeAnonymous('google');
    expect(mirrorCredentialToNativeAuth).toHaveBeenCalledTimes(1);
  });

  it('reports a failure when the fallback sign-in itself fails', async () => {
    linkWithCredential.mockRejectedValue(err('auth/credential-already-in-use'));
    signInWithCredential.mockRejectedValue(err('auth/network-request-failed'));

    const out = await upgradeAnonymous('google');
    expect(out).toMatchObject({ status: 'failed', code: 'auth/network-request-failed' });
  });
});

// ─── cancellation is not failure ──────────────────────────────────────────

describe('backing out', () => {
  // Every provider says this differently. Treating any of them as a failure
  // shows a red error for pressing Back.
  const cancels = [
    err('ERR_REQUEST_CANCELED'),
    err('ERR_CANCELED'),
    err('auth/popup-closed-by-user'),
    err('-5'),
    err('12501'),
    new Error('Sign-in cancelled'),
  ];

  for (const c of cancels) {
    it(`reads ${(c as { code?: string }).code ?? c.message} as cancelled`, async () => {
      acquireGoogleCredential.mockRejectedValue(c);
      expect(await upgradeAnonymous('google')).toEqual({ status: 'cancelled' });
    });
  }

  it('does not alias or identify on a cancellation', async () => {
    acquireGoogleCredential.mockRejectedValue(err('ERR_REQUEST_CANCELED'));
    await upgradeAnonymous('google');
    expect(bindIdentity).not.toHaveBeenCalled();
    expect(fired('IdentityAliased')).toHaveLength(0);
  });

  it('a cancellation DURING the link is still a cancellation', async () => {
    linkWithCredential.mockRejectedValue(err('auth/user-cancelled'));
    expect(await upgradeAnonymous('google')).toEqual({ status: 'cancelled' });
  });
});

// ─── real failures ────────────────────────────────────────────────────────

describe('a real failure', () => {
  it('surfaces the code and does not alias', async () => {
    acquireGoogleCredential.mockRejectedValue(err('DEVELOPER_ERROR'));
    const out = await upgradeAnonymous('google');
    expect(out).toMatchObject({ status: 'failed', code: 'DEVELOPER_ERROR' });
    expect(bindIdentity).not.toHaveBeenCalled();
  });

  // The one already-in-use-shaped code that CANNOT be resolved by retrying:
  // the address belongs to a different provider, and only that provider's
  // button will work. It must reach the person as a message, not a silent retry.
  it('reports account-exists-with-different-credential rather than retrying', async () => {
    linkWithCredential.mockRejectedValue(err('auth/account-exists-with-different-credential'));
    const out = await upgradeAnonymous('google');
    expect(out).toMatchObject({
      status: 'failed',
      code: 'auth/account-exists-with-different-credential',
    });
    expect(signInWithCredential).not.toHaveBeenCalled();
  });

  it('a link failure never aliases early', async () => {
    linkWithCredential.mockRejectedValue(err('auth/internal-error'));
    await upgradeAnonymous('google');
    expect(bindIdentity).not.toHaveBeenCalled();
  });
});

// ─── identity ─────────────────────────────────────────────────────────────

describe('Joryio identity', () => {
  it('binds exactly once on a successful link', async () => {
    linkWithCredential.mockResolvedValue({ user: { uid: 'anon1' } });
    await upgradeAnonymous('google');

    expect(bindIdentity).toHaveBeenCalledTimes(1);
    expect(bindIdentity).toHaveBeenCalledWith({ uid: 'anon1', isAnonymous: false });
    expect(fired('IdentityAliased')).toHaveLength(1);
  });

  // The existing-account path must ALSO hand over the anonymous run: the
  // browsing that led here belongs to the person who did it, whichever account
  // they turn out to already have.
  it('binds on the existing-account fallback too', async () => {
    linkWithCredential.mockRejectedValue(err('auth/credential-already-in-use'));
    signInWithCredential.mockResolvedValue({ user: { uid: 'existing' } });
    await upgradeAnonymous('google');

    expect(bindIdentity).toHaveBeenCalledWith({ uid: 'existing', isAnonymous: false });
    expect(fired('IdentityAliased')).toHaveLength(1);
  });

  it('reports nothing when the SDK says it only identified', async () => {
    bindIdentity.mockResolvedValue('identified');
    linkWithCredential.mockResolvedValue({ user: { uid: 'anon1' } });
    await upgradeAnonymous('google');
    expect(fired('IdentityAliased')).toHaveLength(0);
  });

  // Analytics identity must never be able to fail an authentication.
  it('a throwing bindIdentity does not fail the upgrade', async () => {
    bindIdentity.mockRejectedValue(new Error('sdk down'));
    linkWithCredential.mockResolvedValue({ user: { uid: 'anon1' } });
    const out = await upgradeAnonymous('google');
    expect(out).toMatchObject({ status: 'linked' });
  });
});

// ─── not anonymous ────────────────────────────────────────────────────────

describe('when there is no anonymous session to upgrade', () => {
  it('signs in plainly, so the sheet has one entry point whatever the state', async () => {
    authStub.currentUser = { uid: 'u9', isAnonymous: false };
    signInWithCredential.mockResolvedValue({ user: { uid: 'u9' } });

    const out = await upgradeAnonymous('google');
    expect(out).toMatchObject({ status: 'switched', isNewAccount: false });
    expect(linkWithCredential).not.toHaveBeenCalled();
  });

  it('and with no session at all', async () => {
    authStub.currentUser = null;
    signInWithCredential.mockResolvedValue({ user: { uid: 'u9' } });
    expect(await upgradeAnonymous('google')).toMatchObject({ status: 'switched' });
  });
});

// ─── platform ─────────────────────────────────────────────────────────────

describe('platform', () => {
  it('refuses Apple off iOS rather than guessing', async () => {
    jest.resetModules();
    jest.doMock('react-native', () => ({ Platform: { OS: 'android' } }), { virtual: true });
    const { upgradeAnonymous: fresh } = await import('@/services/authUpgrade');
    const out = await fresh('apple');
    expect(out.status).toBe('failed');
  });
});
