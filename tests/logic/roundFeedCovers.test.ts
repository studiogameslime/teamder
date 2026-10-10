import { mergeRoundCovers, resolveRoundCover, type RoundCoverCache } from '@/utils/roundFeedCovers';

const empty: RoundCoverCache = { ownerId: 'u1', covers: {} };
const club = { id: 'club-a', coverImageId: 'c12' };
const cached: RoundCoverCache = { ownerId: 'u1', covers: { 'club-a': club } };
const fulfilled = <T,>(value: T): PromiseFulfilledResult<T> => ({ status: 'fulfilled', value });
const rejected: PromiseRejectedResult = { status: 'rejected', reason: new Error('offline') };

describe('round feed cover loading', () => {
  it('distinguishes a pending club lookup from a resolved default', () => {
    expect(resolveRoundCover('club-a', [], empty, 'u1')).toBeUndefined();
    expect(resolveRoundCover(undefined, [], empty, 'u1')).toBeNull();
    expect(resolveRoundCover('club-a', [{ id: 'club-a' }], empty, 'u1')).toEqual({ id: 'club-a' });
  });
  it('resolves from the correct club as soon as its lookup completes', () => {
    const next = mergeRoundCovers(empty, 'u1', ['club-a'], [fulfilled(club)]);
    expect(resolveRoundCover('club-a', [], next, 'u1')).toEqual(club);
    expect(resolveRoundCover('club-b', [], next, 'u1')).toBeUndefined();
  });
  it('keeps existing covers while other clubs load or fail', () => {
    const next = mergeRoundCovers(cached, 'u1', ['club-b', 'club-a'], [fulfilled({ coverImageId: 'c16' }), rejected]);
    expect(next.covers['club-a']).toEqual(club);
    expect(next.covers['club-b']).toEqual({ coverImageId: 'c16' });
    expect(cached.covers['club-b']).toBeUndefined();
  });
  it('uses a default after a missing club or first fetch failure', () => {
    const next = mergeRoundCovers(empty, 'u1', ['missing', 'offline'], [fulfilled(null), rejected]);
    expect(resolveRoundCover('missing', [], next, 'u1')).toBeNull();
    expect(resolveRoundCover('offline', [], next, 'u1')).toBeNull();
  });
  it('recovers on retry and accepts a real cover change or deletion', () => {
    let next = mergeRoundCovers(cached, 'u1', ['club-a'], [fulfilled({ coverPhotoUrl: 'https://example.invalid/upload.jpg' })]);
    expect(next.covers['club-a']?.coverPhotoUrl).toBeDefined();
    next = mergeRoundCovers(next, 'u1', ['club-a'], [fulfilled(null)]);
    expect(next.covers['club-a']).toBeNull();
    next = mergeRoundCovers(next, 'u1', ['club-a'], [fulfilled(club)]);
    expect(next.covers['club-a']).toEqual(club);
  });
  it('prefers live member data over a cached public cover', () => {
    const updated = { ...club, coverImageId: 'c15' };
    expect(resolveRoundCover('club-a', [updated], cached, 'u1')).toBe(updated);
  });
  it('never exposes or merges another account cover cache', () => {
    expect(resolveRoundCover('club-a', [], cached, 'u2')).toBeUndefined();
    const next = mergeRoundCovers(cached, 'u2', ['club-b'], [fulfilled({ coverImageId: 'c05' })]);
    expect(next.ownerId).toBe('u2');
    expect(next.covers['club-a']).toBeUndefined();
  });
});
