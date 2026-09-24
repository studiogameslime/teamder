/**
 * The stash that has to survive an interruption — and the legacy key it must
 * not break on the way.
 *
 * `footy.invite.pending` has three readers, and two of them are not the
 * navigator: `applyInviteAttributionIfFresh` and `applyAcquisitionIfFresh` in
 * `src/services/userService.ts` both read it on every sign-in and write
 * `invitedBy` / `acquisition` onto a brand-new user doc. A destructive
 * migration would stop referral attribution dead with no error anywhere, for
 * every install that happened to have an invite stashed. Hence the projection
 * back onto the old key, and hence the `attribution compatibility` block below:
 * those cases assert the exact shape those two functions destructure.
 */

jest.mock('@react-native-async-storage/async-storage', () => {
  const mem = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: (k: string) => Promise.resolve(mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => {
        mem.set(k, v);
        return Promise.resolve();
      },
      removeItem: (k: string) => {
        mem.delete(k);
        return Promise.resolve();
      },
      __mem: mem,
    },
  };
});

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PENDING_ACTION_VERSION,
  fromLegacyInvite,
  toLegacyInvite,
  parsePendingAction,
  readPendingAction,
  writePendingAction,
  clearPendingAction,
  consumePendingAction,
  isTargeted,
  isDrafted,
  isOpenKind,
  type PendingAction,
} from '@/services/pendingAction';
import type { PendingInvite } from '@/services/storage';

const NEW_KEY = 'footy.pending.action';
const LEGACY_KEY = 'footy.invite.pending';
const NOW = 1_700_000_000_000;

const mem = (AsyncStorage as unknown as { __mem: Map<string, string> }).__mem;

beforeEach(() => mem.clear());

const raw = (k: string) => mem.get(k) ?? null;
const json = (k: string) => {
  const v = raw(k);
  return v === null ? null : JSON.parse(v);
};

// ─── legacy → new ─────────────────────────────────────────────────────────

describe('fromLegacyInvite', () => {
  it('maps every legacy type to its kind', () => {
    expect(fromLegacyInvite({ type: 'session', id: 'g1' }, NOW)).toMatchObject({
      kind: 'open_game',
      targetId: 'g1',
    });
    expect(fromLegacyInvite({ type: 'team', id: 'c1' }, NOW)).toMatchObject({
      kind: 'open_club',
    });
    expect(fromLegacyInvite({ type: 'app' }, NOW)).toMatchObject({
      kind: 'open_invite',
    });
  });

  it('stamps version, origin and the injected clock', () => {
    expect(fromLegacyInvite({ type: 'app' }, NOW)).toMatchObject({
      version: PENDING_ACTION_VERSION,
      createdAt: NOW,
      origin: 'deep_link',
    });
  });

  it('carries invitedBy across', () => {
    const out = fromLegacyInvite({ type: 'session', id: 'g1', invitedBy: 'u9' }, NOW);
    expect(out.invitedBy).toBe('u9');
  });

  it('carries the whole acquisition tag across', () => {
    const out = fromLegacyInvite(
      { type: 'team', id: 'c1', source: 'whatsapp', campaign: 'sep', linkId: 'al_7' },
      NOW,
    );
    expect(out.acquisition).toEqual({
      source: 'whatsapp',
      campaign: 'sep',
      linkId: 'al_7',
    });
  });

  it('omits acquisition entirely when the link carried none', () => {
    expect(fromLegacyInvite({ type: 'app' }, NOW)).not.toHaveProperty('acquisition');
  });

  it('does not invent an inviter', () => {
    expect(fromLegacyInvite({ type: 'session', id: 'g1' }, NOW)).not.toHaveProperty(
      'invitedBy',
    );
  });
});

// ─── new → legacy (the compatibility adapter) ─────────────────────────────

describe('toLegacyInvite', () => {
  const base = { version: PENDING_ACTION_VERSION, createdAt: NOW, origin: 'in_app' as const };

  it('projects game kinds onto type session', () => {
    expect(toLegacyInvite({ ...base, kind: 'open_game', targetId: 'g1' })).toEqual({
      type: 'session',
      id: 'g1',
    });
    expect(toLegacyInvite({ ...base, kind: 'join_game', targetId: 'g1' })).toEqual({
      type: 'session',
      id: 'g1',
    });
  });

  it('projects club kinds onto type team', () => {
    expect(toLegacyInvite({ ...base, kind: 'open_club', targetId: 'c1' })).toEqual({
      type: 'team',
      id: 'c1',
    });
    expect(toLegacyInvite({ ...base, kind: 'join_club', targetId: 'c1' })).toEqual({
      type: 'team',
      id: 'c1',
    });
  });

  // A drafted action has no legacy equivalent, but it can still carry a
  // referral — and `type: 'app'` means precisely "credit this inviter,
  // navigate nowhere", which is the correct legacy reading.
  it('projects a drafted action with an inviter onto type app', () => {
    expect(
      toLegacyInvite({
        ...base,
        kind: 'create_club',
        draftId: 'd1',
        invitedBy: 'u9',
      }),
    ).toEqual({ type: 'app', invitedBy: 'u9' });
  });

  it('returns null for a drafted action with nothing to attribute', () => {
    expect(
      toLegacyInvite({ ...base, kind: 'create_club', draftId: 'd1' }),
    ).toBeNull();
    expect(
      toLegacyInvite({ ...base, kind: 'save_availability', draftId: 'd2' }),
    ).toBeNull();
  });

  it('keeps a drafted action that carries only an acquisition tag', () => {
    expect(
      toLegacyInvite({
        ...base,
        kind: 'create_game',
        draftId: 'd1',
        acquisition: { source: 'facebook' },
      }),
    ).toEqual({ type: 'app', source: 'facebook' });
  });

  it('round-trips a legacy invite unchanged', () => {
    const shapes: PendingInvite[] = [
      { type: 'session', id: 'g1' },
      { type: 'session', id: 'g1', invitedBy: 'u9' },
      { type: 'team', id: 'c1', source: 'whatsapp', campaign: 'sep', linkId: 'al_1' },
      { type: 'app', invitedBy: 'u9' },
    ];
    for (const s of shapes) {
      expect(toLegacyInvite(fromLegacyInvite(s, NOW))).toEqual(s);
    }
  });
});

// ─── attribution compatibility ────────────────────────────────────────────
//
// These assert the exact fields `applyInviteAttributionIfFresh` and
// `applyAcquisitionIfFresh` destructure. If one of them ever fails, referral
// attribution is broken in production and nothing else will say so.

describe('attribution compatibility', () => {
  it('a written action leaves a legacy invite carrying invitedBy + type + id', async () => {
    await writePendingAction({
      version: PENDING_ACTION_VERSION,
      createdAt: NOW,
      origin: 'deep_link',
      kind: 'open_game',
      targetId: 'g1',
      invitedBy: 'u9',
    });
    // applyInviteAttributionIfFresh reads pending.invitedBy / .type / .id
    expect(json(LEGACY_KEY)).toEqual({
      type: 'session',
      id: 'g1',
      invitedBy: 'u9',
    });
  });

  it('a written action leaves the acquisition source on the legacy key', async () => {
    await writePendingAction({
      version: PENDING_ACTION_VERSION,
      createdAt: NOW,
      origin: 'deferred_deep_link',
      kind: 'open_invite',
      invitedBy: 'u9',
      acquisition: { source: 'whatsapp', campaign: 'sep', linkId: 'al_2' },
    });
    // applyAcquisitionIfFresh reads pending.source / .campaign / .linkId
    expect(json(LEGACY_KEY)).toEqual({
      type: 'app',
      invitedBy: 'u9',
      source: 'whatsapp',
      campaign: 'sep',
      linkId: 'al_2',
    });
  });

  it('clear removes BOTH keys, so nothing re-attributes on the next launch', async () => {
    await writePendingAction({
      version: PENDING_ACTION_VERSION,
      createdAt: NOW,
      origin: 'deep_link',
      kind: 'open_club',
      targetId: 'c1',
      invitedBy: 'u9',
    });
    expect(raw(NEW_KEY)).not.toBeNull();
    expect(raw(LEGACY_KEY)).not.toBeNull();
    await clearPendingAction();
    expect(raw(NEW_KEY)).toBeNull();
    expect(raw(LEGACY_KEY)).toBeNull();
  });
});

// ─── parsing ──────────────────────────────────────────────────────────────

describe('parsePendingAction', () => {
  const ok = {
    version: PENDING_ACTION_VERSION,
    createdAt: NOW,
    origin: 'in_app',
    kind: 'open_game',
    targetId: 'g1',
  };

  it('accepts a well-formed action', () => {
    expect(parsePendingAction(ok)).toMatchObject({ kind: 'open_game', targetId: 'g1' });
  });

  it('rejects non-objects', () => {
    for (const v of [null, undefined, 'x', 7, true, []]) {
      expect(parsePendingAction(v)).toBeNull();
    }
  });

  it('rejects an unsupported version in either direction', () => {
    expect(parsePendingAction({ ...ok, version: 1 })).toBeNull();
    expect(parsePendingAction({ ...ok, version: 99 })).toBeNull();
    expect(parsePendingAction({ ...ok, version: '2' })).toBeNull();
    const { version: _drop, ...noVersion } = ok;
    expect(parsePendingAction(noVersion)).toBeNull();
  });

  it('rejects an unknown kind', () => {
    expect(parsePendingAction({ ...ok, kind: 'delete_everything' })).toBeNull();
  });

  it('rejects an unknown origin', () => {
    expect(parsePendingAction({ ...ok, origin: 'telepathy' })).toBeNull();
  });

  it('rejects a non-finite createdAt', () => {
    expect(parsePendingAction({ ...ok, createdAt: NaN })).toBeNull();
    expect(parsePendingAction({ ...ok, createdAt: 'yesterday' })).toBeNull();
  });

  it('requires targetId on a targeted kind', () => {
    const { targetId: _drop, ...noTarget } = ok;
    expect(parsePendingAction(noTarget)).toBeNull();
    expect(parsePendingAction({ ...ok, targetId: '' })).toBeNull();
  });

  it('requires draftId on a drafted kind', () => {
    expect(
      parsePendingAction({ ...ok, kind: 'create_club', targetId: undefined }),
    ).toBeNull();
    expect(
      parsePendingAction({ ...ok, kind: 'create_club', draftId: 'd1' }),
    ).toMatchObject({ kind: 'create_club', draftId: 'd1' });
  });

  it('keeps an optional targetId on a drafted kind', () => {
    expect(
      parsePendingAction({ ...ok, kind: 'create_game', draftId: 'd1', targetId: 'c1' }),
    ).toMatchObject({ kind: 'create_game', draftId: 'd1', targetId: 'c1' });
  });

  // Same posture as storage.getPendingInvite: a bad inviter drops out, the
  // action survives. The rest is still actionable with nobody to credit.
  it('drops a malformed inviter without failing the whole read', () => {
    expect(parsePendingAction({ ...ok, invitedBy: '' })).not.toHaveProperty('invitedBy');
    expect(parsePendingAction({ ...ok, invitedBy: 42 })).not.toHaveProperty('invitedBy');
    expect(parsePendingAction({ ...ok, invitedBy: 'u9' })).toHaveProperty(
      'invitedBy',
      'u9',
    );
  });

  it('drops malformed acquisition fields individually', () => {
    expect(
      parsePendingAction({ ...ok, acquisition: { source: 'wa', campaign: 5, linkId: '' } }),
    ).toMatchObject({ acquisition: { source: 'wa' } });
    expect(
      parsePendingAction({ ...ok, acquisition: { campaign: '' } }),
    ).not.toHaveProperty('acquisition');
    expect(parsePendingAction({ ...ok, acquisition: 'nope' })).not.toHaveProperty(
      'acquisition',
    );
  });
});

// ─── read / write / consume ───────────────────────────────────────────────

describe('readPendingAction', () => {
  it('returns null on an empty device', async () => {
    expect(await readPendingAction(NOW)).toBeNull();
  });

  it('derives from the legacy key and leaves it in place', async () => {
    mem.set(LEGACY_KEY, JSON.stringify({ type: 'session', id: 'g1', invitedBy: 'u9' }));
    const out = await readPendingAction(NOW);
    expect(out).toMatchObject({ kind: 'open_game', targetId: 'g1', invitedBy: 'u9' });
    // Non-destructive: the navigator and both attribution helpers still read it.
    expect(raw(LEGACY_KEY)).not.toBeNull();
    expect(raw(NEW_KEY)).toBeNull();
  });

  it('prefers the new key when both are present', async () => {
    mem.set(LEGACY_KEY, JSON.stringify({ type: 'session', id: 'old' }));
    mem.set(
      NEW_KEY,
      JSON.stringify({
        version: PENDING_ACTION_VERSION,
        createdAt: NOW,
        origin: 'in_app',
        kind: 'open_club',
        targetId: 'new',
      }),
    );
    expect(await readPendingAction(NOW)).toMatchObject({
      kind: 'open_club',
      targetId: 'new',
    });
  });

  it('survives malformed JSON on the new key and falls back to legacy', async () => {
    mem.set(NEW_KEY, '{not json at all');
    mem.set(LEGACY_KEY, JSON.stringify({ type: 'team', id: 'c1' }));
    expect(await readPendingAction(NOW)).toMatchObject({ kind: 'open_club' });
    // The unusable blob is gone, so we stop re-reading it every launch.
    expect(raw(NEW_KEY)).toBeNull();
  });

  it('survives malformed JSON on the legacy key', async () => {
    mem.set(LEGACY_KEY, '<<<');
    expect(await readPendingAction(NOW)).toBeNull();
  });

  it('drops an action written by a newer build', async () => {
    mem.set(NEW_KEY, JSON.stringify({ version: 99, kind: 'open_game', targetId: 'g' }));
    expect(await readPendingAction(NOW)).toBeNull();
    expect(raw(NEW_KEY)).toBeNull();
  });
});

describe('writePendingAction overwrite semantics', () => {
  const mk = (id: string): PendingAction => ({
    version: PENDING_ACTION_VERSION,
    createdAt: NOW,
    origin: 'deep_link',
    kind: 'open_game',
    targetId: id,
  });

  // Last-link-wins, matching the documented behaviour of the warm handler in
  // App.tsx. Two taps means they want the second one.
  it('a second write replaces the first', async () => {
    await writePendingAction(mk('g1'));
    await writePendingAction(mk('g2'));
    expect(await readPendingAction(NOW)).toMatchObject({ targetId: 'g2' });
    expect(json(LEGACY_KEY)).toEqual({ type: 'session', id: 'g2' });
  });

  // A drafted action projects to null, which must CLEAR the stale legacy value
  // rather than leave the previous target sitting there for the old consumer to
  // navigate to.
  it('a drafted write clears a stale legacy projection', async () => {
    await writePendingAction(mk('g1'));
    expect(raw(LEGACY_KEY)).not.toBeNull();
    await writePendingAction({
      version: PENDING_ACTION_VERSION,
      createdAt: NOW,
      origin: 'in_app',
      kind: 'create_club',
      draftId: 'd1',
    });
    expect(raw(LEGACY_KEY)).toBeNull();
    expect(await readPendingAction(NOW)).toMatchObject({ kind: 'create_club' });
  });

  it('writing does not disturb an unrelated key', async () => {
    mem.set('footy.group.current', 'c9');
    await writePendingAction(mk('g1'));
    expect(raw('footy.group.current')).toBe('c9');
  });
});

describe('consumePendingAction', () => {
  it('returns the action exactly once', async () => {
    await writePendingAction({
      version: PENDING_ACTION_VERSION,
      createdAt: NOW,
      origin: 'deep_link',
      kind: 'open_game',
      targetId: 'g1',
    });
    expect(await consumePendingAction(NOW)).toMatchObject({ targetId: 'g1' });
    expect(await consumePendingAction(NOW)).toBeNull();
    expect(await readPendingAction(NOW)).toBeNull();
  });

  it('consumes a legacy-only stash exactly once too', async () => {
    mem.set(LEGACY_KEY, JSON.stringify({ type: 'team', id: 'c1' }));
    expect(await consumePendingAction(NOW)).toMatchObject({ kind: 'open_club' });
    expect(await consumePendingAction(NOW)).toBeNull();
  });

  it('is a no-op on an empty device', async () => {
    expect(await consumePendingAction(NOW)).toBeNull();
    expect(await consumePendingAction(NOW)).toBeNull();
  });
});

// ─── what a guest may consume ─────────────────────────────────────────────

describe('isOpenKind', () => {
  // The line between "navigate somewhere" and "write something". A guest may
  // do the first without an account; the second waits for the contextual auth
  // that completes it, and must NOT be dropped in the meantime.
  it('admits exactly the three navigate-only kinds', () => {
    for (const k of ['open_game', 'open_club', 'open_invite'] as const) {
      expect(isOpenKind(k)).toBe(true);
    }
  });

  it('refuses every kind that writes', () => {
    for (const k of [
      'join_game', 'join_club', 'create_club', 'create_game', 'save_availability',
    ] as const) {
      expect(isOpenKind(k)).toBe(false);
    }
  });

  // A kind added later defaults to "not consumable by a guest", which is the
  // safe direction: forgetting to list it costs a held action, not a write
  // performed by somebody who never signed in.
  it('partitions every kind exactly once', () => {
    const all = [
      'open_game', 'open_club', 'open_invite',
      'join_game', 'join_club', 'create_club', 'create_game', 'save_availability',
    ] as const;
    expect(all.filter(isOpenKind)).toHaveLength(3);
    expect(all.filter((k) => !isOpenKind(k))).toHaveLength(5);
  });
});

// ─── guards ───────────────────────────────────────────────────────────────

describe('type guards', () => {
  const base = { version: PENDING_ACTION_VERSION, createdAt: NOW, origin: 'in_app' as const };

  it('partitions the kinds', () => {
    const targeted: PendingAction[] = [
      { ...base, kind: 'open_game', targetId: 'x' },
      { ...base, kind: 'open_club', targetId: 'x' },
      { ...base, kind: 'join_game', targetId: 'x' },
      { ...base, kind: 'join_club', targetId: 'x' },
    ];
    const drafted: PendingAction[] = [
      { ...base, kind: 'create_club', draftId: 'd' },
      { ...base, kind: 'create_game', draftId: 'd' },
      { ...base, kind: 'save_availability', draftId: 'd' },
    ];
    const bare: PendingAction = { ...base, kind: 'open_invite' };

    for (const a of targeted) {
      expect(isTargeted(a)).toBe(true);
      expect(isDrafted(a)).toBe(false);
    }
    for (const a of drafted) {
      expect(isDrafted(a)).toBe(true);
      expect(isTargeted(a)).toBe(false);
    }
    expect(isTargeted(bare)).toBe(false);
    expect(isDrafted(bare)).toBe(false);
  });
});
