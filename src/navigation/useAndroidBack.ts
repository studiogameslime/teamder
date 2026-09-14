// Android's hardware Back, made to behave the way people expect.
//
// Reported as "pressing back closes the app", and reproduced on an emulator:
// standing on the מחזורים tab and pressing back shut the app instead of
// returning home. There was no BackHandler anywhere in the codebase, so every
// press fell through to the platform default, and the platform default for a
// tab whose stack has nothing to pop is to leave the app.
//
// Three rules, in order:
//
//   1. Something to pop → pop it. A nested screen goes back one step, exactly
//      as the header arrow does.
//   2. On a tab root that is NOT home → go home. This is the one that was
//      missing, and the one people notice: back should walk you toward the
//      start of the app, not out of it.
//   3. On the home root → ask. One press arms it and shows a hint; a second
//      within two seconds leaves. An app that exits on a single stray press
//      loses whatever the person was in the middle of.
//
// iOS has no hardware back button, so none of this is registered there — the
// swipe-back gesture cannot close an app.

import { useEffect, useRef } from 'react';
import { BackHandler, Platform, ToastAndroid } from 'react-native';
// The shared ref carries no param list — it is used across stacks with
// different shapes — so this takes only the handful of methods it calls
// rather than fighting the generic.
interface NavRef {
  isReady(): boolean;
  canGoBack(): boolean;
  goBack(): void;
  getCurrentRoute(): { name: string } | undefined;
  getRootState(): NavState | undefined;
  navigate(name: string): void;
}

interface NavState {
  index?: number;
  routes?: Array<{ name: string; state?: NavState }>;
}

/** The tab that "back" walks toward — the first one, where home sits. */
const HOME_TAB = 'ProfileTab';

/** How long a first press stays armed. Long enough to be deliberate, short
 *  enough that a press a minute later is not treated as confirmation. */
const CONFIRM_WINDOW_MS = 2000;

/**
 * The focused TAB — the top-level route of the root navigator.
 *
 * Deliberately does not descend into the tab's own stack. Reading one level
 * deeper returns the SCREEN ('Profile') rather than the tab ('ProfileTab'),
 * which never matches HOME_TAB, so every press on the home screen was treated
 * as "not home", navigated to the tab it was already on, and reported itself
 * handled — leaving no way to ever leave the app by pressing back.
 */
function currentTabOf(state: NavState | undefined): string | undefined {
  return state?.routes?.[state.index ?? 0]?.name;
}

export function useAndroidBack(
  navigationRef: NavRef,
  hint: string,
) {
  const armedAt = useRef(0);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onBack = (): boolean => {
      if (!navigationRef.isReady()) return false;

      // 1. Anything to pop, anywhere in the nested stacks.
      if (navigationRef.canGoBack()) {
        navigationRef.goBack();
        return true;
      }

      // 2. A tab root that is not home — walk toward home rather than out.
      const route = navigationRef.getCurrentRoute();
      const state = navigationRef.getRootState();
      const activeTab = currentTabOf(state) ?? route?.name;

      if (activeTab && activeTab !== HOME_TAB) {
        navigationRef.navigate(HOME_TAB);
        return true;
      }

      // 3. Home root. Confirm before leaving.
      const now = Date.now();
      if (now - armedAt.current < CONFIRM_WINDOW_MS) {
        armedAt.current = 0;
        return false; // let Android close the app
      }
      armedAt.current = now;
      ToastAndroid.show(hint, ToastAndroid.SHORT);
      return true;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [navigationRef, hint]);
}
