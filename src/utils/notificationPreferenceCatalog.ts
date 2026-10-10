import type { Ionicons } from '@expo/vector-icons';
import type { NotificationPrefs } from '@/types';
import { he } from '@/i18n/he';
import { notificationPreferencesCopy as copy } from '@/i18n/notificationPreferences';

interface Row {
  key: keyof NotificationPrefs;
  label: string;
  sub: string;
}

interface Category {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  rows: Row[];
}

// Grouped by what the notification is about. Within each group, the most
// useful day-to-day items come first; chatty/optional ones last.
export const NOTIFICATION_CATEGORIES: Category[] = [
  {
    title: he.notifCategoryGames,
    icon: 'football-outline',
    rows: [
      { key: 'joinRequest', label: he.notifJoinRequest, sub: he.notifJoinRequestSub },
      { key: 'approvedRejected', label: he.notifApprovedRejected, sub: he.notifApprovedRejectedSub },
      { key: 'gamePlayersJoined', label: he.notifGamePlayersJoined, sub: he.notifGamePlayersJoinedSub },
      { key: 'playerCancelled', label: he.notifPlayerCancelled, sub: he.notifPlayerCancelledSub },
      { key: 'gameShortageWarning', label: he.notifGameShortageWarning, sub: he.notifGameShortageWarningSub },
      { key: 'gameCanceledOrUpdated', label: he.notifGameCanceledOrUpdated, sub: he.notifGameCanceledOrUpdatedSub },
      { key: 'spotOffered', label: copy.spotOffered[0], sub: copy.spotOffered[1] },
      { key: 'guestPromoted', label: copy.guestPromoted[0], sub: copy.guestPromoted[1] },
      { key: 'addedToGame', label: copy.addedToGame[0], sub: copy.addedToGame[1] },
      { key: 'teamsGenerated', label: copy.teamsGenerated[0], sub: copy.teamsGenerated[1] },
      { key: 'eveningSummary', label: copy.eveningSummary[0], sub: copy.eveningSummary[1] },
      { key: 'gameOnHoliday', label: copy.gameOnHoliday[0], sub: copy.gameOnHoliday[1] },
    ],
  },
  {
    title: he.notifCategoryCommunity,
    icon: 'people-outline',
    rows: [
      { key: 'newGameInCommunity', label: he.notifNewGameInCommunity, sub: he.notifNewGameInCommunitySub },
      { key: 'spotOpened', label: he.notifSpotOpened, sub: he.notifSpotOpenedSub },
      { key: 'gameFillingUp', label: he.notifGameFillingUp, sub: he.notifGameFillingUpSub },
      { key: 'inviteToGame', label: he.notifInviteToGame, sub: he.notifInviteToGameSub },
      { key: 'groupDeleted', label: he.notifGroupDeleted, sub: he.notifGroupDeletedSub },
      { key: 'groupInvitation', label: copy.groupInvitation[0], sub: copy.groupInvitation[1] },
      { key: 'seasonSummary', label: copy.seasonSummary[0], sub: copy.seasonSummary[1] },
      { key: 'promotePrompt', label: copy.promotePrompt[0], sub: copy.promotePrompt[1] },
      { key: 'friendRequest', label: copy.friendRequest[0], sub: copy.friendRequest[1] },
    ],
  },
  {
    title: he.notifCategoryReminders,
    icon: 'alarm-outline',
    rows: [
      { key: 'gameReminder', label: he.notifGameReminder, sub: he.notifGameReminderSub },
      { key: 'gameRsvpNudge', label: he.notifGameRsvpNudge, sub: he.notifGameRsvpNudgeSub },
      { key: 'rateReminder', label: he.notifRateReminder, sub: he.notifRateReminderSub },
      { key: 'growthMilestone', label: he.notifGrowthMilestone, sub: he.notifGrowthMilestoneSub },
    ],
  },
  { title: copy.categoryAvailability, icon: 'person-add-outline', rows: [
    { key: 'fillerOpportunity', label: copy.fillerOpportunity[0], sub: copy.fillerOpportunity[1] },
    { key: 'fillerInterestReceived', label: copy.fillerInterestReceived[0], sub: copy.fillerInterestReceived[1] },
    { key: 'fillerNoCandidates', label: copy.fillerNoCandidates[0], sub: copy.fillerNoCandidates[1] },
  ] },
  // The only category that is not one of our Cloud Functions. Turning this off
  // writes 'unsubscribed' on the Joryio push channel, which is what actually
  // stops the journey sends — our own CFs never look at it.
  {
    title: he.notifCategoryMarketing,
    icon: 'megaphone-outline',
    rows: [
      { key: 'marketingPush', label: he.notifMarketingPush, sub: he.notifMarketingPushSub },
    ],
  },
];

