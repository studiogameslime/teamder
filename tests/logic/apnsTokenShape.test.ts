// The shape rule that decides whether a stored token is deliverable.
//
// It exists because the two token formats are indistinguishable to our sender:
// both are opaque strings, and admin.messaging() answers a raw APNs token with
// INVALID_ARGUMENT — the same code a malformed MESSAGE returns. So the sender
// cannot safely prune on the error, and the client prunes on the shape instead.
const looksLikeApnsToken = (token: string): boolean => /^[0-9a-f]{64}$/i.test(token);

describe('looksLikeApnsToken', () => {
  it('catches the real production tokens that were never deliverable', () => {
    // Verbatim shapes measured on production 2026-08-27 (truncated only here).
    for (const t of [
      '1db25ac18a5ed719cffecebd6d206bfbc00814c6bea4c11827a3660896aa11bd',
      'AFA8408DB871BABBD78CCB18F154B32FD1713F9B401C282E2E77124FEDAA9C31',
    ]) {
      expect(t).toHaveLength(64);
      expect(looksLikeApnsToken(t)).toBe(true);
    }
  });

  it('never touches a real FCM token', () => {
    // The shape of all 208 tokens that validated: <instance-id>:APA91b…
    expect(
      looksLikeApnsToken('fH3kQ2sTRr2abcDEF:APA91bF-3xQmS0pLk9dGeXampleTokenValue'),
    ).toBe(false);
  });

  it('is anchored, so a 64-hex run inside a longer token is not a match', () => {
    const hex64 = 'a'.repeat(64);
    expect(looksLikeApnsToken(hex64)).toBe(true);
    // Without ^…$ this would have pruned a valid token that merely contains
    // one — which would silently unsubscribe a reachable device.
    expect(looksLikeApnsToken(`id:${hex64}`)).toBe(false);
    expect(looksLikeApnsToken(`${hex64}x`)).toBe(false);
  });

  it('does not match near-misses in length or alphabet', () => {
    expect(looksLikeApnsToken('a'.repeat(63))).toBe(false);
    expect(looksLikeApnsToken('a'.repeat(65))).toBe(false);
    // 'g' is not hex.
    expect(looksLikeApnsToken('g'.repeat(64))).toBe(false);
    expect(looksLikeApnsToken('')).toBe(false);
  });
});
