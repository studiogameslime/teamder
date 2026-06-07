// remoteConfigService — server-tunable knobs via Firebase Remote Config.
//
// Lets us adjust things like app-open ad frequency LIVE from the Firebase
// console with NO app release (and run A/B tests, or kill-switch a format if
// users revolt). Degrades gracefully: if the native module isn't linked
// (Expo Go / a dev client before rebuild) every getter returns its in-code
// default, so callers never need to feature-detect.
//
// Reads are synchronous: after `initRemoteConfig()` runs `setDefaults`, the
// native side answers `getValue()` instantly from its local store (default
// until a remote fetch activates). Before defaults are set the value source
// is "static" and we fall back to DEFAULTS, so a call that races boot is
// still safe.

import React from 'react';
import { logError, isExpectedDenial } from '@/services/errorLog';

// Keys + their in-code defaults. The defaults MUST stay sensible on their
// own — they're what ships in the binary and what every user gets until a
// remote value is published. Publish the SAME keys in the Firebase console
// to override.
export const RC_DEFAULTS = {
  // ── App-open ad frequency (adsService.showAppOpenAdIfAvailable) ──
  app_open_ad_enabled: true, // master kill-switch for the format
  app_open_cooldown_ms: 4 * 60 * 60 * 1000, // ≥ this between shows
  app_open_max_per_day: 3,
  app_open_new_user_grace_ms: 2 * 24 * 60 * 60 * 1000, // fresh-account honeymoon
  app_open_intentful_suppress_ms: 20 * 1000, // window after a push/link open

  // ── Banner ad (adsService.BannerAd) ──
  banner_enabled: true, // kill-switch for the bottom banner

  // ── Feature kill-switches — flip to false to hide an entry point ──
  feature_quick_games: true,
  feature_referrals: true,
  feature_friends: true,
  feature_feedback: true,
  feature_ios_clipboard_invite: true,
  // Master kill-switch for the whole campaigns/in-app system: popup display,
  // the per-launch eligibility query, presence ping, and engagement events.
  // Flip to false in Remote Config to disable it all WITHOUT a new app build.
  feature_campaigns: true,

  // ── Maintenance mode — blocking full-screen gate ──
  maintenance_mode: false,
  maintenance_message: '', // shown on the gate; falls back to a default string

  // ── Store-review prompt (storeReviewService) ──
  review_prompt_enabled: true,
  review_prompt_cooldown_days: 90,

  // ── Editable content / links ──
  support_email: 'studiogameslime@gmail.com',
  store_url_ios: 'https://apps.apple.com/app/id6775178022',
  store_url_android:
    'https://play.google.com/store/apps/details?id=com.studiogameslime.soccerapp',

  // ── In-app announcement banner ──
  announcement_enabled: false,
  announcement_text: '',
  announcement_url: '', // optional: tapping the banner opens this
} as const;

type RcKey = keyof typeof RC_DEFAULTS;

type RcValue = {
  asNumber: () => number;
  asBoolean: () => boolean;
  asString: () => string;
  getSource: () => 'remote' | 'default' | 'static';
};
type RcInstance = {
  setConfigSettings: (s: { minimumFetchIntervalMillis: number }) => Promise<unknown>;
  setDefaults: (d: Record<string, number | string | boolean>) => Promise<unknown>;
  fetchAndActivate: () => Promise<boolean>;
  getValue: (key: string) => RcValue;
};
type RcModule = { default?: () => RcInstance };

let instance: RcInstance | null = null;
let loaded = false;

// Bumped once fetch+activate lands so React consumers can re-render with the
// freshly fetched values (needed for UI-reactive flags: maintenance gate,
// announcement banner, feature kill-switches hiding a button).
let activatedTick = 0;
const listeners = new Set<() => void>();
function notifyActivated(): void {
  activatedTick += 1;
  listeners.forEach((l) => l());
}

function load(): RcInstance | null {
  if (loaded) return instance;
  loaded = true;
  try {
    // Indirect require so a missing native module → graceful no-op rather
    // than a bundle-time crash (Expo Go, dev client before a rebuild).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const m = require('@react-native-firebase/remote-config') as RcModule;
    instance = m?.default ? m.default() : null;
  } catch {
    instance = null;
  }
  return instance;
}

/**
 * Boot Remote Config: register defaults, then fetch+activate the latest
 * published values. Call once near startup. Safe to call when the native
 * module is absent (no-op) and never throws.
 */
export async function initRemoteConfig(): Promise<void> {
  const inst = load();
  if (!inst) return;
  try {
    await inst.setConfigSettings({
      // Dev: always fetch fresh. Prod: cache up to 1h so we don't hammer
      // the backend on every launch (Remote Config best practice).
      minimumFetchIntervalMillis: __DEV__ ? 0 : 60 * 60 * 1000,
    });
    await inst.setDefaults(
      RC_DEFAULTS as unknown as Record<string, number | string | boolean>,
    );
    await inst.fetchAndActivate();
  } catch (err) {
    // RC fetch failures are transient (network) and non-fatal — the
    // defaults are still registered below so the app behaves correctly.
    // Don't pollute the dashboard with them; only log the unexpected.
    const code = String((err as { code?: string })?.code ?? '');
    if (!isExpectedDenial(err) && !code.startsWith('remoteConfig/')) {
      logError('initRemoteConfig', err, {});
    }
    if (__DEV__) console.warn('[remoteConfig] init failed', err);
  } finally {
    // Even on a fetch failure, defaults are now registered — let consumers
    // re-render so they read default (not "static") values.
    notifyActivated();
  }
}

export function rcNumber(key: RcKey): number {
  const fallback = RC_DEFAULTS[key] as number;
  const inst = load();
  if (!inst) return fallback;
  try {
    const v = inst.getValue(key);
    // "static" = defaults not registered yet (raced boot) → use in-code value.
    if (v.getSource() === 'static') return fallback;
    return v.asNumber();
  } catch {
    return fallback;
  }
}

export function rcBool(key: RcKey): boolean {
  const fallback = RC_DEFAULTS[key] as boolean;
  const inst = load();
  if (!inst) return fallback;
  try {
    const v = inst.getValue(key);
    if (v.getSource() === 'static') return fallback;
    return v.asBoolean();
  } catch {
    return fallback;
  }
}

export function rcString(key: RcKey): string {
  const fallback = RC_DEFAULTS[key] as string;
  const inst = load();
  if (!inst) return fallback;
  try {
    const v = inst.getValue(key);
    if (v.getSource() === 'static') return fallback;
    return v.asString();
  } catch {
    return fallback;
  }
}

/**
 * Re-render a component when Remote Config activates (after the boot fetch).
 * Returns a tick that changes on activation — use it so UI-reactive flags
 * (maintenance gate, announcement, hidden buttons) reflect fetched values.
 */
export function useRemoteConfig(): number {
  const [tick, setTick] = React.useState(activatedTick);
  React.useEffect(() => {
    const cb = (): void => setTick(activatedTick);
    listeners.add(cb);
    // Catch an activation that landed between render and effect.
    if (activatedTick !== tick) setTick(activatedTick);
    return () => {
      listeners.delete(cb);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return tick;
}

export const remoteConfigService = {
  initRemoteConfig,
  rcNumber,
  rcBool,
  rcString,
};
