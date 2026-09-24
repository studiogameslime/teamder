/**
 * Telling somebody what their resumed action actually got them.
 *
 * The resumers have always returned a precise outcome. Both callers of
 * `resumePendingAction` threw it away, so a person who tapped Join, signed in,
 * and landed on a WAITLIST because the last seat went while they were inside a
 * provider's sheet was told nothing — and had every reason to believe they
 * were in the squad.
 *
 * Two properties here, and the first matters more: a generic success must
 * never be shown. `join_game` can return `{outcome:'joined',
 * reason:'game_join_rejected'}`, and "הצטרפת למחזור" to that person is a lie.
 */

const success = jest.fn();
const info = jest.fn();
const error = jest.fn();

jest.mock('react-native', () => ({ Appearance: {} }), { virtual: true });
jest.mock('@/components/Toast', () => ({
  toast: {
    success: (...a: unknown[]) => success(...a),
    info: (...a: unknown[]) => info(...a),
    error: (...a: unknown[]) => error(...a),
  },
}));

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

import { reportResumeOutcome } from '@/services/resumeFeedback';
import { he } from '@/i18n/he';

const ok = (outcome: string) => ({ outcome, terminal: true }) as never;

beforeEach(() => jest.clearAllMocks());

const said = () => [...success.mock.calls, ...info.mock.calls, ...error.mock.calls];

// ─── join a match ─────────────────────────────────────────────────────────

describe('a resumed match join', () => {
  it('says they are in when they are in', () => {
    reportResumeOutcome('join_game', ok('joined'));
    expect(success).toHaveBeenCalledWith(he.toastGameJoined);
  });

  // The case the whole file exists for. Not a failure — a different result,
  // and one the person cannot guess from a silent screen.
  it('says the match filled up when they land on the waitlist', () => {
    reportResumeOutcome('join_game', ok('waitlisted'));
    expect(info).toHaveBeenCalledWith(he.resumeJoinedWaitlist);
    expect(success).not.toHaveBeenCalled();
  });

  it('says an admin has to approve when the request is pending', () => {
    reportResumeOutcome('join_game', ok('approval_pending'));
    expect(info).toHaveBeenCalledWith(he.resumeJoinedPending);
    expect(success).not.toHaveBeenCalled();
  });

  it('says exactly one thing', () => {
    reportResumeOutcome('join_game', ok('waitlisted'));
    expect(said()).toHaveLength(1);
  });
});

// ─── join a club ──────────────────────────────────────────────────────────

describe('a resumed club join', () => {
  it('says they joined', () => {
    reportResumeOutcome('join_club', ok('joined'));
    expect(success).toHaveBeenCalledWith(he.toastJoinedGroup);
  });

  it('says the request was sent when an admin must approve', () => {
    reportResumeOutcome('join_club', ok('approval_pending'));
    expect(success).toHaveBeenCalledWith(he.toastJoinRequestSent);
  });
});

// ─── never a success that did not happen ──────────────────────────────────

describe('a result that did not achieve anything', () => {
  // `join_game` returns this shape for an account the game has rejected. The
  // `outcome` field still says 'joined'; the `reason` is what makes it false.
  it('says nothing successful when a reason is present', () => {
    reportResumeOutcome('join_game', {
      outcome: 'joined',
      terminal: true,
      reason: 'game_join_rejected',
    } as never);
    expect(success).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it('tells them when the target stopped existing', () => {
    reportResumeOutcome('join_game', {
      outcome: 'joined',
      terminal: true,
      reason: 'target_deleted',
    } as never);
    expect(info).toHaveBeenCalledWith(he.resumeTargetGone);
    expect(success).not.toHaveBeenCalled();
  });

  // A retryable failure keeps the stash and runs again on the next launch.
  // Reporting it would be wrong twice: it announces a failure that has not
  // finished failing, and then announces it again.
  it('stays silent on a retryable failure', () => {
    reportResumeOutcome('join_game', {
      outcome: 'joined',
      terminal: false,
      reason: 'network_unavailable',
    } as never);
    expect(said()).toHaveLength(0);
  });

  it('stays silent on any non-terminal result', () => {
    reportResumeOutcome('join_club', { outcome: 'joined', terminal: false } as never);
    expect(said()).toHaveLength(0);
  });

  it('stays silent for a navigate-only outcome', () => {
    reportResumeOutcome('join_game', ok('navigated'));
    expect(said()).toHaveLength(0);
  });
});

// ─── the kinds that speak for themselves ──────────────────────────────────

describe('creates and the availability save', () => {
  // `create_club` and `create_game` navigate to the thing they just made,
  // celebrating; `save_availability` is followed by the notification offer.
  // Their destinations ARE the feedback — only the joins had none.
  it.each(['create_club', 'create_game', 'save_availability'])(
    '%s says nothing here',
    (kind) => {
      reportResumeOutcome(kind as never, ok('created'));
      expect(said()).toHaveLength(0);
    },
  );
});

// ─── it can never break an action that already succeeded ──────────────────

describe('the contract', () => {
  it('does not throw when the toast layer does', () => {
    success.mockImplementation(() => {
      throw new Error('toast exploded');
    });
    expect(() => reportResumeOutcome('join_game', ok('joined'))).not.toThrow();
  });
});
