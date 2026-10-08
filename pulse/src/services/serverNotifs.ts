// serverNotifs — the REAL notification history, straight from Firestore (every
// push ever sent to any user), unlike the local notifLog which only captures
// what Pulse itself was foregrounded for. Maps recipientId → user name and
// carries the per-send delivery stats so each row shows who got it and whether
// it landed.

import { listAll } from './firestoreRest';
import { PUSH_LABELS } from './pushStats';

export interface ServerNotif {
  id: string;
  type: string;
  label: string;
  recipientName: string;
  at: number;
  delivered: boolean;
  ok: number;
  failed: number;
  noToken: number;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

export async function fetchServerNotifs(limit = 250): Promise<ServerNotif[]> {
  const [notifs, users] = await Promise.all([
    listAll('notifications', 4000).catch(() => []),
    listAll('users').catch(() => []),
  ]);
  const nameById = new Map<string, string>();
  for (const u of users) if (typeof u.name === 'string') nameById.set(u.id, u.name);

  return notifs
    .map((n): ServerNotif => {
      const s = n.stats && typeof n.stats === 'object' ? (n.stats as Record<string, unknown>) : {};
      const type = typeof n.type === 'string' ? n.type : 'unknown';
      const rid = typeof n.recipientId === 'string' ? n.recipientId : '';
      return {
        id: n.id,
        type,
        label: PUSH_LABELS[type] ?? type,
        recipientName: nameById.get(rid) ?? (rid ? `${rid.slice(0, 6)}…` : '—'),
        at: typeof n.createdAt === 'number' ? n.createdAt : 0,
        delivered: n.delivered === true,
        ok: num(s.ok),
        failed: num(s.failed),
        noToken: num(s.skippedNoToken),
      };
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}
