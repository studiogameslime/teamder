// The organic first run — Welcome → Intent — and the state semantics behind it.
//
// The flag is the design, so the flag is what this file pins. `organicCompleted`
// means "this DEVICE no longer needs the organic first-run entry experience".
// It does NOT mean "has seen the Welcome screen", and it very deliberately does
// not mean "arrived once from a deep link" — a link tells us where somebody was
// going, not what they want from the product, and treating it as an answer would
// silently retire the first run for anybody who ever tapped a shared match.
//
// Two rules, plus the invitation model that replaced the old deep-link bypass.
// Each has a test below, along with the cases that would break it.

import fs from 'fs';
import path from 'path';

import { decideEntry, inviteFromPending } from '@/navigation/entryGate';
import type { PendingAction } from '@/services/pendingAction';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function action(over: Partial<PendingAction> & Pick<PendingAction, 'kind'>): PendingAction {
  return {
    version: 2,
    createdAt: 1_700_000_000_000,
    origin: 'deep_link',
    ...over,
  } as PendingAction;
}

// ─── Rule 1 — a full account never meets the first run ────────────────────

describe('a full account', () => {
  it('goes straight to the app whatever is on disk — existing users keep their app', () => {
    expect(decideEntry({ isGuest: false, organicCompleted: false })).toBe('app');
  });

  it('is not held on the splash waiting for a read that cannot change the answer', () => {
    expect(decideEntry({ isGuest: false, organicCompleted: null })).toBe('app');
  });
});

// ─── Rule 2 — a guest who answered never sees it again ────────────────────

describe('a guest', () => {
  it('who already chose an intent goes to the app', () => {
    expect(decideEntry({ isGuest: true, organicCompleted: true })).toBe('app');
  });

  it('who has never been asked sees the entry stack', () => {
    expect(decideEntry({ isGuest: true, organicCompleted: false })).toBe('entry');
  });
});

describe('while the disk read is in flight', () => {
  it('renders the splash, never Welcome and never the tabs', () => {
    expect(decideEntry({ isGuest: true, organicCompleted: null })).toBe('unknown');
  });
});

// ─── A deep link no longer skips the flow ─────────────────────────────────

describe('somebody who followed an invitation', () => {
  it('still meets Welcome and the intent question', () => {
    // The whole redesign in one assertion: arriving on a link changes what the
    // intent screen OFFERS, not whether it is shown.
    expect(decideEntry({ isGuest: true, organicCompleted: false })).toBe('entry');
  });

  it('has no bypass left to accidentally re-introduce', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    expect(Object.keys(require('@/navigation/entryGate'))).not.toContain(
      'computeEntryBypass',
    );
    expect(read(path.join('src', 'navigation', 'RootNavigator.tsx'))).not.toContain(
      'entryBypass',
    );
  });
});

// ─── Which invite card, from what is stashed ──────────────────────────────

describe('the invitation is read off the pending action', () => {
  it('a game link becomes a game card, carrying the target and the inviter', () => {
    expect(
      inviteFromPending(action({ kind: 'open_game', targetId: 'g1', invitedBy: 'u1' })),
    ).toEqual({ kind: 'game', targetId: 'g1', invitedBy: 'u1' });
  });

  it('a club link becomes a club card', () => {
    expect(
      inviteFromPending(action({ kind: 'open_club', targetId: 'c1', invitedBy: 'u1' })),
    ).toEqual({ kind: 'club', targetId: 'c1', invitedBy: 'u1' });
  });

  it('a personal link with no target becomes a referral card', () => {
    expect(inviteFromPending(action({ kind: 'open_invite', invitedBy: 'u1' }))).toEqual({
      kind: 'referral',
      invitedBy: 'u1',
    });
  });

  it('a SHARED game link with no inviter still gets a card', () => {
    // Without it the person is stranded: the flow no longer skips to the
    // target, so the card is the only way back to the thing they tapped.
    expect(inviteFromPending(action({ kind: 'open_game', targetId: 'g1' }))).toEqual({
      kind: 'game',
      targetId: 'g1',
      invitedBy: undefined,
    });
  });

  it('an install-referrer open_invite with NO inviter gets nothing', () => {
    // Found on a device: an ordinary Play Store install stashes
    // `{type:'app', source:'google-play'}` with nobody attached. Rendering
    // "הוזמנת על ידי" for that is the app inventing a friend.
    expect(inviteFromPending(action({ kind: 'open_invite' }))).toBeNull();
  });

  it('unfinished work is not an invitation', () => {
    expect(inviteFromPending(action({ kind: 'create_club', draftId: 'd1' }))).toBeNull();
    expect(inviteFromPending(null)).toBeNull();
  });
});

// ─── The three standing cards never change ────────────────────────────────

describe('the standing choices', () => {
  const src = read(path.join('src', 'screens', 'entry', 'IntentScreen.tsx'));

  it('are one constant list the invitation is PREPENDED to', () => {
    expect(src).toMatch(/const STANDING: Choice\[\] = \[/);
    expect(src).toContain('[inviteChoice, ...STANDING]');
  });

  it('are never filtered, reordered or swapped when an invitation exists', () => {
    const after = src.slice(src.indexOf('const inviteChoice'));
    expect(after).not.toMatch(/STANDING\.(filter|slice|reverse|map)\(/);
  });
});

// ─── Declining the invitation must stick ──────────────────────────────────

describe('choosing something other than the invitation', () => {
  const store = read(path.join('src', 'store', 'entryStore.ts'));
  const nav = read(path.join('src', 'navigation', 'RootNavigator.tsx'));
  const gate = read(path.join('src', 'navigation', 'entryGate.ts'));
  void gate;

  it('suppresses the auto-consume that would drag them to the target', () => {
    expect(store).toContain("suppressAutoConsume: intent !== 'invite'");
    expect(nav).toContain('useEntryStore.getState().suppressAutoConsume');
  });

  it('but leaves the stash alone, so attribution still lands at signup', () => {
    // `clearPendingAction` also clears the legacy key that
    // `applyInviteAttributionIfFresh` reads. Suppression must never call it.
    const choose = store.slice(store.indexOf('chooseIntent: async'), store.indexOf('markAccountSeen'));
    expect(choose).not.toContain('clearPendingAction');
    expect(choose).not.toContain('draftStore');
  });

  it('and choosing the invitation does NOT suppress it — the consumer opens the target', () => {
    expect(nav).toContain("if (intent === 'invite') return;");
  });
});

// ─── entry_source, reported honestly ──────────────────────────────────────

describe('the launch source is published, not guessed', () => {
  // `guest_home_viewed` hardcoded `entry_source: 'organic'` on the reasoning
  // that a deep link never renders that screen. It does:
  // `navigatePersonalInvite` addresses ProfileTab with `initial:false` so the
  // Home sits underneath the landing as a back target. A device run logged
  // `entry_source_resolved{personal_invite}` and `guest_home_viewed{organic}`
  // for the same launch, eleven seconds apart.
  const app = read('App.tsx');
  const home = read(path.join('src', 'screens', 'home', 'GuestHomeScreen.tsx'));

  it('App.tsx publishes what it resolved', () => {
    expect(app).toContain('setEntrySource(source as EntrySource)');
    // Published BEFORE the event, so a reader that runs on the same tick as
    // the report cannot see the stale value.
    expect(app.indexOf('setEntrySource(source as EntrySource)')).toBeLessThan(
      app.indexOf('AnalyticsEvent.EntrySourceResolved'),
    );
  });

  it('the guest Home reads it instead of assuming', () => {
    expect(home).toContain('entry_source: getEntrySource()');
    expect(home).not.toContain("entry_source: 'organic'");
  });

  it('defaults to unknown, never to organic', () => {
    // A wrong-but-plausible value is worse in a funnel than one that admits
    // it does not know — `organic` as a default would quietly absorb every
    // launch whose resolution had not landed yet.
    const svc = read(path.join('src', 'services', 'entrySource.ts'));
    expect(svc).toMatch(/let current: EntrySource = 'unknown';/);
  });

  it('round-trips every value in the vocabulary', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const m = require('@/services/entrySource');
    expect(m.getEntrySource()).toBe('unknown');
    for (const v of ['organic', 'game_link', 'club_link', 'personal_invite']) {
      m.setEntrySource(v);
      expect(m.getEntrySource()).toBe(v);
    }
    m.resetEntrySource();
    expect(m.getEntrySource()).toBe('unknown');
  });
});

// ─── The card title does not orphan a word ────────────────────────────────

describe('typography', () => {
  it('breaks "מקים מועדון עם החבר׳ה" explicitly, not wherever it lands', () => {
    const he = read(path.join('src', 'i18n', 'he.ts'));
    const line = he.split('\n').find((l) => l.includes('entryIntentClubTitle'));
    expect(line).toBeDefined();
    // The hard break is width-independent. Left to wrap, every card width wide
    // enough for the subtitle still fits "עם" on line one and orphans it.
    expect(line).toContain('\\n');
  });
});

// ─── Loading and welcome are ONE screen ───────────────────────────────────

describe('the launch screen', () => {
  const splash = read(path.join('src', 'screens', 'SplashScreen.tsx'));
  const app = read('App.tsx');
  const stack = read(path.join('src', 'navigation', 'EntryStack.tsx'));

  it('holds for somebody new instead of dismissing', () => {
    expect(splash).toContain('awaitStart');
    // The bar gives way to the button; the screen does not move on by itself.
    expect(splash).toMatch(/if \(awaitStart\) \{[\s\S]*setShowCta\(true\)/);
  });

  it('dismisses on its own for everybody else', () => {
    const after = splash.slice(splash.indexOf('if (awaitStart)'));
    expect(after).toMatch(/return;\s*\}\s*dismiss\(\);/);
  });

  it('decides who is new with the SAME pure gate the navigator uses', () => {
    // Two different answers to "is this person new" is how a returning user
    // ends up staring at a button that should never have appeared.
    expect(app).toContain('decideEntry({');
    expect(app).toContain('awaitStart={needsWelcome}');
  });

  it('waits for the entry flag before it stops holding', () => {
    // Dismissing first and discovering afterwards that a welcome was owed
    // would flash the tabs at a brand-new person.
    expect(app).toContain('entryOrganicCompleted !== null');
  });

  it('does not re-draw the wordmark or slogan that are inside the artwork', () => {
    const he = read(path.join('src', 'i18n', 'he.ts'));
    expect(he).not.toContain('entryWelcomeTitle');
    expect(he).not.toContain('entryWelcomeBody');
    expect(splash).not.toContain('Teamder</Text>');
  });

  it('left the entry stack with only the intent question', () => {
    expect(stack).not.toContain('WelcomeScreen');
    expect(stack).toContain("initialRouteName=\"EntryIntent\"");
  });

  it('keeps the welcome funnel counting', () => {
    expect(splash).toContain('AnalyticsEvent.EntryWelcomeViewed');
    expect(splash).toContain('AnalyticsEvent.EntryWelcomeContinued');
  });
});

// ─── The launch artwork is used as delivered ──────────────────────────────

describe('the launch artwork', () => {
  const hero = read(path.join('src', 'components', 'entry', 'SplashHero.tsx'));

  it('gives the bar and the button ONE slot, so one replaces the other', () => {
    const splash = read(path.join('src', 'screens', 'SplashScreen.tsx'));
    // Same container, same height — a swap, not a reflow.
    expect(splash).toContain('styles.barSlot');
    expect(splash).toContain('styles.ctaSlot');
    expect(splash).toMatch(/barSlot: \{ height: CTA_SLOT_H/);
    expect(splash).toMatch(/ctaSlot: \{ height: CTA_SLOT_H/);
  });

  it('fills the bar right-to-left without any flippable coordinate', () => {
    const splash = read(path.join('src', 'screens', 'SplashScreen.tsx'));
    const at = splash.indexOf('const fillStyle');
    // Strip comments before asserting — the comment explains WHY there is no
    // `translateX`, and matching the word inside it would fail for saying so.
    const fill = splash
      .slice(at, at + 420)
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    // A percentage width on an ordinary row child: forceRTL anchors it to the
    // right edge on its own. `left` would flip, `translateX` would need a
    // sign correction per locale.
    expect(fill).toContain('width: `${grow.value * 100}%`');
    expect(fill).not.toContain('left:');
    expect(fill).not.toContain('translateX');
  });

  it('is never stretched — the previous hero was padded by duplicating rows', () => {
    const art = read(path.join('src', 'components', 'entry', 'EntryArt.tsx'));
    for (const src of [hero, art]) {
      expect(src).not.toMatch(/resizeMode="stretch"/);
      expect(src).not.toMatch(/scaleY/);
    }
  });
});
