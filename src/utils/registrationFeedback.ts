import { he } from '@/i18n/he';

/** Unknown outcomes must never be announced as a confirmed registration. */
export function registrationFeedback(bucket: string): { label: string; tone: 'success' | 'info' } | null {
  if (bucket === 'players') return { label: he.toastGameJoined, tone: 'success' };
  if (bucket === 'waitlist') return { label: he.toastGameJoinedWaitlist, tone: 'info' };
  if (bucket === 'pending') return { label: he.toastGameJoinedPending, tone: 'info' };
  return null;
}
