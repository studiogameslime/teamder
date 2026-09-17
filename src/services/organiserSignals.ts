// Telling Joryio what kind of organiser this is, so a journey can say something
// true about their club.
//
// Joryio gets five user attributes from us and supports no merge fields, so a
// push cannot look anything up when it fires — whatever it will say has to be
// on the profile already. This keeps four facts fresh and raises an event on
// the three milestones where an organiser's situation genuinely changes.
//
// Called from the club screen, because that is where the roster is already in
// hand. Two consequences worth stating rather than discovering:
//
//   • The facts are only as fresh as the last time the organiser opened a club
//     screen. In practice somebody who shares an invite comes back to see who
//     joined, so they are usually current — but a push CAN name a number that
//     is a few members stale, and no journey should imply otherwise.
//   • It only ever reports clubs the person ADMINS. Belonging to a big club is
//     not running one, and being told to grow somebody else's squad is the
//     kind of message that gets an app muted.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { joryio } from '@/services/joryio';
import { logError } from '@/services/errorLog';
import {
  milestoneCrossed,
  organiserAttributes,
  PLAYABLE_ROSTER,
} from '@/utils/organiserState';
import type { Group, UserId } from '@/types';

/** The high-water mark per club, so a milestone fires once and churn is quiet.
 *  Local on purpose: it guards notifications, not data, and a reinstall
 *  re-sending one message is a smaller cost than a server round-trip here. */
const BEST_KEY = 'organiser:rosterBest:v1';

type Best = Record<string, number>;

async function readBest(): Promise<Best> {
  try {
    const raw = await AsyncStorage.getItem(BEST_KEY);
    return raw ? (JSON.parse(raw) as Best) : {};
  } catch {
    return {};
  }
}

/**
 * Report this organiser's clubs to Joryio.
 *
 * Safe to call on every club-screen load: attributes are idempotent, and the
 * milestone event is latched against the club's own previous best.
 */
export async function reportOrganiserState(
  userId: UserId,
  clubs: readonly Group[],
): Promise<void> {
  if (!userId) return;
  try {
    const mine = clubs.filter((g) => (g.adminIds ?? []).includes(userId));
    const sizes = mine.map((g) => (g.playerIds ?? []).length);
    await joryio.setAttributes({ ...organiserAttributes(sizes) });

    const best = await readBest();
    let changed = false;
    for (const g of mine) {
      const size = (g.playerIds ?? []).length;
      const crossed = milestoneCrossed(best[g.id] ?? 0, size);
      if (crossed === null) continue;
      logEvent(AnalyticsEvent.ClubRosterMilestone, {
        groupId: g.id,
        milestone: crossed,
        size,
      });
      // The one that ends the squad-building journey and begins the next.
      if (crossed >= PLAYABLE_ROSTER) {
        logEvent(AnalyticsEvent.ClubBecamePlayable, { groupId: g.id, size });
      }
      best[g.id] = Math.max(best[g.id] ?? 0, size);
      changed = true;
    }
    if (changed) await AsyncStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch (err) {
    // Never surfaced and never fatal: this feeds marketing, and a club screen
    // must not fail to render because an analytics attribute did not land.
    logError('reportOrganiserState', err, { userId });
  }
}
