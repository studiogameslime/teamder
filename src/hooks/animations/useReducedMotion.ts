import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * True when the OS/user asked to minimise motion (iOS "Reduce Motion",
 * Android "Remove animations"). Every product animation must degrade to a
 * short fade — no arcs, card shuffles, jumps, or rolling balls — when this is
 * true. Live-updates if the setting is toggled while the app is open.
 *
 * Best-effort: any failure resolves to `false` (motion allowed) so the check
 * can never block a business action.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReduced(!!v);
      })
      .catch(() => {
        /* setting unavailable → assume motion allowed */
      });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) =>
      setReduced(!!v),
    );
    return () => {
      alive = false;
      // RN returns an EmitterSubscription with .remove(); guard for older shims.
      sub?.remove?.();
    };
  }, []);

  return reduced;
}
