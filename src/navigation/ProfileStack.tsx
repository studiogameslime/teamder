// Stack inside the Profile tab. The Profile screen is the landing; Stats,
// History, Edit, Availability, Admin Approval, and PlayerCard are all
// pushable from there.
//
// The match-detail chain (MatchDetails + LiveMatch + MatchPlayers +
// MatchManage + AvailablePlayers + GameEdit) is also registered here
// so that drilling from History → MatchDetails keeps navigation INSIDE
// ProfileStack — back returns to History rather than dumping the user
// on GamesList. Same trick we use in CommunitiesStack. CommunityDetails
// is registered for the same reason: MatchDetails-from-Profile has a
// community-link icon, and the user expects back to return to the
// match, not to the Communities tab.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useIsGuest } from '@/hooks/useAuthenticatedAction';
import { homeRouteFor } from '@/navigation/homeRouting';

export type ProfileStackParamList = {
  /** Option A Home — the guest's landing. See the note on the navigator. */
  GuestHome: undefined;
  /**
   * The personal-invite landing. Lives in THIS stack so its close/explore
   * action lands on the Home beside it and the bottom tabs stay put — an
   * invitation is an arrival inside Teamder, not a page in front of it.
   */
  PersonalInvite: { invitedBy?: string; source?: string } | undefined;
  Profile: undefined;
  Requests: { groupId?: string } | undefined;
  ProfileEdit: undefined;
  AvailabilityEdit: undefined;
  AvailabilityWeek: undefined;
  NotificationsSettings: undefined;
  BlockedUsers: undefined;
  PlayerCard: { userId: string; groupId?: string };
  // Registered HERE too, and that is the point: the player card reached from
  // this stack now offers the two-player screen, and a route a stack hosts a
  // link to but does not declare makes `navigate()` fail in silence — the
  // gap this screen's own investigation found.
  PlayerCompare: { groupId: string; otherUid: string; otherName?: string };
  /** Admin-only per-community player timeline — reachable from
   *  CommunityPlayers (opened via a MatchDetails community-link). */
  PlayerTimeline: { userId: string; groupId: string; name?: string };
  AdminApproval: { groupId?: string } | undefined;
  History: undefined;
  Achievements: undefined;
  SeasonTitles: undefined;
  Statistics: { userId?: string } | undefined;
  SocialPrivacy: undefined;
  Friends: undefined;
  Referrals: undefined;
  Feedback: { type?: 'bug' | 'suggestion'; playerId?: string; playerName?: string } | undefined;
  // Match-detail chain — same routes as GameStack/CommunitiesStack,
  // duplicated so back returns to the screen the user came from
  // (typically History).
  // `initialTab` names which of the four tabs opens first. It exists because the
  // statistics tab IS the evening's summary now — the standalone RoundSummary
  // screen was removed — so anything that used to send a person to that summary
  // sends them here instead. Absent → "מידע", which is what every existing
  // caller passes and expects.
  MatchDetails: { gameId: string; initialTab?: 'info' | 'games' | 'stats' | 'players' };
  // Draft Teams (חלוקת כוחות) — reachable from MatchDetails' "קביעת כוחות".
  DraftSetup: { gameId: string; returnRouteKey?: string; resumeManual?: boolean; editExisting?: boolean };
  DraftBoard: {
    gameId: string;
    returnRouteKey?: string;
    captainIds: string[];
    method: 'snake' | 'regular';
    resume?: boolean;
    expectedDraftCreatedAt?: number;
    readOnly?: boolean;
  };
  EveningSummary: { gameId: string };
  MyActivity: undefined;
  /** `seasonId` omitted = the season currently running. */
  SeasonSummary: { groupId: string; seasonId?: string };
  // `live` is set when the screen is opened from the live screen mid-evening.
  // It changes the title and the empty-state copy and adds a refresh on
  // focus; the list itself is the same committed round history either way.
  MatchRounds: { gameId: string; live?: boolean };
  MatchPlayers: { gameId: string };
  AvailablePlayers: { gameId: string };
  AddMembers: { gameId: string };
  GameEdit: { gameId: string };
  LiveMatch: { gameId: string };
  // Reachable from MatchDetails' community-link icon. The full set of
  // screens CommunityDetails links to is duplicated here so drilling from a
  // community opened in THIS stack stays in-stack — a route missing here
  // makes navigate() silently no-op (the "רשימת השחקנים does nothing" bug
  // when the club is opened from the Profile tab).
  CommunityDetails: { groupId: string };
  /** Reachable from GuestHome's «הקם מועדון». Registered HERE, not reached
   *  cross-tab, so Back from the wizard returns to Home rather than dumping
   *  the person on the clubs feed of a tab they never chose. */
  CommunitiesCreate: undefined;
  /** Reachable from a public club opened out of Home. */
  CommunityDetailsPublic: { groupId: string; fromInvitation?: boolean };
  /**
   * The contextual auth sheet's «המשך עם מייל» pushes this.
   *
   * It lives in AuthStack, which is only mounted when there is NO user — and
   * the sheet is only ever shown to a guest, who has one. So the navigate
   * resolved to nothing and the option has been dead since it shipped:
   * "The action 'NAVIGATE' with payload {name:'EmailAuth'} was not handled".
   * Registered here because this is the stack Home funnels through. The same
   * gap still exists from GameStack and CommunitiesStack — reported, not
   * fixed here, because those are not this round's screens.
   *
   * Safe to host: EmailAuthScreen never navigates. It signs in, the store
   * updates, and RootNavigator swaps the tree.
   */
  EmailAuth: undefined;
  CommunityEdit: { groupId: string };
  CommunityPlayers: { groupId: string };
  ManagerDashboard: { groupId: string; initialTab?: 'overview' | 'club' | 'ratings' | 'equipment'; initialFilter?: 'all' | 'up' | 'down' };
  CommunityStats: { groupId: string };
  CommunityHistory: { groupId: string };
  // CommunityDetails' "צור מחזור שבועי" opens the game-create wizard.
  GameCreate:
    | undefined
    | {
        groupId?: string;
        startsAt?: number;
        format?: import('@/types').GameFormat;
        numberOfTeams?: number;
        recurring?: boolean;
        quick?: boolean;
        prefillDateMs?: number;
        prefillWindow?: import('@/types').TimeBucket;
        prefillCity?: string;
        inviteAvailable?: boolean;
      };
};

// Screen modules are evaluated only when their route renders. Keep all route
// registrations local so shared destinations preserve their back stack.
const Stack = createNativeStackNavigator<ProfileStackParamList>();

/**
 * Who lands on which Home.
 *
 * A GUEST gets `GuestHome` — the Option A screen, which is the onboarding.
 * `ProfileScreen` is a dashboard built around a person: a greeting with their
 * name, their next match, their pending requests, their activation checklist.
 * A guest has none of those, so it rendered as a wall with one button, and
 * that button used to sign them out (round 7).
 *
 * A FULL ACCOUNT keeps `ProfileScreen`, whether they joined today or two years
 * ago. That is a deliberate choice and not an omission: ProfileScreen already
 * carries an activation checklist — photo, availability, club, match, invite —
 * gated on `homeDataReady` so it only judges once the data has loaded. It IS
 * the new-full-account experience, and replacing it with Option A would delete
 * a working one to install a second.
 *
 * Which leaves "new vs established full account" undecided, on purpose. There
 * is no clean signal for it: `groups.length === 0` means "in no club", which a
 * two-year veteran who left theirs also satisfies, and inventing a score to
 * separate them would be a guess applied to real people's home screens. The
 * signal used here — `isGuest` — is the auth state itself and cannot be wrong.
 */
export function ProfileStack() {
  const isGuest = useIsGuest();
  return (
    <Stack.Navigator
      // Remount when the viewer stops being a guest. `initialRouteName` is
      // read once, at mount, and the upgrade path that KEEPS the uid
      // (`linkWithCredential` — see authUpgrade) does not replace the session,
      // so without this a person who just registered would go on looking at
      // the guest Home until they happened to tap the tab. Both flows the key
      // covers are identity changes, which is the one moment a stack reset is
      // what you want anyway.
      key={isGuest ? 'guest' : 'member'}
      initialRouteName={homeRouteFor(isGuest)}
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="GuestHome" getComponent={() => require('@/screens/home/GuestHomeScreen').GuestHomeScreen as typeof import('@/screens/home/GuestHomeScreen').GuestHomeScreen} />
      <Stack.Screen name="PersonalInvite" getComponent={() => require('@/screens/invite/PersonalInviteScreen').PersonalInviteScreen as typeof import('@/screens/invite/PersonalInviteScreen').PersonalInviteScreen} />
      <Stack.Screen name="Profile" getComponent={() => require('@/screens/tabs/ProfileScreen').ProfileScreen as typeof import('@/screens/tabs/ProfileScreen').ProfileScreen} />
      <Stack.Screen name="CommunitiesCreate" getComponent={() => require('@/screens/groups/CreateGroupScreen').CreateGroupScreen as typeof import('@/screens/groups/CreateGroupScreen').CreateGroupScreen} />
      <Stack.Screen
        name="CommunityDetailsPublic"
        getComponent={() => require('@/screens/communities/CommunityDetailsPublicScreen').CommunityDetailsPublicScreen as typeof import('@/screens/communities/CommunityDetailsPublicScreen').CommunityDetailsPublicScreen}
      />
      <Stack.Screen name="EmailAuth" getComponent={() => require('@/screens/auth/EmailAuthScreen').EmailAuthScreen as typeof import('@/screens/auth/EmailAuthScreen').EmailAuthScreen} />
      <Stack.Screen name="AvailabilityWeek" getComponent={() => require('@/screens/home/AvailabilityWeekScreen').AvailabilityWeekScreen as typeof import('@/screens/home/AvailabilityWeekScreen').AvailabilityWeekScreen} />
      <Stack.Screen name="Requests" getComponent={() => require('@/screens/RequestsScreen').RequestsScreen as typeof import('@/screens/RequestsScreen').RequestsScreen} />
      <Stack.Screen name="ProfileEdit" getComponent={() => require('@/screens/tabs/ProfileEditScreen').ProfileEditScreen as typeof import('@/screens/tabs/ProfileEditScreen').ProfileEditScreen} />
      <Stack.Screen name="BlockedUsers" getComponent={() => require('@/screens/profile/BlockedUsersScreen').BlockedUsersScreen as typeof import('@/screens/profile/BlockedUsersScreen').BlockedUsersScreen} />
      <Stack.Screen
        name="AvailabilityEdit"
        getComponent={() => require('@/screens/profile/AvailabilityEditScreen').AvailabilityEditScreen as typeof import('@/screens/profile/AvailabilityEditScreen').AvailabilityEditScreen}
      />
      <Stack.Screen
        name="NotificationsSettings"
        getComponent={() => require('@/screens/profile/NotificationsSettingsScreen').NotificationsSettingsScreen as typeof import('@/screens/profile/NotificationsSettingsScreen').NotificationsSettingsScreen}
      />
      <Stack.Screen name="PlayerCard" getComponent={() => require('@/screens/players/PlayerCardScreen').PlayerCardScreen as typeof import('@/screens/players/PlayerCardScreen').PlayerCardScreen} />
      <Stack.Screen name="PlayerCompare" getComponent={() => require('@/screens/players/PlayerCompareScreen').PlayerCompareScreen as typeof import('@/screens/players/PlayerCompareScreen').PlayerCompareScreen} />
      <Stack.Screen name="PlayerTimeline" getComponent={() => require('@/screens/players/PlayerTimelineScreen').PlayerTimelineScreen as typeof import('@/screens/players/PlayerTimelineScreen').PlayerTimelineScreen} />
      <Stack.Screen name="AdminApproval" getComponent={() => require('@/screens/groups/AdminApprovalScreen').AdminApprovalScreen as typeof import('@/screens/groups/AdminApprovalScreen').AdminApprovalScreen} />
      <Stack.Screen name="History" getComponent={() => require('@/screens/tabs/HistoryScreen').HistoryScreen as typeof import('@/screens/tabs/HistoryScreen').HistoryScreen} />
      <Stack.Screen name="Achievements" getComponent={() => require('@/screens/profile/AchievementsScreen').AchievementsScreen as typeof import('@/screens/profile/AchievementsScreen').AchievementsScreen} />
      <Stack.Screen name="SeasonTitles" getComponent={() => require('@/screens/profile/SeasonTitlesScreen').SeasonTitlesScreen as typeof import('@/screens/profile/SeasonTitlesScreen').SeasonTitlesScreen} />
      <Stack.Screen name="Statistics" getComponent={() => require('@/screens/profile/StatisticsScreen').StatisticsScreen as typeof import('@/screens/profile/StatisticsScreen').StatisticsScreen} />
      <Stack.Screen name="SocialPrivacy" getComponent={() => require('@/screens/profile/SocialPrivacyScreen').SocialPrivacyScreen as typeof import('@/screens/profile/SocialPrivacyScreen').SocialPrivacyScreen} />
      <Stack.Screen name="Friends" getComponent={() => require('@/screens/profile/FriendsScreen').FriendsScreen as typeof import('@/screens/profile/FriendsScreen').FriendsScreen} />
      <Stack.Screen name="Referrals" getComponent={() => require('@/screens/profile/ReferralsListScreen').ReferralsListScreen as typeof import('@/screens/profile/ReferralsListScreen').ReferralsListScreen} />
      <Stack.Screen name="Feedback" getComponent={() => require('@/screens/FeedbackScreen').FeedbackScreen as typeof import('@/screens/FeedbackScreen').FeedbackScreen} />
      <Stack.Screen name="MatchDetails" getComponent={() => require('@/screens/games/MatchDetailsScreen').MatchDetailsScreen as typeof import('@/screens/games/MatchDetailsScreen').MatchDetailsScreen} />
      {/* Draft Teams (חלוקת כוחות) — MatchDetails is hosted in this stack too,
          so its "קביעת כוחות" action MUST be able to navigate here, else the tap
          silently no-ops when the game was opened from the Profile/Home tab. */}
      <Stack.Screen name="DraftSetup" getComponent={() => require('@/screens/games/DraftSetupScreen').DraftSetupScreen as typeof import('@/screens/games/DraftSetupScreen').DraftSetupScreen} />
      <Stack.Screen name="DraftBoard" getComponent={() => require('@/screens/games/DraftBoardScreen').DraftBoardScreen as typeof import('@/screens/games/DraftBoardScreen').DraftBoardScreen} />
      <Stack.Screen name="EveningSummary" getComponent={() => require('@/screens/games/EveningSummaryScreen').EveningSummaryScreen as typeof import('@/screens/games/EveningSummaryScreen').EveningSummaryScreen} />
      <Stack.Screen name="MyActivity" getComponent={() => require('@/screens/profile/MyActivityScreen').MyActivityScreen as typeof import('@/screens/profile/MyActivityScreen').MyActivityScreen} />
      <Stack.Screen name="SeasonSummary" getComponent={() => require('@/screens/profile/SeasonSummaryScreen').SeasonSummaryScreen as typeof import('@/screens/profile/SeasonSummaryScreen').SeasonSummaryScreen} />
      <Stack.Screen name="MatchRounds" getComponent={() => require('@/screens/games/MatchRoundsScreen').MatchRoundsScreen as typeof import('@/screens/games/MatchRoundsScreen').MatchRoundsScreen} />
      <Stack.Screen name="AddMembers" getComponent={() => require('@/screens/games/AddMembersScreen').AddMembersScreen as typeof import('@/screens/games/AddMembersScreen').AddMembersScreen} />
      <Stack.Screen name="MatchPlayers" getComponent={() => require('@/screens/games/MatchPlayersScreen').MatchPlayersScreen as typeof import('@/screens/games/MatchPlayersScreen').MatchPlayersScreen} />
      <Stack.Screen name="AvailablePlayers" getComponent={() => require('@/screens/games/AvailablePlayersScreen').AvailablePlayersScreen as typeof import('@/screens/games/AvailablePlayersScreen').AvailablePlayersScreen} />
      <Stack.Screen name="GameEdit" getComponent={() => require('@/screens/games/GameEditScreen').GameEditScreen as typeof import('@/screens/games/GameEditScreen').GameEditScreen} />
      <Stack.Screen name="LiveMatch" getComponent={() => require('@/screens/LiveMatchScreen').LiveMatchScreen as typeof import('@/screens/LiveMatchScreen').LiveMatchScreen} />
      <Stack.Screen name="CommunityDetails" getComponent={() => require('@/screens/communities/CommunityDetailsScreen').CommunityDetailsScreen as typeof import('@/screens/communities/CommunityDetailsScreen').CommunityDetailsScreen} />
      <Stack.Screen name="CommunityEdit" getComponent={() => require('@/screens/communities/CommunityEditScreen').CommunityEditScreen as typeof import('@/screens/communities/CommunityEditScreen').CommunityEditScreen} />
      <Stack.Screen name="CommunityPlayers" getComponent={() => require('@/screens/communities/CommunityPlayersScreen').CommunityPlayersScreen as typeof import('@/screens/communities/CommunityPlayersScreen').CommunityPlayersScreen} />
      <Stack.Screen name="ManagerDashboard" getComponent={() => require('@/screens/communities/ManagerDashboardScreen').ManagerDashboardScreen as typeof import('@/screens/communities/ManagerDashboardScreen').ManagerDashboardScreen} />
      <Stack.Screen name="CommunityStats" getComponent={() => require('@/screens/communities/CommunityStatsScreen').CommunityStatsScreen as typeof import('@/screens/communities/CommunityStatsScreen').CommunityStatsScreen} />
      <Stack.Screen name="CommunityHistory" getComponent={() => require('@/screens/communities/CommunityHistoryScreen').CommunityHistoryScreen as typeof import('@/screens/communities/CommunityHistoryScreen').CommunityHistoryScreen} />
      <Stack.Screen name="GameCreate" getComponent={() => require('@/screens/games/GameCreateScreen').GameCreateScreen as typeof import('@/screens/games/GameCreateScreen').GameCreateScreen} />
    </Stack.Navigator>
  );
}
