// Unit tests for the per-community card lifecycle logic (src/utils/cardState).
// This is the correctness core of the red-card block + timeline state tags, so
// it's worth pinning: snapshot-preference, expiry boundary, and revoke.
import {
  DAY_MS,
  activeUntil,
  effectiveExpiry,
  cardState,
  isActiveRedCard,
} from '@/utils/cardState';
import type { CommunityPlayerEvent } from '@/types';

const NOW = 1_000_000_000_000; // fixed "now" for determinism
const card = (over: Partial<CommunityPlayerEvent> = {}): CommunityPlayerEvent => ({
  id: 'e1',
  groupId: 'g1',
  userId: 'u1',
  type: 'red',
  at: NOW,
  ...over,
});

describe('activeUntil', () => {
  it('returns at + days for a positive validity', () => {
    expect(activeUntil(NOW, 7)).toBe(NOW + 7 * DAY_MS);
  });
  it('returns null for null / undefined / non-positive validity', () => {
    expect(activeUntil(NOW, null)).toBeNull();
    expect(activeUntil(NOW, undefined)).toBeNull();
    expect(activeUntil(NOW, 0)).toBeNull();
    expect(activeUntil(NOW, -5)).toBeNull();
  });
});

describe('effectiveExpiry — snapshot preference', () => {
  it('prefers the snapshotted expiresAt (number) over the live validity', () => {
    const ev = card({ at: NOW, expiresAt: NOW + 3 * DAY_MS });
    // Live validity says 90 days, but the snapshot wins.
    expect(effectiveExpiry(ev, 90)).toBe(NOW + 3 * DAY_MS);
  });
  it('honors an explicit expiresAt === null as "no expiry" (not a fallback)', () => {
    const ev = card({ at: NOW, expiresAt: null });
    // Even though the club later set a 7-day validity, this card never expires.
    expect(effectiveExpiry(ev, 7)).toBeNull();
  });
  it('falls back to live validity for a legacy card missing expiresAt', () => {
    const ev = card({ at: NOW }); // expiresAt undefined
    expect(effectiveExpiry(ev, 7)).toBe(NOW + 7 * DAY_MS);
    expect(effectiveExpiry(ev, null)).toBeNull();
  });
});

describe('cardState', () => {
  it('revoked beats everything', () => {
    const ev = card({ revoked: true, expiresAt: NOW - DAY_MS });
    expect(cardState(ev, 7, NOW)).toBe('revoked');
  });
  it('active while now <= expiry', () => {
    const ev = card({ expiresAt: NOW + DAY_MS });
    expect(cardState(ev, 7, NOW)).toBe('active');
  });
  it('expired once now > expiry', () => {
    const ev = card({ expiresAt: NOW - 1 });
    expect(cardState(ev, 7, NOW)).toBe('expired');
  });
  it('is active exactly AT the expiry boundary (now === expiry)', () => {
    const ev = card({ expiresAt: NOW });
    expect(cardState(ev, 7, NOW)).toBe('active'); // strictly `now > exp` expires
  });
  it('no-expiry card (expiresAt null) stays active indefinitely', () => {
    const ev = card({ expiresAt: null, at: NOW - 999 * DAY_MS });
    expect(cardState(ev, 7, NOW)).toBe('active');
  });
  it('editing the club validity does NOT resurrect a snapshotted-expired card', () => {
    const ev = card({ at: NOW - 10 * DAY_MS, expiresAt: NOW - 3 * DAY_MS });
    // Club raises validity to 90d after the fact; snapshot keeps it expired.
    expect(cardState(ev, 90, NOW)).toBe('expired');
  });
});

describe('isActiveRedCard', () => {
  it('true for an active red card', () => {
    expect(isActiveRedCard(card({ type: 'red', expiresAt: NOW + DAY_MS }), 7, NOW)).toBe(true);
  });
  it('false for an expired red card', () => {
    expect(isActiveRedCard(card({ type: 'red', expiresAt: NOW - 1 }), 7, NOW)).toBe(false);
  });
  it('false for a revoked red card', () => {
    expect(isActiveRedCard(card({ type: 'red', revoked: true, expiresAt: NOW + DAY_MS }), 7, NOW)).toBe(false);
  });
  it('false for a yellow card even when active (yellow never blocks)', () => {
    expect(isActiveRedCard(card({ type: 'yellow', expiresAt: NOW + DAY_MS }), 7, NOW)).toBe(false);
  });
  it('active red with no expiry blocks forever until revoked', () => {
    expect(isActiveRedCard(card({ type: 'red', expiresAt: null }), null, NOW)).toBe(true);
  });
});
