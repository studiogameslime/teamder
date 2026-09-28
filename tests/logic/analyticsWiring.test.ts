/**
 * Guard: every AnalyticsEvent constant must actually be called somewhere.
 *
 * A constant with no call site is dead weight that LOOKS like coverage — the
 * event name exists, a dashboard can be built around it, and it will never
 * arrive. That is exactly what happened once: 151 constants were added to the
 * object while only ~130 of the planned call sites were implemented, and the
 * gap was invisible because both halves individually looked fine.
 *
 * The pre-existing unwired constants (there from before this suite) are listed
 * explicitly. The list may SHRINK, never grow: adding a name here should be a
 * deliberate act with a reason, not the default way to make the test pass.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');
/** App.tsx sits at the repo root, outside src/. Leaving it out of the scan made
 *  three constants LOOK unwired and get allowlisted as "no literal call site"
 *  when they are ordinary AnalyticsEvent.X calls — an allowlist entry that
 *  would have masked a real regression later. */
const EXTRA_FILES = [join(ROOT, 'App.tsx')];
const SERVICE = join(SRC, 'services', 'analyticsService.ts');

/** Fired through a mechanism other than a direct AnalyticsEvent.X call site, or
 *  belonging to a native surface (Wear / widget) that lives outside src/. */
const KNOWN_UNWIRED = new Set<string>([
  // ── Emitted without a literal AnalyticsEvent.X call site ──
  // The navigation listener and the AppState handler fire these. All were
  // observed arriving in Joryio during the emulator run, so they work —
  // there is simply nothing for a grep to find.
  'SplashCompleted',

  // ── Native surfaces ──
  // Wear OS and the home widget live in plugins/wear-src and the widget
  // target, outside src/, so their call sites are not visible from here.
  'WatchActionReceived',
  'WatchDetected',
  'WatchSyncPushed',
  'WidgetOpened',
  'WidgetSyncPushed',
  'WidgetTimerAction',

  // ── Surface removed, constant kept ──
  // The communities feed's map button was taken out on 28.09 (owner: the row
  // carried three controls over one search field). `CommunitiesMap` and its
  // route are untouched and still reachable from the games feed; only this
  // entry point is gone, and its event with it. Restore both together — the
  // removed block is in git.
  'CommunitiesMapOpened',

  // ── Inherited: defined before this integration, never wired ──
  // Names reserved by an earlier pass with no call site behind them. Left
  // as-is rather than quietly deleted — each is a product decision about
  // whether the action is worth measuring. Wire one or remove one, but do
  // not grow this list: a NEW constant landing here is the bug this test
  // exists to catch.
  'AcceptsFillersToggled',
  'AchievementCardTapped',
  'CityPicked',
  'CitySearchPerformed',
  'CommunityCoverRemoved',
  'CommunitySearchPerformed',
  'ErrorBoundaryTriggered',
  'ErrorToastShown',
  'FillerInterestExpressed',
  'FillerInvitationAccepted',
  'GameLocked',
  'GamesTabSwitched',
  'GroupJoinApprovedByAdmin',
  'GroupJoinDeclinedByAdmin',
  'GroupMemberRemoved',
  'InviteCodeCopied',
  'InviteShareCompleted',
  'LiveMatchPhaseTransition',
  'NetworkFailure',
  'NotificationActionTapped',
  'OnboardingStepCompleted',
  'OrphanPromotedToCommunity',
  'ProfileSectionOpened',
  'PublicCommunitiesFeedOpened',
  'PublicPageDeepLinkOpened',
  'RsvpNudgeOpened',
  'StatsOpened',
  'WeatherFetched',
  'WhatsappShareLaunched',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('analytics wiring', () => {
  const service = readFileSync(SERVICE, 'utf8');
  const defined = [...service.matchAll(/^\s+([A-Z][A-Za-z]*):\s*'([a-z_]+)'/gm)]
    .map((m) => ({ key: m[1], value: m[2] }));

  const used = new Set<string>();
  for (const file of [...walk(SRC), ...EXTRA_FILES]) {
    if (file === SERVICE) continue;
    for (const m of readFileSync(file, 'utf8').matchAll(/AnalyticsEvent\.([A-Za-z]+)/g)) {
      used.add(m[1]);
    }
  }

  it('defines at least the events the app is known to have', () => {
    expect(defined.length).toBeGreaterThan(200);
  });

  it('has no duplicate event values', () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const { key, value } of defined) {
      const prev = seen.get(value);
      if (prev) dupes.push(`${value}: ${prev} + ${key}`);
      else seen.set(value, key);
    }
    expect(dupes).toEqual([]);
  });

  it('every constant has a call site', () => {
    const dead = defined
      .filter(({ key }) => !used.has(key) && !KNOWN_UNWIRED.has(key))
      .map(({ key, value }) => `${key} ('${value}')`);
    expect(dead).toEqual([]);
  });

  it('the known-unwired allowlist has not gone stale', () => {
    // If one of these gets wired, drop it from the list rather than leaving a
    // permanent exemption that quietly covers a future regression.
    const nowWired = [...KNOWN_UNWIRED].filter((k) => used.has(k));
    expect(nowWired).toEqual([]);
  });

  it('every value is snake_case and every key is PascalCase', () => {
    const bad = defined.filter(
      ({ key, value }) => !/^[A-Z][A-Za-z]*$/.test(key) || !/^[a-z][a-z0-9_]*$/.test(value),
    );
    expect(bad).toEqual([]);
  });
});
