import { useEffect, useReducer } from 'react';
import { AppState } from 'react-native';
import { invitationExpiry, invitationHasExpired, type ReceivedInvitation } from '@/utils/receivedInvitations';

/** Both the list and the badge age out cached rows, including after the app slept. */
export function useUnexpiredInvitations(items: ReceivedInvitation[]) {
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  const now = Date.now();
  const visible = items.filter(item => item.status !== 'expired' && !invitationHasExpired(item.payload, now));
  const next = visible.reduce((nearest, item) => {
    const expiry = invitationExpiry(item.payload);
    return expiry > 0 ? Math.min(nearest, expiry) : nearest;
  }, Infinity);

  useEffect(() => {
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(refresh, Math.min(2147483647, Math.max(0, next - Date.now())));
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [next, now]);
  return visible;
}
