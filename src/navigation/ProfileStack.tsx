import { ManagerDashboardScreen } from '@/screens/communities/ManagerDashboardScreen';
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
import { ProfileScreen } from '@/screens/tabs/ProfileScreen';
import { GuestHomeScreen } from '@/screens/home/GuestHomeScreen';
import { PersonalInviteScreen } from '@/screens/invite/PersonalInviteScreen';
import { CreateGroupScreen } from '@/screens/groups/CreateGroupScreen';
import { CommunityDetailsPublicScreen } from '@/screens/communities/CommunityDetailsPublicScreen';
import { EmailAuthScreen } from '@/screens/auth/EmailAuthScreen';
import { RequestsScreen } from '@/screens/RequestsScreen';
import { ProfileEditScreen } from '@/screens/tabs/ProfileEditScreen';
import { AvailabilityEditScreen } from '@/screens/profile/AvailabilityEditScreen';
import { AvailabilityWeekScreen } from '@/screens/home/AvailabilityWeekScreen';
import { NotificationsSettingsScreen } from '@/screens/profile/NotificationsSettingsScreen';
import { BlockedUsersScreen } from '@/screens/profile/BlockedUsersScreen';
import { AchievementsScreen } from '@/screens/profile/AchievementsScreen';
import { SeasonTitlesScreen } from '@/screens/profile/SeasonTitlesScreen';
import { StatisticsScreen } from '@/screens/profile/StatisticsScreen';
import { FriendsScreen } from '@/screens/profile/FriendsScreen';
import { PlayerCardScreen } from '@/screens/players/PlayerCardScreen';
import { PlayerCompareScreen } from '@/screens/players/PlayerCompareScreen';
import { PlayerTimelineScreen } from '@/screens/players/PlayerTimelineScreen';
import { AdminApprovalScreen } from '@/screens/groups/AdminApprovalScreen';
import { HistoryScreen } from '@/screens/tabs/HistoryScreen';
import { MatchDetailsScreen } from '@/screens/games/MatchDetailsScreen';
import { DraftSetupScreen } from '@/screens/games/DraftSetupScreen';
import { DraftBoardScreen } from '@/screens/games/DraftBoardScreen';
import { EveningSummaryScreen } from '@/screens/games/EveningSummaryScreen';
import { SeasonSummaryScreen } from '@/screens/profile/SeasonSummaryScreen';
import { MatchRoundsScreen } from '@/screens/games/MatchRoundsScreen';
import { MatchPlayersScreen } from '@/screens/games/MatchPlayersScreen';
import { AvailablePlayersScreen } from '@/screens/games/AvailablePlayersScreen';
import { AddMembersScreen } from '@/screens/games/AddMembersScreen';
import { GameEditScreen } from '@/screens/games/GameEditScreen';
import { GameCreateScreen } from '@/screens/games/GameCreateScreen';
import { LiveMatchScreen } from '@/screens/LiveMatchScreen';
import { CommunityDetailsScreen } from '@/screens/communities/CommunityDetailsScreen';
import { CommunityEditScreen } from '@/screens/communities/CommunityEditScreen';
import { CommunityPlayersScreen } from '@/screens/communities/CommunityPlayersScreen';
import { CommunityStatsScreen } from '@/screens/communities/CommunityStatsScreen';
import { CommunityHistoryScreen } from '@/screens/communities/CommunityHistoryScreen';
import { ReferralsListScreen } from '@/screens/profile/ReferralsListScreen';
import { FeedbackScreen } from '@/screens/FeedbackScreen';

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
  Requests: undefined;
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
  AdminApproval: undefined;
  History: undefined;
  Achievements: undefined;
  SeasonTitles: undefined;
  Statistics: undefined;
  Friends: undefined;
  Referrals: undefined;
  Feedback: { type?: 'bug' | 'suggestion' } | undefined;
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
  DraftSetup: { gameId: string };
  DraftBoard: {
    gameId: string;
    captainIds: string[];
    method: 'snake' | 'regular';
    resume?: boolean;
    readOnly?: boolean;
  };
  EveningSummary: { gameId: string };
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
  CommunityDetailsPublic: { groupId: string };
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
      <Stack.Screen name="GuestHome" component={GuestHomeScreen} />
      <Stack.Screen name="PersonalInvite" component={PersonalInviteScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="CommunitiesCreate" component={CreateGroupScreen} />
      <Stack.Screen
        name="CommunityDetailsPublic"
        component={CommunityDetailsPublicScreen}
      />
      <Stack.Screen name="EmailAuth" component={EmailAuthScreen} />
      <Stack.Screen name="AvailabilityWeek" component={AvailabilityWeekScreen} />
      <Stack.Screen name="Requests" component={RequestsScreen} />
      <Stack.Screen name="ProfileEdit" component={ProfileEditScreen} />
      <Stack.Screen name="BlockedUsers" component={BlockedUsersScreen} />
      <Stack.Screen
        name="AvailabilityEdit"
        component={AvailabilityEditScreen}
      />
      <Stack.Screen
        name="NotificationsSettings"
        component={NotificationsSettingsScreen}
      />
      <Stack.Screen name="PlayerCard" component={PlayerCardScreen} />
      <Stack.Screen name="PlayerCompare" component={PlayerCompareScreen} />
      <Stack.Screen name="PlayerTimeline" component={PlayerTimelineScreen} />
      <Stack.Screen name="AdminApproval" component={AdminApprovalScreen} />
      <Stack.Screen name="History" component={HistoryScreen} />
      <Stack.Screen name="Achievements" component={AchievementsScreen} />
      <Stack.Screen name="SeasonTitles" component={SeasonTitlesScreen} />
      <Stack.Screen name="Statistics" component={StatisticsScreen} />
      <Stack.Screen name="Friends" component={FriendsScreen} />
      <Stack.Screen name="Referrals" component={ReferralsListScreen} />
      <Stack.Screen name="Feedback" component={FeedbackScreen} />
      <Stack.Screen name="MatchDetails" component={MatchDetailsScreen} />
      {/* Draft Teams (חלוקת כוחות) — MatchDetails is hosted in this stack too,
          so its "קביעת כוחות" action MUST be able to navigate here, else the tap
          silently no-ops when the game was opened from the Profile/Home tab. */}
      <Stack.Screen name="DraftSetup" component={DraftSetupScreen} />
      <Stack.Screen name="DraftBoard" component={DraftBoardScreen} />
      <Stack.Screen name="EveningSummary" component={EveningSummaryScreen} />
      <Stack.Screen name="SeasonSummary" component={SeasonSummaryScreen} />
      <Stack.Screen name="MatchRounds" component={MatchRoundsScreen} />
      <Stack.Screen name="AddMembers" component={AddMembersScreen} />
      <Stack.Screen name="MatchPlayers" component={MatchPlayersScreen} />
      <Stack.Screen name="AvailablePlayers" component={AvailablePlayersScreen} />
      <Stack.Screen name="GameEdit" component={GameEditScreen} />
      <Stack.Screen name="LiveMatch" component={LiveMatchScreen} />
      <Stack.Screen name="CommunityDetails" component={CommunityDetailsScreen} />
      <Stack.Screen name="CommunityEdit" component={CommunityEditScreen} />
      <Stack.Screen name="CommunityPlayers" component={CommunityPlayersScreen} />
      <Stack.Screen name="ManagerDashboard" component={ManagerDashboardScreen} />
      <Stack.Screen name="CommunityStats" component={CommunityStatsScreen} />
      <Stack.Screen name="CommunityHistory" component={CommunityHistoryScreen} />
      <Stack.Screen name="GameCreate" component={GameCreateScreen} />
    </Stack.Navigator>
  );
}
