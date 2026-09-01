// Regression guard for the double-credited mini-game.
//
// The round-end commit's idempotency key used to be `${round}:${updatedAt}`.
// The comment at the call site claimed it was "identical on an SDK retry of the
// same round" — it was not. `rotation.updatedAt` is restamped MID-ROUND by
// markPlayerWentHome / movePlayerToTeam / removePlayerFromTeams (each when the
// player held a loan) and unconditionally by reorderWaiting. So:
//
//   commit succeeds server-side → response lost → a substitution happens →
//   admin presses "סיים משחק" again → DIFFERENT key → the committedRounds latch
//   does not fire → the whole mini-game is credited twice: rounds, wins/losses,
//   GF/GA, clean sheets, pair stats, plus a duplicate roundHistory doc that the
//   club-chemistry rollup then ingests as a second real mini-game.
//
// These tests pin the property that fixes it: the same live round always
// produces the same key, and a new round never reuses the old one.

jest.mock('@/firebase/config', () => ({
  getFirebase: jest.fn(),
  USE_MOCK_DATA: false,
}));

import {
  resolveRoundInstance,
  roundCommitKey,
  defaultRoundInstanceId,
  recordWinner,
  startRotation,
  type RotationTeam,
} from '@/services/rotationEngine';
import { readRotation } from '@/firebase/firestore';
import type { MatchRotation } from '@/types';

const pickFirst = <T,>(arr: T[], n: number): T[] => arr.slice(0, n);

/** A rotation as it stands mid-round, already stamped. */
const liveRound = (over: Partial<MatchRotation> = {}): MatchRotation => ({
  playing: [0, 1],
  waiting: [2],
  loans: [],
  wins: {},
  round: 3,
  roundInstanceId: 'r_fixed_abc',
  roundInstanceRound: 3,
  updatedAt: 1_000,
  ...over,
});

describe('the key is stable across everything that moves mid-round', () => {
  it('1. survives a change to rotation.updatedAt — the exact bug', () => {
    const before = liveRound({ updatedAt: 1_000 });
    // reorderWaiting restamps updatedAt unconditionally.
    const after = liveRound({ updatedAt: 9_999 });
    expect(roundCommitKey(after)).toBe(roundCommitKey(before));
  });

  it('2. survives a mid-round fill (rotation rewritten, round unchanged)', () => {
    const before = liveRound();
    // The fill flow persists `{...currentRotation, loans}`; the funnel then
    // re-stamps through resolveRoundInstance, which must PRESERVE here.
    const filled = { ...before, loans: [{ playerId: 'p9', homeTeam: 2, filledTeam: 0 }] };
    const stamped = { ...filled, ...resolveRoundInstance(filled) };
    expect(roundCommitKey(stamped)).toBe(roundCommitKey(before));
  });

  it('3. survives a go-home that drops a loan and restamps updatedAt', () => {
    const before = liveRound({
      loans: [{ playerId: 'p9', homeTeam: 2, filledTeam: 0 }],
      updatedAt: 1_000,
    });
    const afterGoHome = { ...before, loans: [], updatedAt: 2_500 };
    const stamped = { ...afterGoHome, ...resolveRoundInstance(afterGoHome) };
    expect(roundCommitKey(stamped)).toBe(roundCommitKey(before));
  });

  it('4. is identical on a plain retry of the very same rotation', () => {
    const rot = liveRound();
    expect(roundCommitKey(rot)).toBe(roundCommitKey(rot));
  });

  it('5. two fast "end round" taps derive one key, so one commit wins', () => {
    const rot = liveRound();
    const tapA = roundCommitKey(rot);
    const tapB = roundCommitKey({ ...rot });
    expect(tapA).toBe(tapB);
  });
});

describe('a new round is a new identity', () => {
  it('6. mints a fresh id when the round number advances', () => {
    const r3 = liveRound({ round: 3, roundInstanceRound: 3 });
    const r4 = { ...r3, round: 4 };
    const stamped = { ...r4, ...resolveRoundInstance(r4) };
    expect(stamped.roundInstanceId).not.toBe(r3.roundInstanceId);
    expect(stamped.roundInstanceRound).toBe(4);
  });

  it('7. re-mints an id INHERITED by the engine\'s spreading branch', () => {
    // recordWinnerSkeleton has two branches and one builds the next round by
    // spreading the current rotation — so an id can arrive attached to a round
    // it was never minted for. Comparing the round number is what catches it.
    const inherited = { round: 4, roundInstanceId: 'r_from_round_3', roundInstanceRound: 3 };
    const out = resolveRoundInstance(inherited);
    expect(out.roundInstanceId).not.toBe('r_from_round_3');
    expect(out.roundInstanceRound).toBe(4);
  });

  it('8. the previous round\'s lock cannot block the next round', () => {
    const r3 = liveRound({ round: 3, roundInstanceRound: 3 });
    const r4 = { ...r3, round: 4 };
    const k3 = roundCommitKey(r3);
    const k4 = roundCommitKey({ ...r4, ...resolveRoundInstance(r4) });
    expect(k4).not.toBe(k3);
  });

  it('9. every real round transition through the engine yields a new key', () => {
    const teams: RotationTeam[] = [
      { index: 0, playerIds: ['a', 'b'] },
      { index: 1, playerIds: ['c', 'd'] },
      { index: 2, playerIds: ['e', 'f'] },
    ];
    const start = startRotation(teams, 2, 'temporary', pickFirst)!;
    let rot = { ...start.rotation, ...resolveRoundInstance(start.rotation) };
    const keys = new Set<string>([roundCommitKey(rot)]);
    for (let i = 0; i < 4; i++) {
      const next = recordWinner(rot.playing[0], teams, rot, 2, 'temporary', pickFirst);
      rot = { ...next.rotation, ...resolveRoundInstance(next.rotation) };
      keys.add(roundCommitKey(rot));
    }
    // 5 distinct mini-games → 5 distinct keys. A collision here would silently
    // block a real round's stats; a leak would double-credit one.
    expect(keys.size).toBe(5);
  });
});

describe('the identity survives storage and restart', () => {
  it('10. readRotation keeps the field — the deserializer-strip trap', () => {
    // This reader rebuilds the rotation field by field. A field it does not
    // name is dropped on read no matter what was written, which would make the
    // whole fix a silent no-op after any reload.
    const back = readRotation({
      playing: [0, 1],
      waiting: [2],
      loans: [],
      round: 3,
      roundInstanceId: 'r_persisted',
      roundInstanceRound: 3,
      updatedAt: 1_000,
    });
    expect(back?.roundInstanceId).toBe('r_persisted');
    expect(back?.roundInstanceRound).toBe(3);
  });

  it('11. a reconnect mid-round re-derives the same key', () => {
    const written = liveRound();
    const reloaded = readRotation({ ...written })!;
    expect(roundCommitKey(reloaded)).toBe(roundCommitKey(written));
  });
});

describe('backward compatibility', () => {
  it('12. a rotation predating the field still produces a usable key', () => {
    const legacy = { round: 2, updatedAt: 4_242 } as MatchRotation;
    expect(roundCommitKey(legacy)).toBe('2:4242');
  });

  it('13. legacy keys stay distinct per round, as they were', () => {
    expect(roundCommitKey({ round: 2, updatedAt: 1 })).not.toBe(
      roundCommitKey({ round: 3, updatedAt: 1 }),
    );
  });

  it('14. the stable id wins over the legacy formula once present', () => {
    expect(roundCommitKey({ round: 2, updatedAt: 4_242, roundInstanceId: 'r_x' })).toBe('r_x');
  });
});

describe('the minted id itself', () => {
  it('15. is not derived from any mutable field, and does not collide', () => {
    const ids = new Set(Array.from({ length: 500 }, () => defaultRoundInstanceId()));
    expect(ids.size).toBe(500);
  });
});
