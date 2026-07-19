import { useCallback, useEffect, useRef, useState } from 'react';

export interface OneShotAnimation {
  /** True while the animation for the current event should render. */
  visible: boolean;
  /** Pass to the animation's `onComplete` — hides it and frees the slot. */
  onComplete: () => void;
}

/**
 * Fires an animation EXACTLY ONCE per distinct `eventKey`, and never again for
 * a key already seen while this component stays mounted.
 *
 * This is the core guard against re-triggering from Firestore `onSnapshot`
 * updates, unrelated re-renders, or returning to a screen kept in the nav
 * stack: pass a key that changes ONLY on a genuinely new event — a promotion
 * id, a `registered@<gameId>` token, a draft pick id, etc. `null`/`undefined`
 * never fires.
 *
 * The seen-set lives in a ref, so it survives re-renders but resets on a true
 * unmount/remount — by which point any legitimate event carries a new id
 * anyway. State is only ever set for a NEW key, so this never loops.
 */
export function useOneShotAnimation(
  eventKey: string | number | null | undefined,
): OneShotAnimation {
  const fired = useRef<Set<string>>(new Set());
  const mounted = useRef(true);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (eventKey == null) return;
    const key = String(eventKey);
    if (fired.current.has(key)) return;
    fired.current.add(key);
    if (mounted.current) setVisible(true);
  }, [eventKey]);

  const onComplete = useCallback(() => {
    if (mounted.current) setVisible(false);
  }, []);

  return { visible, onComplete };
}
