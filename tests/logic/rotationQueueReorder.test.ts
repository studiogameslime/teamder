// The waiting-queue reorder guard, tested against the REAL implementation.
//
// It was briefly a copy of the rule living in the test file, which pins nothing:
// the copy and the service could drift and both stay green. It is imported now.
//
// Why the rule exists: the admin taps a list rendered a moment ago. If a round
// turned over in between, the order they send names teams that are now ON the
// pitch — writing it would return a playing team to the queue and drop a
// waiting one. Only a permutation of the queue as it stands is accepted.

import { acceptsReorder } from '@/services/rotationEngine';

describe('waiting-queue reorder guard', () => {
  it('accepts a permutation of the current queue', () => {
    expect(acceptsReorder([2, 3], [3, 2])).toBe(true);
    expect(acceptsReorder([1, 2, 3], [3, 1, 2])).toBe(true);
  });
  it('rejects an order naming a team that is no longer waiting', () => {
    // The round turned over: 0 and 1 came on, 2 and 3 went off.
    expect(acceptsReorder([0, 1], [3, 2])).toBe(false);
  });
  it('rejects a different length — a team joined or left the queue', () => {
    expect(acceptsReorder([2, 3], [2, 3, 4])).toBe(false);
    expect(acceptsReorder([2, 3, 4], [2, 3])).toBe(false);
  });
  it('treats an unchanged order as nothing to write', () => {
    expect(acceptsReorder([2, 3], [2, 3])).toBe(false);
  });
});
