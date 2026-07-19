import { useEffect, useRef } from 'react';

/**
 * The value from the previous committed render (`undefined` on first render).
 * Used by the animation-trigger logic to detect a *real* transition — e.g.
 * `previousStatus === 'waitlist' && currentStatus === 'registered'` — instead
 * of firing on the initial mount or on an unrelated re-render.
 */
export function usePreviousValue<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}
