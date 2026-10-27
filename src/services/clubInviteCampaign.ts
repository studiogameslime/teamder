import { Share } from 'react-native';
import { groupService } from '@/services/groupService';
import { useUserStore } from '@/store/userStore';
import { createShortInviteUrl } from '@/services/inviteLinkService';
import { deepLinkService } from '@/services/deepLinkService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { PLAYABLE_ROSTER } from '@/utils/organiserState';
import { he } from '@/i18n/he';

/** Private campaign action. Never resolves to whichever club happens to be selected. */
export function clubInviteCampaignId(url: string): string | null {
  return /^footy:\/\/club-invite\/([A-Za-z0-9_-]{1,128})$/.exec(url)?.[1] ?? null;
}

export async function eligibleClubInvite(url: string) {
  const groupId = clubInviteCampaignId(url);
  if (!groupId) return null;
  const uid = useUserStore.getState().currentUser?.id;
  if (!uid) return null;
  const group = await groupService.get(groupId, { fromServer: true });
  if (useUserStore.getState().currentUser?.id !== uid) return null;
  if (!group || group.isPersonal || !group.adminIds.includes(uid) || group.playerIds.length >= PLAYABLE_ROSTER) return null;
  return { group, uid };
}

/** The platform reports a completed share sheet, never proof of a delivered WhatsApp message. */
export async function shareClubInviteCampaign(url: string, campaignId: string): Promise<boolean> {
  const eligible = await eligibleClubInvite(url);
  if (!eligible) return false;
  const { group, uid } = eligible;
  const link = await createShortInviteUrl({ type: 'team', id: group.id, invitedBy: uid,
    fallbackLong: deepLinkService.buildInviteUrl({ type: 'team', id: group.id, invitedBy: uid }) });
  if (useUserStore.getState().currentUser?.id !== uid) return false;
  const result = await Share.share({ title: he.inviteShareSubject,
    message: he.communityInviteShareBody({ link, name: group.name, description: group.description }) });
  if (useUserStore.getState().currentUser?.id !== uid || result.action !== Share.sharedAction) return false;
  logEvent(AnalyticsEvent.InviteShared, { groupId: group.id, source: 'joryio_club_invite', campaignId });
  return true;
}
