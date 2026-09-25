// Guard: the filler application is a gated, honest, non-lying action.
//
// Three defects lived together in one CTA, and production QA found all three
// at once by tapping it as a guest:
//
//   1. `onApplyAsFiller` had no `isGuest` check. The join CTA two hundred
//      lines above it was gated three rounds earlier; this one was missed, so
//      an anonymous session called the callable directly and a real filler
//      application landed in front of a real club admin.
//   2. `handleFillerOpportunityAction` swallowed every error in its own
//      catch, so the screen's catch was dead code. Every refusal was rendered
//      as "הבקשה נשלחה ✓".
//   3. The same helper stamped `viaNotificationAction: true` and
//      `source: 'filler_push'` on a button press, because it was written for
//      a notification action — and the notification action buttons were never
//      wired up, so the flag was ALWAYS false and always reported true.
//
// There is no renderer here, so the invariants are read from the sources —
// the same approach as hooksAfterEarlyReturn and joinFlowWiring.

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** Code only — these files explain the traps they avoid at length. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const SCREEN = path.join('src', 'screens', 'games', 'MatchDetailsScreen.tsx');
const HELPER = path.join('src', 'services', 'notificationActionService.ts');
const BUILDER = path.join('src', 'services', 'guestFiller.ts');
const RESUMERS = path.join('src', 'services', 'actionResumers.ts');
const FEEDBACK = path.join('src', 'services', 'resumeFeedback.ts');
const KINDS = path.join('src', 'services', 'pendingAction.ts');
const SHEET = path.join('src', 'components', 'auth', 'ContextualAuthSheet.tsx');
const FUNCTIONS = path.join('functions', 'src', 'index.ts');

// ─── 1–2. a guest is gated, and never reaches the callable ────────────────

describe('a guest tapping the filler CTA', () => {
  const screen = code(SCREEN);

  it('is gated before anything is submitted', () => {
    const at = screen.indexOf('const onApplyAsFiller');
    expect(at).toBeGreaterThan(-1);
    const body = screen.slice(at, screen.indexOf('handleFillerOpportunityAction', at));
    expect(body).toMatch(/if\s*\(\s*isGuest\s*\)/);
    expect(body).toMatch(/authAction\.request\(/);
    // and the gate RETURNS, so nothing below it runs for a guest
    expect(body).toMatch(/authAction\.request\([\s\S]{0,80}?\);\s*return;/);
  });

  it('produces an apply_filler intent, built by the shared helper', () => {
    expect(screen).toContain('guestApplyFillerRequest');
    expect(code(BUILDER)).toContain("kind: 'apply_filler'");
  });

  it('does not carry its own executor', () => {
    expect(screen).not.toMatch(/unreachable: guest actions resume/);
    expect(code(BUILDER)).toMatch(/unreachable: guest actions resume/);
  });

  it('sees the sheet, because the screen already mounts it', () => {
    expect(screen).toContain('authAction.sheet');
  });

  // The sheet's COPY map is an exhaustive Record over the union, so a kind
  // with no entry is a compile error rather than an empty sheet. This asserts
  // the entry says something specific rather than borrowing the join copy.
  it('is offered copy of its own, which does not promise a place', () => {
    expect(code(SHEET)).toContain('apply_filler');
    expect(code(SHEET)).toContain('ctxAuthApplyFillerTitle');
  });
});

// ─── 3–5. the intent survives the sign-in ─────────────────────────────────

describe('the stashed filler intent', () => {
  it('is a real PendingAction kind, not a join in disguise', () => {
    const kinds = code(KINDS);
    expect(kinds).toContain("| 'apply_filler'");
    // Targeted: it names a game and carries no draft.
    const set = kinds.slice(kinds.indexOf('const TARGETED_KINDS'));
    expect(set.slice(0, 200)).toContain("'apply_filler'");
  });

  it('has a resumer that asks the server again', () => {
    const r = code(RESUMERS);
    expect(r).toContain("registerResumer('apply_filler'");
    // Scoped to THIS registration — the next one starts right after it, and a
    // fixed slice would read join_club's body and see its outcomes.
    const at = r.indexOf("registerResumer('apply_filler'");
    const next = r.indexOf('registerResumer(', at + 20);
    const body = r.slice(at, next > -1 ? next : undefined);
    expect(body).toContain('handleFillerOpportunityAction');
    // and it never reports a seat — an application ends in front of an admin
    expect(body).toContain("outcome: 'approval_pending'");
    expect(body).not.toContain("outcome: 'joined'");
  });

  it('treats a missing target as terminal, not as a retry forever', () => {
    const r = code(RESUMERS);
    const at = r.indexOf("registerResumer('apply_filler'");
    expect(r.slice(at, at + 1600)).toContain("reason: 'target_deleted'");
  });
});

// ─── 6. a full account is untouched ───────────────────────────────────────

describe('a full account', () => {
  it('still submits directly, with no sheet', () => {
    const screen = code(SCREEN);
    const at = screen.indexOf('const onApplyAsFiller');
    const body = screen.slice(at, at + 1400);
    // the direct call is still there, below the guest branch
    expect(body).toContain("handleFillerOpportunityAction('EXPRESS_FILLER_INTEREST'");
    expect(body.indexOf('isGuest')).toBeLessThan(body.indexOf('setFillerState'));
  });
});

// ─── 7–8. a failure is a failure ──────────────────────────────────────────

describe('a submission the server refuses', () => {
  const helper = code(HELPER);

  it('reaches the caller instead of being swallowed', () => {
    const at = helper.indexOf('export async function handleFillerOpportunityAction');
    const body = helper.slice(at);
    // the catch re-throws
    expect(body).toMatch(/catch\s*\([\s\S]{0,400}?throw err;/);
  });

  it('produces no success analytics, because the event is after the await', () => {
    const at = helper.indexOf('export async function handleFillerOpportunityAction');
    const body = helper.slice(at);
    const call = body.indexOf('await fn(');
    // LAST occurrence: the mock branch above returns early and logs its own
    // event, so the first match is not the one on the network path.
    const event = body.lastIndexOf('AnalyticsEvent.GameJoined');
    expect(call).toBeGreaterThan(-1);
    expect(event).toBeGreaterThan(call);
    // and it is NOT inside the try that wraps the call
    expect(body.slice(call, event)).toContain('throw err;');
  });

  // The mock branch exists so this flow can be exercised offline at all —
  // but it must short-circuit BEFORE the callable, never alongside it.
  it('short-circuits in mock mode without reaching the callable', () => {
    const at = helper.indexOf('export async function handleFillerOpportunityAction');
    const body = helper.slice(at);
    const mock = body.indexOf('USE_MOCK_DATA');
    const call = body.indexOf('await fn(');
    expect(mock).toBeGreaterThan(-1);
    expect(mock).toBeLessThan(call);
    expect(body.slice(mock, call)).toMatch(/return;/);
  });

  it('leaves the screen able to show its error, which was dead code before', () => {
    const screen = code(SCREEN);
    const at = screen.indexOf('const onApplyAsFiller');
    const body = screen.slice(at, at + 1600);
    expect(body).toContain('fillerApplyError');
    expect(body).toMatch(/setFillerState\('idle'\)/);
  });
});

// ─── 9. one message, and an honest one ────────────────────────────────────

describe('feedback after a resumed application', () => {
  const fb = code(FEEDBACK);

  it('says a candidate is a candidate', () => {
    expect(fb).toContain("kind === 'apply_filler'");
    expect(fb).toContain('resumeFillerApplied');
  });

  it('is not reported as a join', () => {
    const at = fb.indexOf("kind === 'apply_filler'");
    const body = fb.slice(at, at + 420);
    expect(body).not.toContain('toastGameJoined');
  });
});

// ─── 10–11. the analytics source tells the truth ──────────────────────────

describe('the analytics origin', () => {
  const helper = code(HELPER);

  // Scoped to the filler function. The two sibling helpers in this file
  // (`handleGameReminderAction`, `handleSpotOfferAction`) still hardcode the
  // flag — and they may, because they have ZERO importers: the notification
  // action buttons were never wired up. Widening this assertion to the file
  // would fail on dead code and say nothing about the bug.
  it('is a parameter, not a hardcoded true', () => {
    expect(helper).toContain('FillerOrigin');
    const at = helper.indexOf('export async function handleFillerOpportunityAction');
    const body = helper.slice(at);
    expect(body).not.toMatch(/viaNotificationAction:\s*true/);
    expect(body).toMatch(/viaNotificationAction:\s*origin === 'notification'/);
  });

  it('reports the match screen as the match screen', () => {
    expect(helper).toContain("'match_screen'");
    expect(helper).toMatch(/origin === 'notification' \? 'filler_push' : 'match_screen'/);
  });

  it('is passed explicitly by the only call site', () => {
    expect(code(SCREEN)).toMatch(
      /handleFillerOpportunityAction\('EXPRESS_FILLER_INTEREST',[^)]*'screen'\)/,
    );
  });

  it('carries no PII — a game id and two booleans', () => {
    const at = helper.indexOf('AnalyticsEvent.GameJoined');
    const body = helper.slice(at, at + 300);
    for (const forbidden of ['email', 'name', 'phone', 'uid', 'token']) {
      expect(body).not.toContain(forbidden);
    }
  });
});

// ─── 12. double tap ───────────────────────────────────────────────────────

describe('tapping twice', () => {
  it('cannot submit twice — the state latch is checked first', () => {
    const screen = code(SCREEN);
    const at = screen.indexOf('const onApplyAsFiller');
    const body = screen.slice(at, at + 300);
    expect(body).toMatch(/fillerState !== 'idle'\)\s*return;/);
  });
});

// ─── 13–16. the server does not trust any of the above ────────────────────

describe('submitFillerInterest, server-side', () => {
  const fns = code(FUNCTIONS);

  it('rejects an unauthenticated caller', () => {
    const at = fns.indexOf('function requireFullAccount');
    const body = fns.slice(at, at + 700);
    expect(body).toContain("'unauthenticated'");
  });

  it('rejects a Firebase Anonymous session', () => {
    const at = fns.indexOf('function requireFullAccount');
    const body = fns.slice(at, at + 700);
    expect(body).toContain("sign_in_provider === 'anonymous'");
    expect(body).toContain("'permission-denied'");
  });

  it('is what the callable actually uses', () => {
    const at = fns.indexOf('export const submitFillerInterest');
    const body = fns.slice(at, at + 900);
    expect(body).toContain('requireFullAccount(request.auth)');
    // the old uid-only check is gone
    expect(body).not.toMatch(/if \(!auth\?\.uid\)/);
  });

  // The whole point of defence in depth is that it adds a check without
  // moving any of the others.
  it('leaves the existing business validation unchanged', () => {
    const at = fns.indexOf('export const submitFillerInterest');
    const body = fns.slice(at, at + 4200);
    for (const rule of [
      'acceptsFillers',
      'game is no longer open',
      'game already started',
      'community members should join the regular way',
      'already in this game',
    ]) {
      expect(body).toContain(rule);
    }
  });

  it('mirrors the rules helper so the two cannot drift', () => {
    const rules = read('firestore.rules');
    expect(rules).toContain("sign_in_provider != 'anonymous'");
    expect(fns).toContain("sign_in_provider === 'anonymous'");
  });
});
