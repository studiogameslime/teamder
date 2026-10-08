// The heart: pull every source, detect NEW reviews, fire notifications,
// and persist a snapshot for the UI. Each source is isolated so one
// failure (or one missing credential) never blocks the others.

import { TEAMDER_UID } from './teamderChatService';
import { config } from '../config';
import type {
  AnalyticsSummary,
  RatingSummary,
  RevenueSummary,
  Review,
} from '../types';
import { fetchAppStoreRating, fetchAppStoreReviews } from './appStoreConnect';
import { fetchPlayRating, fetchPlayReviews } from './googlePlay';
import { fetchRevenue } from './admob';
import { fetchAnalytics } from './analytics';
import { fetchAppleDownloads, fetchPlayDownloads } from './downloads';
import { notify } from './notify';
import { listChatReports, listRecentChatMessages } from './chatMonitorService';
import {
  addSeen,
  addSeenSet,
  getSeen,
  getSeenSet,
  getSnapshot,
  saveSnapshot,
  seedIfFirstRun,
  seedIfFirstRunSet,
  type Snapshot,
} from './store';

const stars = (n: number) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
const sourceLabel = (s: string) =>
  s === 'appstore' ? 'App Store' : 'Google Play';

// Each source is wrapped so one failure never aborts the poll — AND now with a
// hard timeout, so one hung store-scrape can't stall the whole (parallel) round
// and freeze the first-launch load behind it.
const SOURCE_TIMEOUT_MS = 12000;
async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timeout after ${SOURCE_TIMEOUT_MS}ms`)),
          SOURCE_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (e) {
    console.warn(`[poll] ${label} failed:`, (e as Error).message);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface PollResult {
  snapshot: Snapshot;
  newReviews: number;
  notified: boolean;
}

export async function runPoll(opts: { silent?: boolean } = {}): Promise<PollResult> {
  // ── ONE parallel round: every source fetched together ────────────
  // Previously this ran as 4 sequential await-stages (reviews → chat messages
  // → chat reports → ratings/revenue/analytics/downloads), so the first-launch
  // wall time was the SUM of the slow store scrapes. Now wall time ≈ the single
  // slowest source. The notification diffing further down runs on already-
  // fetched data (AsyncStorage + local push only), off the network path.
  const [
    asReviews,
    gpReviews,
    chatMsgs,
    chatReports,
    asRating,
    gpRating,
    revenue,
    analytics,
    iosDl,
    androidDl,
  ] = await Promise.all([
    safe('appstore reviews', () => fetchAppStoreReviews(50)),
    safe('play reviews', () => fetchPlayReviews(50)),
    safe('chat messages', () => listRecentChatMessages(40)),
    safe('chat reports', () => listChatReports()),
    safe('appstore rating', fetchAppStoreRating),
    safe('play rating', fetchPlayRating),
    safe('revenue', fetchRevenue),
    safe('analytics', fetchAnalytics),
    safe('apple downloads', () => fetchAppleDownloads(30)),
    safe('play downloads', fetchPlayDownloads),
  ]);
  const reviews: Review[] = [...(asReviews ?? []), ...(gpReviews ?? [])].sort(
    (a, b) => (a.createdAt < b.createdAt ? 1 : -1),
  );

  // ── new-review detection ─────────────────────────────────────────
  let newReviews = 0;
  let notified = false;
  const allIds = reviews.map((r) => r.id);
  const wasSeed = await seedIfFirstRun(allIds);
  if (!wasSeed && reviews.length) {
    const seen = await getSeen();
    const fresh = reviews.filter((r) => !seen.has(r.id));
    newReviews = fresh.length;
    if (fresh.length && !opts.silent) {
      // Notify newest-first, capped so we never spam.
      for (const r of fresh.slice(0, 5)) {
        await notify(
          `${stars(r.rating)}  ${sourceLabel(r.source)}`,
          (r.title ? r.title + ' — ' : '') + r.body,
          { type: 'review', reviewId: r.id, source: r.source },
        );
        notified = true;
      }
      if (fresh.length > 5) {
        await notify(
          `${config.appName}: ${fresh.length} ביקורות חדשות`,
          'יש עוד ביקורות חדשות לצפייה.',
        );
      }
    }
    if (fresh.length) await addSeen(fresh.map((r) => r.id));
  }

  // ── chat messages — a local push for every new message (sender + text) ──
  // (already fetched above in the single parallel round)
  if (chatMsgs && chatMsgs.length) {
    const ids = chatMsgs.map((m) => m.id);
    const seeded = await seedIfFirstRunSet('chatMsgs', ids);
    if (!seeded) {
      const seen = await getSeenSet('chatMsgs');
      // Oldest-first so the notifications arrive in send order.
      const fresh = chatMsgs.filter((m) => !seen.has(m.id)).reverse();
      if (fresh.length && !opts.silent) {
        for (const m of fresh.slice(0, 6)) {
          // A reply to one of OUR messages gets its own headline. The
          // collection-group query already returns these (they live under
          // dmConversations/*/messages), but as a generic "💬 name" they were
          // indistinguishable from any other chat traffic — and there is no
          // separate messages screen to catch them, so an unanswered reply
          // would simply go unnoticed.
          const isTeamderThread = m.parentId.includes(TEAMDER_UID);
          if (isTeamderThread && m.senderId === TEAMDER_UID) continue; // our own
          if (isTeamderThread) {
            await notify(
              `↩️ ${m.senderName || 'משתמש'} השיב ל-Teamder`,
              m.text || '(ללא טקסט)',
              { type: 'teamderReply', parentId: m.parentId, messageId: m.id },
            );
            notified = true;
            continue;
          }
          const where =
            m.scope === 'community' ? ' · מועדון' : m.scope === 'game' ? ' · משחק' : '';
          await notify(`💬 ${m.senderName || 'משתמש'}${where}`, m.text || '(ללא טקסט)', {
            type: 'chatMessage',
            scope: m.scope,
            parentId: m.parentId,
            messageId: m.id,
          });
          notified = true;
        }
        if (fresh.length > 6) {
          await notify(
            `${config.appName}: ${fresh.length} הודעות צ'אט חדשות`,
            'יש עוד הודעות חדשות בצ׳אטים.',
          );
        }
      }
      if (fresh.length) await addSeenSet('chatMsgs', fresh.map((m) => m.id));
    }
  }

  // ── chat reports — a local push when a user reports an abusive message ──
  // (already fetched above in the single parallel round)
  if (chatReports && chatReports.length) {
    const ids = chatReports.map((r) => r.id);
    const seeded = await seedIfFirstRunSet('chatReports', ids);
    if (!seeded) {
      const seen = await getSeenSet('chatReports');
      const fresh = chatReports.filter((r) => !seen.has(r.id)).reverse();
      if (fresh.length && !opts.silent) {
        for (const r of fresh.slice(0, 6)) {
          await notify(
            `🚩 דיווח על הודעה — ${r.senderName || 'משתמש'}`,
            r.messageText || '(ללא טקסט)',
            { type: 'chatReport', reportId: r.id },
          );
          notified = true;
        }
      }
      if (fresh.length) await addSeenSet('chatReports', fresh.map((r) => r.id));
    }
  }

  // ── ratings derived from the already-fetched sources ──────────────
  // NOTE: we deliberately do NOT load the users collection or derive app-stats
  // here. That used to read every user doc on every poll/open — the main
  // Firestore-read drain. The Users screen loads its list on demand, and the
  // Overview reads only cheap count()s. (See fetchUserCounts.)
  const ratings: RatingSummary[] = [asRating, gpRating].filter(
    Boolean,
  ) as RatingSummary[];

  // (New-signup pushes are sent server-side by the Teamder Cloud Function
  // `onNewUserJoined`, including the referral/campaign attribution — so Pulse
  // does NOT fire its own local signup notification, to avoid duplicates.)

  // Preserve previous values for any source that failed this round.
  const prev = await getSnapshot();
  const snapshot: Snapshot = {
    reviews: reviews.length ? reviews : prev.reviews,
    ratings: ratings.length ? ratings : prev.ratings,
    revenue: (revenue as RevenueSummary | null) ?? prev.revenue,
    analytics: (analytics as AnalyticsSummary | null) ?? prev.analytics,
    // Users/app-stats are no longer fetched on poll — preserve whatever the
    // Users screen last cached so dependent UI keeps its last-known values.
    users: prev.users,
    appStats: prev.appStats,
    downloads:
      iosDl || androidDl
        ? { ios: iosDl ?? null, android: androidDl ?? null }
        : prev.downloads,
    updatedAt: new Date().toISOString(),
  };
  await saveSnapshot(snapshot);

  return { snapshot, newReviews, notified };
}
