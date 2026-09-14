// Keep the screen on while the app is in the foreground.
//
// Asked for outright: "while the app is open, the screen should not turn off".
// The reason is the pitch — a phone propped on a bag running the live timer,
// the teams list, or the round summary, glanced at from ten metres away. A
// display that sleeps every thirty seconds makes the app useless exactly when
// it is being relied on.
//
// Two things worth knowing about the way this is wired:
//
//   It follows the FOREGROUND, not the mount. The lock is released the moment
//   the app is backgrounded and re-taken when it returns. Left on mount alone,
//   a lock can outlive the screen that took it and quietly hold the display
//   awake behind other apps — the class of bug that shows up a day later as
//   "the battery died in my pocket".
//
//   It never throws. Keep-awake is a best-effort platform request; a device
//   that refuses is a device with a screen that sleeps, not a crash.
//
// The trade-off is real and belongs on the record: a screen that never sleeps
// costs battery. If that turns out to matter, the honest next step is to scope
// this to the screens where it earns its keep — the live match, the timer, the
// round summary — rather than to weaken it everywhere.

import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

// Loaded lazily and defensively. expo-keep-awake is a NATIVE module, so a
// JS bundle that references it while running on a binary built before the
// dependency existed throws at import time — "Cannot find native module
// 'ExpoKeepAwake'" — and takes the whole app down before the first screen.
// That happened on the first run of this hook against an older dev build.
//
// A screen that sleeps is a nuisance. An app that will not start is not, so
// the nicety is never allowed to be load-bearing.
type KeepAwake = {
  activateKeepAwakeAsync: (tag: string) => Promise<void>;
  deactivateKeepAwake: (tag: string) => void;
};

let mod: KeepAwake | null | undefined;
function keepAwake(): KeepAwake | null {
  if (mod !== undefined) return mod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    mod = require('expo-keep-awake') as KeepAwake;
  } catch {
    mod = null;
  }
  return mod;
}

/** One tag for the whole app, so activate/deactivate can never get out of step
 *  with a lock some other screen took. */
const TAG = 'teamder-app';

export function useScreenAwake(enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    let held = false;

    const api = keepAwake();
    if (!api) return;

    const acquire = () => {
      if (held) return;
      held = true;
      api.activateKeepAwakeAsync(TAG).catch(() => {
        held = false;
      });
    };

    const release = () => {
      if (!held) return;
      held = false;
      try {
        api.deactivateKeepAwake(TAG);
      } catch {
        /* already gone — nothing to undo */
      }
    };

    const onChange = (next: AppStateStatus) => {
      if (next === 'active') acquire();
      else release();
    };

    if (AppState.currentState === 'active') acquire();
    const sub = AppState.addEventListener('change', onChange);

    return () => {
      sub.remove();
      release();
    };
  }, [enabled]);
}
