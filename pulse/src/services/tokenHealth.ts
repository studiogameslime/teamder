// tokenHealth — push reachability, derived from REAL delivery outcomes rather
// than the user doc's token field (most users keep their tokens in a private
// /users/{uid}/private/push subdoc, so the root fcmTokens is empty — reading it
// wrongly flags everyone as token-less). Instead we aggregate each push's
// stats.{ok,failed,skippedNoToken} per recipient:
//   • reachable — at least one push was delivered to FCM (ok > 0).
//   • failing   — pushes were sent but NONE succeeded, with failures (stale token).
//   • noToken   — sent, none succeeded, no failures, server found no token.
// A high `failed` next to a positive `ok` is normal token churn (a stale token
// among several) — NOT unreachable.

import { listAll } from './firestoreRest';
import { isTestAccount } from './firebase';

export interface UnreachableUser {
  id: string;
  name: string;
  sent: number;
  ok: number;
  failed: number;
  noToken: number;
  reason: 'failing' | 'noToken';
}

export interface TokenHealth {
  targeted: number; // users who were sent ≥1 push
  reachable: number;
  failing: number;
  noToken: number;
  neverSent: number; // real users never targeted (reachability unknown)
  problems: UnreachableUser[]; // failing first, then noToken; capped
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
const PROBLEM_CAP = 150;

export async function fetchTokenHealth(): Promise<TokenHealth> {
  const [users, notifs] = await Promise.all([
    listAll('users').catch(() => []),
    listAll('notifications', 4000).catch(() => []),
  ]);
  const real = users.filter(
    (u) => !isTestAccount(u.email, u.name) && u.name !== 'משתמש שהוסר',
  );
  const realIds = new Set(real.map((u) => u.id));
  const nameById = new Map<string, string>();
  for (const u of real) nameById.set(u.id, typeof u.name === 'string' && u.name ? u.name : '—');

  // Aggregate delivery outcomes per recipient.
  const agg = new Map<string, { sent: number; ok: number; failed: number; noToken: number }>();
  for (const nt of notifs) {
    const rid = typeof nt.recipientId === 'string' ? nt.recipientId : '';
    if (!rid || !realIds.has(rid)) continue;
    const s = nt.stats && typeof nt.stats === 'object' ? (nt.stats as Record<string, unknown>) : {};
    const e = agg.get(rid) ?? { sent: 0, ok: 0, failed: 0, noToken: 0 };
    e.sent += 1;
    e.ok += num(s.ok);
    e.failed += num(s.failed);
    e.noToken += num(s.skippedNoToken);
    agg.set(rid, e);
  }

  let reachable = 0;
  let failing = 0;
  let noToken = 0;
  const failingUsers: UnreachableUser[] = [];
  const noTokenUsers: UnreachableUser[] = [];

  for (const [rid, a] of agg) {
    const name = nameById.get(rid) ?? '—';
    if (a.ok > 0) {
      reachable += 1;
    } else if (a.failed > 0) {
      failing += 1;
      failingUsers.push({ id: rid, name, ...a, reason: 'failing' });
    } else if (a.noToken > 0) {
      noToken += 1;
      noTokenUsers.push({ id: rid, name, ...a, reason: 'noToken' });
    }
    // else: ok=0, failed=0, noToken=0 → all muted by prefs; not a token problem.
  }

  failingUsers.sort((a, b) => b.failed - a.failed || b.sent - a.sent);
  noTokenUsers.sort((a, b) => b.sent - a.sent);

  return {
    targeted: agg.size,
    reachable,
    failing,
    noToken,
    neverSent: real.length - agg.size,
    problems: [...failingUsers, ...noTokenUsers].slice(0, PROBLEM_CAP),
  };
}
