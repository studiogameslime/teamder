// pushStats — per-push-type analytics + delivery health. Every push writes a
// notifications/{id} doc carrying its `type` and, after dispatch, a
// `stats: { ok, failed, skippedPref, skippedNoToken }` block. So we get, fully
// server-side and exact (even per-type): how many were sent, delivered to FCM,
// failed (invalid token), had no token at all, or were muted by the user's
// prefs. "opened" (read===true) is surfaced honestly — ~0 until the app records
// taps in the next build.

import { listAll } from './firestoreRest';

// Hebrew labels for every Teamder NotificationType.
export const PUSH_LABELS: Record<string, string> = {
  joinRequest: 'בקשת הצטרפות למועדון',
  approved: 'בקשה אושרה',
  rejected: 'בקשה נדחתה',
  newGameInCommunity: 'משחק חדש במועדון',
  gameReminder: 'תזכורת למשחק',
  gameCanceledOrUpdated: 'משחק בוטל / עודכן',
  spotOpened: 'מקום התפנה',
  spotOffered: 'מקום הוצע (לאישור)',
  gamePlayersJoined: 'שחקנים הצטרפו (מרוכז)',
  growthMilestone: 'אבן דרך (אדמין)',
  inviteToGame: 'הזמנה למשחק',
  addedToGame: 'נוספת למשחק',
  rateReminder: 'תזכורת לדרג',
  gameFillingUp: 'המשחק מתמלא',
  gameRsvpNudge: 'תזכורת RSVP (5ש׳ לפני)',
  playerCancelled: 'שחקן ביטל (לאדמין)',
  groupDeleted: 'מועדון נמחק',
  promotePrompt: 'הצעת קידום',
  groupInvitation: 'הזמנה למועדון',
  gameShortageWarning: 'אזהרת מחסור שחקנים',
  friendRequest: 'בקשת חברות',
  friendRequestAccepted: 'בקשת חברות אושרה',
  teamsGenerated: 'הכוחות מוכנים',
  dmMessage: 'הודעה פרטית',
  chatMessage: 'הודעת צ׳אט',
};

export interface PushTypeRow {
  type: string;
  label: string;
  sent: number;
  opened: number;
  ok: number; // delivered to FCM
  failed: number; // invalid/stale token
  noToken: number; // recipient had no token
}

export interface PushStats {
  totalSent: number;
  totalOpened: number;
  totalOk: number;
  totalFailed: number;
  totalNoToken: number;
  totalPrefOff: number; // muted by the user's notification prefs
  rows: PushTypeRow[];
}

const numField = (v: unknown): number => (typeof v === 'number' ? v : 0);

export async function fetchPushStats(): Promise<PushStats> {
  const notifs = await listAll('notifications', 4000).catch(() => []);
  const byType = new Map<string, Omit<PushTypeRow, 'type' | 'label'>>();
  let totalPrefOff = 0;

  for (const n of notifs) {
    const type = typeof n.type === 'string' ? n.type : 'unknown';
    const s = n.stats && typeof n.stats === 'object' ? (n.stats as Record<string, unknown>) : {};
    const e =
      byType.get(type) ?? { sent: 0, opened: 0, ok: 0, failed: 0, noToken: 0 };
    e.sent += 1;
    if (n.read === true) e.opened += 1;
    e.ok += numField(s.ok);
    e.failed += numField(s.failed);
    e.noToken += numField(s.skippedNoToken);
    totalPrefOff += numField(s.skippedPref);
    byType.set(type, e);
  }

  const rows: PushTypeRow[] = Array.from(byType.entries())
    .map(([type, v]) => ({ type, label: PUSH_LABELS[type] ?? type, ...v }))
    .sort((a, b) => b.sent - a.sent);

  return {
    totalSent: rows.reduce((s, r) => s + r.sent, 0),
    totalOpened: rows.reduce((s, r) => s + r.opened, 0),
    totalOk: rows.reduce((s, r) => s + r.ok, 0),
    totalFailed: rows.reduce((s, r) => s + r.failed, 0),
    totalNoToken: rows.reduce((s, r) => s + r.noToken, 0),
    totalPrefOff,
    rows,
  };
}
