/**
 * The behaviour of "I tried to do something, I wasn't signed in, and now I'm
 * back".
 *
 * Every case asserts three things together — the next state, what happens to
 * the pending action, and what happens to the draft — because the bugs in this
 * area are never about the state alone. Clearing a stash on a dead network, or
 * keeping one for a game that was deleted, is what strands somebody; the state
 * label being right is no comfort.
 *
 * Two behaviours in here are deliberate and easy to mistake for errors:
 *   • a full game is SUCCESS, not FAILURE — `joinGameV2` returns
 *     `{bucket:'waitlist'}` and a place in the queue is an outcome;
 *   • `ACCESS_BLOCKED` never reaches this machine as a failure at all, which is
 *     what `isPresentButUnreadable` exists to enforce at the call site.
 */

import {
  INITIAL_CONTEXT,
  step,
  run,
  failureReasonFromCode,
  isPresentButUnreadable,
  isDraftedKind,
  type MachineContext,
  type MachineEvent,
  type MachineState,
} from '@/utils/pendingActionMachine';

// ─── helpers ──────────────────────────────────────────────────────────────

const at = (state: MachineState, kind: MachineContext['kind'] = null): MachineContext => ({
  state,
  kind,
});

/** Drive the machine to the point where an action is mid-resume. */
function upToResume(kind: MachineContext['kind'] = 'join_game'): MachineContext {
  return run([
    { type: 'ACTION_TAPPED', kind: kind! },
    { type: 'IS_GUEST' },
    { type: 'PROVIDER_PICKED' },
    { type: 'AUTH_OK', isNewAccount: true },
    { type: 'PROFILE_CONFIRMED' },
  ]);
}

// ─── the happy paths ──────────────────────────────────────────────────────

describe('the guest who signs up and lands on their action', () => {
  it('walks browsing → requested → auth → profile → resuming → success', () => {
    let ctx = INITIAL_CONTEXT;
    expect(ctx.state).toBe('ANONYMOUS_BROWSING');

    let t = step(ctx, { type: 'ACTION_TAPPED', kind: 'join_game' });
    expect(t.ctx).toEqual(at('ACTION_REQUESTED', 'join_game'));
    ctx = t.ctx;

    // The wall. Both slots are written BEFORE the sheet opens — on the
    // fallback path the session is replaced and the screen unmounts.
    t = step(ctx, { type: 'IS_GUEST' });
    expect(t.ctx.state).toBe('AUTH_REQUIRED');
    expect(t.pendingAction).toBe('save');
    ctx = t.ctx;

    t = step(ctx, { type: 'PROVIDER_PICKED' });
    expect(t.ctx.state).toBe('AUTH_IN_PROGRESS');
    ctx = t.ctx;

    t = step(ctx, { type: 'AUTH_OK', isNewAccount: true });
    expect(t.ctx.state).toBe('PROFILE_REQUIRED');
    ctx = t.ctx;

    t = step(ctx, { type: 'PROFILE_CONFIRMED' });
    expect(t.ctx.state).toBe('RESUMING_ACTION');
    ctx = t.ctx;

    t = step(ctx, { type: 'RESUME_OK', outcome: 'joined' });
    expect(t.ctx.state).toBe('SUCCESS');
    expect(t.pendingAction).toBe('clear');
    expect(t.draft).toBe('clear');
    expect(t.notice).toBeNull();
  });

  it('an already-signed-in person skips the whole auth detour', () => {
    const ctx = run([{ type: 'ACTION_TAPPED', kind: 'join_club' }, { type: 'IS_AUTHED' }]);
    expect(ctx.state).toBe('RESUMING_ACTION');
  });

  it('a drafted kind saves the draft at the wall; a targeted kind has none to save', () => {
    const drafted = step(at('ACTION_REQUESTED', 'create_club'), { type: 'IS_GUEST' });
    expect(drafted.pendingAction).toBe('save');
    expect(drafted.draft).toBe('save');

    const targeted = step(at('ACTION_REQUESTED', 'join_game'), { type: 'IS_GUEST' });
    expect(targeted.pendingAction).toBe('save');
    expect(targeted.draft).toBe('keep');
  });

  it('partitions drafted from targeted kinds', () => {
    for (const k of ['create_club', 'create_game', 'save_availability'] as const) {
      expect(isDraftedKind(k)).toBe(true);
    }
    for (const k of ['open_game', 'open_club', 'join_game', 'join_club', 'open_invite'] as const) {
      expect(isDraftedKind(k)).toBe(false);
    }
    expect(isDraftedKind(null)).toBe(false);
  });
});

// ─── the nine edge cases from the design report ───────────────────────────

describe('1 · auth cancelled', () => {
  // Backing out is a legitimate answer, not an error. Nothing is lost and
  // nothing is said.
  it('from the sheet: returns to browsing, keeps everything, says nothing', () => {
    const t = step(at('AUTH_REQUIRED', 'create_club'), { type: 'AUTH_CANCELLED' });
    expect(t.ctx.state).toBe('ANONYMOUS_BROWSING');
    expect(t.pendingAction).toBe('keep');
    expect(t.draft).toBe('keep');
    expect(t.notice).toBeNull();
  });

  it('mid-provider: same', () => {
    const t = step(at('AUTH_IN_PROGRESS', 'join_game'), { type: 'AUTH_CANCELLED' });
    expect(t.ctx.state).toBe('ANONYMOUS_BROWSING');
    expect(t.pendingAction).toBe('keep');
  });

  it('from the profile screen: same', () => {
    const t = step(at('PROFILE_REQUIRED', 'create_club'), { type: 'AUTH_CANCELLED' });
    expect(t.ctx.state).toBe('ANONYMOUS_BROWSING');
    expect(t.draft).toBe('keep');
  });

  it('the kind is remembered, so a second tap resumes the same intent', () => {
    const t = step(at('AUTH_REQUIRED', 'create_club'), { type: 'AUTH_CANCELLED' });
    expect(t.ctx.kind).toBe('create_club');
  });
});

describe('2 · provider failure', () => {
  // The provider failed; the intent did not. Back to the sheet with the error
  // showing, not out of the flow entirely.
  it('returns to the sheet and keeps both slots', () => {
    const t = step(at('AUTH_IN_PROGRESS', 'create_game'), { type: 'AUTH_FAILED' });
    expect(t.ctx.state).toBe('AUTH_REQUIRED');
    expect(t.pendingAction).toBe('keep');
    expect(t.draft).toBe('keep');
    expect(t.notice).toBe('auth_failed');
  });

  it('a retry from there reaches auth again', () => {
    const ctx = run(
      [{ type: 'AUTH_FAILED' }, { type: 'PROVIDER_PICKED' }],
      at('AUTH_IN_PROGRESS', 'create_game'),
    );
    expect(ctx.state).toBe('AUTH_IN_PROGRESS');
  });
});

describe('3 · the process was recreated', () => {
  it('a stashed action goes straight back into the queue', () => {
    const t = step(INITIAL_CONTEXT, {
      type: 'REHYDRATE',
      pending: { kind: 'create_club' },
      hasDraft: true,
    });
    expect(t.ctx).toEqual(at('ACTION_REQUESTED', 'create_club'));
    expect(t.pendingAction).toBe('keep');
    expect(t.draft).toBe('keep');
    expect(t.notice).toBeNull();
  });

  // A draft with no committed intent is an OFFER. Forcing a half-filled wizard
  // onto somebody who opened the app to check tonight's game is worse than
  // letting them ignore it.
  it('a draft with no action is offered, not opened', () => {
    const t = step(INITIAL_CONTEXT, { type: 'REHYDRATE', pending: null, hasDraft: true });
    expect(t.ctx.state).toBe('ANONYMOUS_BROWSING');
    expect(t.notice).toBe('offer_draft_continue');
    expect(t.draft).toBe('keep');
  });

  it('nothing on disk is silence', () => {
    const t = step(INITIAL_CONTEXT, { type: 'REHYDRATE', pending: null, hasDraft: false });
    expect(t.ctx).toEqual(at('ANONYMOUS_BROWSING', null));
    expect(t.notice).toBeNull();
  });

  it('is legal from every state — a recreated process knows nothing', () => {
    const states: MachineState[] = [
      'ANONYMOUS_BROWSING',
      'ACTION_REQUESTED',
      'AUTH_REQUIRED',
      'AUTH_IN_PROGRESS',
      'PROFILE_REQUIRED',
      'RESUMING_ACTION',
      'SUCCESS',
      'FAILURE',
    ];
    for (const s of states) {
      const t = step(at(s, 'join_game'), {
        type: 'REHYDRATE',
        pending: { kind: 'join_game' },
        hasDraft: false,
      });
      expect(t.ignored).toBe(false);
      expect(t.ctx.state).toBe('ACTION_REQUESTED');
    }
  });
});

describe('4 · the target was deleted', () => {
  it('fails, clears both, and says the link is dead', () => {
    const t = step(upToResume('open_game'), {
      type: 'RESUME_FAILED',
      reason: 'target_deleted',
    });
    expect(t.ctx.state).toBe('FAILURE');
    expect(t.pendingAction).toBe('clear');
    expect(t.draft).toBe('clear');
    expect(t.notice).toBe('target_gone');
  });
});

describe('5 · the game filled up', () => {
  // NOT a failure. joinGameV2 returns a bucket, and a waitlist place is a
  // result the person asked for.
  it('a waitlist place is SUCCESS with its own notice', () => {
    const t = step(upToResume(), { type: 'RESUME_OK', outcome: 'waitlisted' });
    expect(t.ctx.state).toBe('SUCCESS');
    expect(t.pendingAction).toBe('clear');
    expect(t.notice).toBe('waitlisted');
  });

  it('awaiting approval is SUCCESS too', () => {
    const t = step(upToResume(), { type: 'RESUME_OK', outcome: 'approval_pending' });
    expect(t.ctx.state).toBe('SUCCESS');
    expect(t.notice).toBe('approval_pending');
  });

  it('created and navigated are quiet successes', () => {
    for (const outcome of ['created', 'navigated', 'joined'] as const) {
      const t = step(upToResume(), { type: 'RESUME_OK', outcome });
      expect(t.ctx.state).toBe('SUCCESS');
      expect(t.notice).toBeNull();
    }
  });
});

describe('6 · no network', () => {
  // The one case where clearing the stash is itself the bug: the intent is
  // still valid and will succeed on a train platform ten minutes from now.
  it('returns to the queue and keeps BOTH slots', () => {
    const t = step(upToResume('create_club'), {
      type: 'RESUME_FAILED',
      reason: 'network_unavailable',
    });
    expect(t.ctx.state).toBe('ACTION_REQUESTED');
    expect(t.pendingAction).toBe('keep');
    expect(t.draft).toBe('keep');
    expect(t.notice).toBe('retry_network');
  });

  it('a rate limit is retryable on the same terms', () => {
    const t = step(upToResume(), { type: 'RESUME_FAILED', reason: 'rate_limited' });
    expect(t.ctx.state).toBe('ACTION_REQUESTED');
    expect(t.pendingAction).toBe('keep');
  });

  it('and the retry can then complete', () => {
    const ctx = run(
      [
        { type: 'RESUME_FAILED', reason: 'network_unavailable' },
        { type: 'IS_AUTHED' },
        { type: 'RESUME_OK', outcome: 'created' },
      ],
      upToResume('create_club'),
    );
    expect(ctx.state).toBe('SUCCESS');
  });
});

describe('7 · an existing account signed in', () => {
  // They already have a name and an avatar. Asking again is a bug.
  it('skips PROFILE_REQUIRED entirely', () => {
    const t = step(at('AUTH_IN_PROGRESS', 'join_game'), {
      type: 'AUTH_OK',
      isNewAccount: false,
    });
    expect(t.ctx.state).toBe('RESUMING_ACTION');
  });

  it('keeps both slots across the upgrade', () => {
    const t = step(at('AUTH_IN_PROGRESS', 'create_club'), {
      type: 'AUTH_OK',
      isNewAccount: false,
    });
    expect(t.pendingAction).toBe('keep');
    expect(t.draft).toBe('keep');
  });
});

describe('8 · the draft expired', () => {
  it('fails, clears both, and says so', () => {
    const t = step(upToResume('create_club'), {
      type: 'RESUME_FAILED',
      reason: 'draft_expired',
    });
    expect(t.ctx.state).toBe('FAILURE');
    expect(t.pendingAction).toBe('clear');
    expect(t.draft).toBe('clear');
    expect(t.notice).toBe('draft_expired');
  });
});

describe('9 · the target exists but cannot be read', () => {
  // ACCESS_BLOCKED must never become a RESUME_FAILED. The doc is there, the
  // target screen has a blocked-access view, and "this link is invalid" would
  // be a false statement about a game their friend is playing in.
  it('is recognised as present-but-unreadable, not as an error code', () => {
    expect(isPresentButUnreadable('ACCESS_BLOCKED')).toBe(true);
    expect(isPresentButUnreadable('functions/ACCESS_BLOCKED')).toBe(true);
    expect(isPresentButUnreadable('GAME_STARTED')).toBe(false);
    expect(isPresentButUnreadable(undefined)).toBe(false);
    expect(isPresentButUnreadable(null)).toBe(false);
  });

  it('navigates anyway, as a success', () => {
    const t = step(upToResume('open_game'), { type: 'RESUME_OK', outcome: 'navigated' });
    expect(t.ctx.state).toBe('SUCCESS');
    expect(t.pendingAction).toBe('clear');
    expect(t.notice).toBeNull();
  });
});

// ─── real failures about the world ────────────────────────────────────────

describe('a real answer about the world', () => {
  const terminal = [
    'game_overlap',
    'registration_conflict',
    'game_not_open',
    'game_started',
    'game_live',
    'game_join_rejected',
    'group_full',
    'stale_offer',
    'unknown',
  ] as const;

  it('drops the stash for every non-retryable reason', () => {
    for (const reason of terminal) {
      const t = step(upToResume('join_game'), { type: 'RESUME_FAILED', reason });
      expect(t.ctx.state).toBe('FAILURE');
      expect(t.pendingAction).toBe('clear');
      expect(t.notice).toBe('resume_failed');
    }
  });

  // The typed-in work is still theirs, and a different target may accept it.
  it('KEEPS a draft even when the attempt is dead', () => {
    for (const reason of terminal) {
      const t = step(upToResume('create_club'), { type: 'RESUME_FAILED', reason });
      expect(t.draft).toBe('keep');
    }
  });

  it('but clears the draft slot for a deleted or expired target', () => {
    for (const reason of ['target_deleted', 'draft_expired'] as const) {
      expect(step(upToResume('create_club'), { type: 'RESUME_FAILED', reason }).draft).toBe(
        'clear',
      );
    }
  });
});

describe('failureReasonFromCode', () => {
  it('maps every code joinGameV2 actually throws', () => {
    const pairs: Array<[string, string]> = [
      ['GAME_OVERLAP', 'game_overlap'],
      ['REGISTRATION_CONFLICT', 'registration_conflict'],
      ['GAME_NOT_OPEN', 'game_not_open'],
      ['GAME_STARTED', 'game_started'],
      ['GAME_LIVE', 'game_live'],
      ['GAME_JOIN_REJECTED', 'game_join_rejected'],
      ['GROUP_FULL', 'group_full'],
      ['STALE_OFFER', 'stale_offer'],
      ['resource-exhausted', 'rate_limited'],
    ];
    for (const [code, reason] of pairs) {
      expect(failureReasonFromCode(code)).toBe(reason);
    }
  });

  it('strips the functions/ prefix the SDK adds', () => {
    expect(failureReasonFromCode('functions/resource-exhausted')).toBe('rate_limited');
    expect(failureReasonFromCode('functions/GROUP_FULL')).toBe('group_full');
  });

  it('reads transport failures as retryable', () => {
    expect(failureReasonFromCode('unavailable')).toBe('network_unavailable');
    expect(failureReasonFromCode('deadline-exceeded')).toBe('network_unavailable');
  });

  // Total by design: a code we have never seen degrades to a generic failure,
  // never to undefined flowing into a switch that then does nothing.
  it('is total', () => {
    expect(failureReasonFromCode('something-new-in-2027')).toBe('unknown');
    expect(failureReasonFromCode('')).toBe('unknown');
    expect(failureReasonFromCode(undefined)).toBe('unknown');
    expect(failureReasonFromCode(null)).toBe('unknown');
  });
});

// ─── illegal transitions ──────────────────────────────────────────────────

describe('an event that makes no sense here', () => {
  const ALL_STATES: MachineState[] = [
    'ANONYMOUS_BROWSING',
    'ACTION_REQUESTED',
    'AUTH_REQUIRED',
    'AUTH_IN_PROGRESS',
    'PROFILE_REQUIRED',
    'RESUMING_ACTION',
    'SUCCESS',
    'FAILURE',
  ];
  const ALL_EVENTS: MachineEvent[] = [
    { type: 'ACTION_TAPPED', kind: 'join_game' },
    { type: 'IS_GUEST' },
    { type: 'IS_AUTHED' },
    { type: 'PROVIDER_PICKED' },
    { type: 'AUTH_OK', isNewAccount: true },
    { type: 'AUTH_OK', isNewAccount: false },
    { type: 'AUTH_CANCELLED' },
    { type: 'AUTH_FAILED' },
    { type: 'PROFILE_CONFIRMED' },
    { type: 'RESUME_OK', outcome: 'joined' },
    { type: 'RESUME_FAILED', reason: 'unknown' },
    { type: 'REHYDRATE', pending: null, hasDraft: false },
  ];

  // The whole point: an unexpected event must never invent a state, and must
  // never quietly throw away the person's work on its way past.
  it('leaves the context untouched and touches neither slot', () => {
    for (const s of ALL_STATES) {
      for (const e of ALL_EVENTS) {
        const ctx = at(s, 'create_club');
        const t = step(ctx, e);
        if (!t.ignored) continue;
        expect(t.ctx).toEqual(ctx);
        expect(t.pendingAction).toBe('keep');
        expect(t.draft).toBe('keep');
        expect(t.notice).toBeNull();
      }
    }
  });

  it('is total over every (state, event) pair', () => {
    for (const s of ALL_STATES) {
      for (const e of ALL_EVENTS) {
        const t = step(at(s, 'join_game'), e);
        expect(ALL_STATES).toContain(t.ctx.state);
        expect(['keep', 'save', 'clear']).toContain(t.pendingAction);
        expect(['keep', 'save', 'clear']).toContain(t.draft);
      }
    }
  });

  it('names concrete illegal pairs', () => {
    expect(step(at('ANONYMOUS_BROWSING'), { type: 'RESUME_OK', outcome: 'joined' }).ignored).toBe(
      true,
    );
    expect(step(at('AUTH_REQUIRED', 'join_game'), { type: 'PROFILE_CONFIRMED' }).ignored).toBe(
      true,
    );
    expect(step(at('RESUMING_ACTION', 'join_game'), { type: 'IS_GUEST' }).ignored).toBe(true);
    expect(step(at('PROFILE_REQUIRED', 'join_game'), { type: 'AUTH_OK', isNewAccount: true }).ignored).toBe(
      true,
    );
  });

  it('allows a fresh attempt from a finished one', () => {
    for (const s of ['SUCCESS', 'FAILURE'] as const) {
      const t = step(at(s, 'join_game'), { type: 'ACTION_TAPPED', kind: 'create_club' });
      expect(t.ignored).toBe(false);
      expect(t.ctx).toEqual(at('ACTION_REQUESTED', 'create_club'));
    }
  });
});

describe('run', () => {
  it('folds a sequence and starts from the initial context by default', () => {
    expect(run([])).toEqual(INITIAL_CONTEXT);
    expect(run([{ type: 'ACTION_TAPPED', kind: 'open_club' }])).toEqual(
      at('ACTION_REQUESTED', 'open_club'),
    );
  });
});
