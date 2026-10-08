// wearRelease — the Wear OS (watch) app's release info, kept separate from the
// phone release log since the watch ships on its own cadence. Stored at
// appConfig/wearRelease: { version, status, submittedAt?, releasedAt?, items[] }.

import { getDoc } from './firestoreRest';

export interface WearReleaseItem {
  title: string;
  kind: 'fix' | 'feature';
}

export type WearStatus = 'review' | 'submitted' | 'live';

export interface WearRelease {
  version: string;
  status: WearStatus;
  submittedAt?: number;
  releasedAt?: number;
  items: WearReleaseItem[];
}

export const WEAR_STATUS_HE: Record<WearStatus, { he: string; live: boolean }> = {
  review: { he: 'בבדיקה', live: false },
  submitted: { he: 'הוגש — ממתין לאישור', live: false },
  live: { he: 'באוויר', live: true },
};

export async function fetchWearRelease(): Promise<WearRelease | null> {
  const doc = await getDoc('appConfig/wearRelease').catch(() => null);
  if (!doc || !doc.version) return null;
  const items = Array.isArray(doc.items)
    ? (doc.items as any[]).map((i) => ({
        title: String(i?.title ?? ''),
        kind: i?.kind === 'feature' ? ('feature' as const) : ('fix' as const),
      }))
    : [];
  return {
    version: String(doc.version),
    status: (['review', 'submitted', 'live'] as const).includes(doc.status)
      ? (doc.status as WearStatus)
      : 'submitted',
    submittedAt: typeof doc.submittedAt === 'number' ? doc.submittedAt : undefined,
    releasedAt: typeof doc.releasedAt === 'number' ? doc.releasedAt : undefined,
    items,
  };
}
