import { resolveInviteActivity, MAX_CLUBS } from './personalInvite';
import { socialPlayersService } from './socialPlayersService';
import { groupService } from './groupService';
import type { Game, GroupPublic } from '@/types';

export type InviteLandingActivity = {
  games: Game[];
  clubs: GroupPublic[];
  gamesUnavailable?: boolean;
  clubsUnavailable?: boolean;
};

/** Guests use public listings only. Full accounts can also resolve clubs from
 * the existing social profile contract, independently of upcoming fixtures.
 * Club content still comes from public mirrors, never private group records. */
export async function resolveInviteLandingActivity(
  inviterId: string | undefined,
  viewerId: string,
  isGuest: boolean,
): Promise<InviteLandingActivity> {
  if (isGuest || !inviterId) return resolveInviteActivity(inviterId, viewerId);
  const [activity, profile] = await Promise.allSettled([
    resolveInviteActivity(inviterId, viewerId),
    socialPlayersService.profile(inviterId),
  ]);
  if (activity.status === 'rejected' && profile.status === 'rejected') throw activity.reason;
  const publicActivity = activity.status === 'fulfilled' ? activity.value : null;
  const ids = profile.status === 'fulfilled'
    ? [...new Set(profile.value.clubs.map(c => c.id))].slice(0, MAX_CLUBS)
    : [];
  const mirrors = await Promise.allSettled(ids.map(id => groupService.getPublic(id)));
  const clubs = new Map<string, GroupPublic>();
  for (const result of mirrors) {
    if (result.status === 'fulfilled' && result.value) clubs.set(result.value.id, result.value);
  }
  for (const club of publicActivity?.clubs ?? []) clubs.set(club.id, club);
  return {
    games: [...(publicActivity?.games ?? [])].sort((a, b) => a.startsAt - b.startsAt),
    clubs: [...clubs.values()].slice(0, MAX_CLUBS),
    ...(activity.status === 'rejected' ? { gamesUnavailable: true } : {}),
    ...(profile.status === 'rejected' || publicActivity?.clubsUnavailable ||
      mirrors.some(r => r.status === 'rejected') ? { clubsUnavailable: true } : {}),
  };
}
