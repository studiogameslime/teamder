// "כבר השתמשת ב-Teamder? התחברות לחשבון קיים" — the tertiary action under the
// three entry cards, and the one rule it adds to the gate.
//
// The product principle this file exists to pin:
//
//   the UI says what the person WANTS to do;
//   the data after authentication says who they ARE.
//
// Tapping "I have an account" is a claim, not a fact. Nothing here may treat
// it as proof, and nothing here may let it skip a step a new person owes.

import fs from 'fs';
import path from 'path';

// The store reaches Firebase and AsyncStorage through three modules that pull
// in React Native. Stubbed rather than avoided: the flag transitions ARE the
// contract this file is here to pin, and asserting them through the real store
// is the only way to know they hold.
jest.mock('@/services/storage', () => ({
  storage: {
    setEntryOrganicCompleted: jest.fn().mockResolvedValue(undefined),
    getEntryOrganicCompleted: jest.fn().mockResolvedValue(false),
  },
}));
jest.mock('@/services/pendingAction', () => ({ readPendingAction: jest.fn() }));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn() }));

import { decideEntry } from '@/navigation/entryGate';
import { useEntryStore } from '@/store/entryStore';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const INTENT = read('src/screens/entry/IntentScreen.tsx');
const STACK = read('src/navigation/EntryStack.tsx');
const SHEET = read('src/components/auth/ContextualAuthSheet.tsx');

beforeEach(() => {
  useEntryStore.setState({
    organicCompleted: false,
    invite: null,
    pendingIntent: null,
    suppressAutoConsume: false,
    existingAccountAttempt: false,
    existingAccountWasNew: false,
  });
});

// ─── 1 + 2 — the action is on the screen, in both variants ────────────────

describe('the screen', () => {
  it('offers the action', () => {
    expect(INTENT).toContain('entryExistingPrompt');
    expect(INTENT).toContain('entryExistingCta');
  });

  it('renders it after the cards, inside the scroller so four cards cannot cut it off', () => {
    const cards = INTENT.indexOf('choices.map');
    const action = INTENT.indexOf('styles.existing');
    const closes = INTENT.indexOf('</ScrollView>');
    expect(cards).toBeGreaterThan(-1);
    expect(action).toBeGreaterThan(cards);
    expect(action).toBeLessThan(closes);
  });

  it('is a plain row, not a fourth card — the card list is built from STANDING alone', () => {
    // The invitation is the only thing allowed to extend the card array.
    expect(INTENT).toContain('inviteChoice ? [inviteChoice, ...STANDING] : STANDING');
    expect(INTENT).not.toContain("intent: 'existing_account'");
  });
});

// ─── 3 + 4 + 5 + 6 — what the action must NOT do ──────────────────────────

describe('the action touches nothing it does not own', () => {
  it('opens the sheet directly — no useAuthenticatedAction, so no PendingAction is parked', () => {
    expect(INTENT).toContain('ContextualAuthSheet');
    // The IMPORT, not the word — the comment above the handler names the hook
    // precisely to say why it is not used, and matching on prose would fail on
    // the explanation rather than on the code.
    expect(INTENT).not.toMatch(/import[^;]*useAuthenticatedAction/);
    expect(INTENT).not.toMatch(/import[^;]*actionCoordinator/);
    expect(INTENT).not.toMatch(/\brequestAction\s*\(/);
  });

  it('never routes through chooseIntent', () => {
    const open = INTENT.slice(
      INTENT.indexOf('const openExistingAccount'),
      INTENT.indexOf('const openExistingAccount') + 220,
    );
    expect(open).not.toContain('chooseIntent');
  });

  it('leaves organicCompleted and suppressAutoConsume alone', () => {
    const before = useEntryStore.getState();
    useEntryStore.getState().beginExistingAccountAttempt();
    const after = useEntryStore.getState();
    expect(after.existingAccountAttempt).toBe(true);
    expect(after.organicCompleted).toBe(before.organicCompleted);
    expect(after.suppressAutoConsume).toBe(false);
    expect(after.pendingIntent).toBeNull();
  });

  it('leaves an invitation on the store exactly where it was', () => {
    useEntryStore.setState({ invite: { kind: 'game', targetId: 'g1', invitedBy: 'u1' } });
    useEntryStore.getState().beginExistingAccountAttempt();
    useEntryStore.getState().markExistingAccountWasNew();
    useEntryStore.getState().endExistingAccountAttempt();
    expect(useEntryStore.getState().invite).toEqual({
      kind: 'game',
      targetId: 'g1',
      invitedBy: 'u1',
    });
  });
});

// ─── 7 — an existing account goes to the app ──────────────────────────────

describe('an identity with a Teamder account behind it', () => {
  it('reaches the app: the flag was never latched, so rule 1 answers', () => {
    useEntryStore.getState().beginExistingAccountAttempt();
    // RootNavigator only latches when onboarding is OWED. It is not here.
    expect(
      decideEntry({
        isGuest: false,
        organicCompleted: false,
        existingAccountWasNew: useEntryStore.getState().existingAccountWasNew,
        hasCompletedOnboarding: true,
      }),
    ).toBe('app');
  });
});

// ─── 8 + 10 — a new identity comes back to the question ───────────────────

describe('an identity with no account behind it', () => {
  it('is held for the profile screen first — the gate must not show the question yet', () => {
    useEntryStore.getState().beginExistingAccountAttempt();
    useEntryStore.getState().markExistingAccountWasNew();
    expect(
      decideEntry({
        isGuest: false,
        organicCompleted: false,
        existingAccountWasNew: true,
        hasCompletedOnboarding: false,
      }),
    ).toBe('app'); // → RootNavigator's own gate renders PostSignInOnboarding
  });

  it('is returned to the question once the profile is in', () => {
    expect(
      decideEntry({
        isGuest: false,
        organicCompleted: false,
        existingAccountWasNew: true,
        hasCompletedOnboarding: true,
      }),
    ).toBe('entry');
  });

  it('answering the question ends the journey for good', async () => {
    useEntryStore.setState({ existingAccountAttempt: true, existingAccountWasNew: true });
    await useEntryStore.getState().chooseIntent('create_club');
    const s = useEntryStore.getState();
    expect(s.existingAccountWasNew).toBe(false);
    expect(s.existingAccountAttempt).toBe(false);
    expect(s.organicCompleted).toBe(true);
    expect(
      decideEntry({
        isGuest: false,
        organicCompleted: true,
        existingAccountWasNew: false,
        hasCompletedOnboarding: true,
      }),
    ).toBe('app');
  });

  it('picking the invitation still resumes it — suppressAutoConsume stays down', async () => {
    useEntryStore.setState({ existingAccountAttempt: true, existingAccountWasNew: true });
    await useEntryStore.getState().chooseIntent('invite');
    expect(useEntryStore.getState().suppressAutoConsume).toBe(false);
  });
});

// ─── the rule is scoped: it must not touch anybody else ───────────────────

describe('every other path is untouched', () => {
  it('a new account that came through a CARD is not sent back to the question', () => {
    // No CTA attempt → the flag is never latched → rule 0 cannot fire.
    expect(
      decideEntry({
        isGuest: false,
        organicCompleted: true,
        existingAccountWasNew: false,
        hasCompletedOnboarding: true,
      }),
    ).toBe('app');
  });

  it('markExistingAccountWasNew is inert unless an attempt is open', () => {
    useEntryStore.getState().markExistingAccountWasNew();
    expect(useEntryStore.getState().existingAccountWasNew).toBe(false);
  });

  it('a guest is still governed by the two original rules', () => {
    expect(decideEntry({ isGuest: true, organicCompleted: null })).toBe('unknown');
    expect(decideEntry({ isGuest: true, organicCompleted: false })).toBe('entry');
    expect(decideEntry({ isGuest: true, organicCompleted: true })).toBe('app');
  });
});

// ─── 11 + 12 — cancel ─────────────────────────────────────────────────────

describe('backing out of the sheet', () => {
  it('clears the attempt and nothing else', () => {
    useEntryStore.setState({ invite: { kind: 'club', targetId: 'c1' } });
    useEntryStore.getState().beginExistingAccountAttempt();
    useEntryStore.getState().endExistingAccountAttempt();
    const s = useEntryStore.getState();
    expect(s.existingAccountAttempt).toBe(false);
    expect(s.existingAccountWasNew).toBe(false);
    expect(s.organicCompleted).toBe(false);
    expect(s.pendingIntent).toBeNull();
    expect(s.invite).toEqual({ kind: 'club', targetId: 'c1' });
  });

  it('the screen wires onCancel to exactly that', () => {
    const sheet = INTENT.slice(INTENT.indexOf('<ContextualAuthSheet'));
    expect(sheet).toContain('endExistingAccountAttempt()');
  });
});

// ─── the email provider ───────────────────────────────────────────────────

describe('"המשך עם מייל"', () => {
  it('has a screen to navigate to from this stack — navigate() to an unregistered route is silent', () => {
    expect(STACK).toContain('name="EmailAuth"');
  });
});

// ─── the sheet's copy on this path, and only on this path ─────────────────

describe('the auth sheet says the right thing', () => {
  it('the existing-account flow overrides the two lines', () => {
    const call = INTENT.slice(INTENT.indexOf('<ContextualAuthSheet'));
    expect(call).toContain('entryExistingSheetTitle');
    expect(call).toContain('entryExistingSheetBody');
  });

  it('every other consumer still gets COPY[kind] — the override is optional', () => {
    // Optional in the type, and the default is the untouched map.
    expect(SHEET).toMatch(/copy\?: \{ title: string; body: string \}/);
    expect(SHEET).toContain('const copy = copyOverride ?? COPY[kind];');
    // The global line is NOT redefined by this change.
    expect(SHEET).not.toContain("ctxAuthUpgradeTitle:");
  });

  it('no other caller passes one', () => {
    const callers = [
      'src/hooks/useAuthenticatedAction.tsx',
      'src/dev/QARouteLauncher.tsx',
    ];
    for (const f of callers) {
      const src = read(f);
      if (!src.includes('ContextualAuthSheet')) continue;
      const call = src.slice(src.indexOf('<ContextualAuthSheet'));
      expect(call.slice(0, 400)).not.toMatch(/\bcopy=/);
    }
  });

  it('changes nothing about authentication — the override touches copy alone', () => {
    // The outcome handling is the same single path it always was.
    expect(SHEET).toContain('outcome = await upgradeAnonymous(method)');
    expect(SHEET).toContain("if (outcome.status === 'cancelled')");
    expect(SHEET).toContain('const requiredProfile = !useUserStore.getState().hasCompletedOnboarding();');
    // `copyOverride` is read in exactly one place, and it is the copy line.
    const uses = SHEET.split('copyOverride').length - 1;
    expect(uses).toBe(2); // the destructured param, and the ?? below it
  });

  it('cancel and the invitation are unaffected by it', () => {
    useEntryStore.setState({ invite: { kind: 'game', targetId: 'g9', invitedBy: 'u9' } });
    useEntryStore.getState().beginExistingAccountAttempt();
    useEntryStore.getState().endExistingAccountAttempt();
    const s2 = useEntryStore.getState();
    expect(s2.existingAccountAttempt).toBe(false);
    expect(s2.organicCompleted).toBe(false);
    expect(s2.pendingIntent).toBeNull();
    expect(s2.invite).toEqual({ kind: 'game', targetId: 'g9', invitedBy: 'u9' });
  });
});
