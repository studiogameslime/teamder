// Stack inside the Communities tab. The feed is the landing screen; from
// there the user can:
//   • create a community (CommunitiesCreate)
//   • open a community they're a member of (CommunityDetails — full view,
//     reads /groups/{id})
//   • preview a community they're not yet in (CommunityDetailsPublic —
//     public view, reads /groupsPublic/{id})
//
// The match-related screens (MatchDetails + LiveMatch + MatchPlayers +
// MatchManage + AvailablePlayers + GameEdit) are also registered here
// — NOT because they "belong" to communities, but so that drilling from
// CommunityDetails into a game keeps the navigation INSIDE the same
// stack. If we used cross-tab navigation (`navigate('GameTab', { screen:
// 'MatchDetails', ... })`), pressing back from MatchDetails would land
// the user on GamesList (the GameStack's initial route) instead of
// returning to the community page they came from. Same screen
// components, same route names — RN just renders a separate instance
// per stack.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { MapScreenParams } from '@/screens/map/MapScreen';

export type CommunitiesStackParamList = {
  CommunitiesFeed: undefined;
  Requests: { groupId?: string } | undefined;
  /** Full-screen map of open public communities (mode: 'communities'). */
  CommunitiesMap: MapScreenParams;
  /**
   * The contextual auth sheet's «המשך עם מייל» pushes this.
   *
   * It lives in AuthStack, which is only mounted when there is NO user — and
   * the sheet is only ever shown to a guest, who has one. So the navigate
   * resolved to nothing and the option was dead: "The action 'NAVIGATE' with
   * payload {name:'EmailAuth'} was not handled". Same component, one instance
   * per stack, exactly like the match-detail chain below.
   */
  EmailAuth: undefined;
  CommunitiesCreate: undefined;
  CommunityDetails: { groupId: string };
  CommunityDetailsPublic: { groupId: string; fromInvitation?: boolean };
  CommunityEdit: { groupId: string };
  CommunityPlayers: { groupId: string };
  ManagerDashboard: { groupId: string; initialTab?: 'overview' | 'club' | 'ratings' | 'equipment'; initialFilter?: 'all' | 'up' | 'down' };
  CommunityStats: { groupId: string };
  CommunityHistory: { groupId: string };
  Statistics: { userId?: string } | undefined;
  Feedback: { type?: 'bug' | 'suggestion'; playerId?: string; playerName?: string } | undefined;
  PlayerCard: { userId: string; groupId?: string };
  Achievements: undefined;
  PlayerCompare: { groupId: string; otherUid: string; otherName?: string };
  /** Admin-only per-community player timeline (cards + equipment handoffs). */
  PlayerTimeline: { userId: string; groupId: string; name?: string };
  // Match-detail chain — same routes as GameStack, deliberately
  // duplicated so back-navigation from MatchDetails returns to
  // CommunityDetails rather than jumping the user to the Games tab.
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
  // Admin approvals are reachable from CommunityDetails' overflow
  // menu. Registering here (rather than crossing into ProfileTab)
  // keeps "back" returning to the community page that triggered it.
  AdminApproval: { groupId?: string } | undefined;
  // Reachable from MatchDetails' overflow menu inside this stack.
  History: undefined;
  // Reachable from CommunityDetails' "צור מחזור שבועי" — opens the
  // wizard in-stack so back returns to the community page.
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
const Stack = createNativeStackNavigator<CommunitiesStackParamList>();

export function CommunitiesStack() {
  return (
    <Stack.Navigator
      initialRouteName="CommunitiesFeed"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="CommunitiesFeed" getComponent={() => require('@/screens/communities/PublicGroupsFeedScreen').PublicGroupsFeedScreen as typeof import('@/screens/communities/PublicGroupsFeedScreen').PublicGroupsFeedScreen} />
      <Stack.Screen name="Requests" getComponent={() => require('@/screens/RequestsScreen').RequestsScreen as typeof import('@/screens/RequestsScreen').RequestsScreen} />
      <Stack.Screen name="CommunitiesMap" getComponent={() => require('@/screens/map/MapScreen').MapScreen as typeof import('@/screens/map/MapScreen').MapScreen} />
      <Stack.Screen name="CommunitiesCreate" getComponent={() => require('@/screens/groups/CreateGroupScreen').CreateGroupScreen as typeof import('@/screens/groups/CreateGroupScreen').CreateGroupScreen} />
      <Stack.Screen name="EmailAuth" getComponent={() => require('@/screens/auth/EmailAuthScreen').EmailAuthScreen as typeof import('@/screens/auth/EmailAuthScreen').EmailAuthScreen} />
      <Stack.Screen name="CommunityDetails" getComponent={() => require('@/screens/communities/CommunityDetailsScreen').CommunityDetailsScreen as typeof import('@/screens/communities/CommunityDetailsScreen').CommunityDetailsScreen} />
      <Stack.Screen
        name="CommunityDetailsPublic"
        getComponent={() => require('@/screens/communities/CommunityDetailsPublicScreen').CommunityDetailsPublicScreen as typeof import('@/screens/communities/CommunityDetailsPublicScreen').CommunityDetailsPublicScreen}
      />
      <Stack.Screen name="CommunityEdit" getComponent={() => require('@/screens/communities/CommunityEditScreen').CommunityEditScreen as typeof import('@/screens/communities/CommunityEditScreen').CommunityEditScreen} />
      <Stack.Screen
        name="CommunityPlayers"
        getComponent={() => require('@/screens/communities/CommunityPlayersScreen').CommunityPlayersScreen as typeof import('@/screens/communities/CommunityPlayersScreen').CommunityPlayersScreen}
      />
      <Stack.Screen name="ManagerDashboard" getComponent={() => require('@/screens/communities/ManagerDashboardScreen').ManagerDashboardScreen as typeof import('@/screens/communities/ManagerDashboardScreen').ManagerDashboardScreen} />
      <Stack.Screen name="CommunityStats" getComponent={() => require('@/screens/communities/CommunityStatsScreen').CommunityStatsScreen as typeof import('@/screens/communities/CommunityStatsScreen').CommunityStatsScreen} />
      <Stack.Screen name="CommunityHistory" getComponent={() => require('@/screens/communities/CommunityHistoryScreen').CommunityHistoryScreen as typeof import('@/screens/communities/CommunityHistoryScreen').CommunityHistoryScreen} />
      <Stack.Screen name="PlayerCard" getComponent={() => require('@/screens/players/PlayerCardScreen').PlayerCardScreen as typeof import('@/screens/players/PlayerCardScreen').PlayerCardScreen} />
      <Stack.Screen name="Achievements" getComponent={() => require('@/screens/profile/AchievementsScreen').AchievementsScreen as typeof import('@/screens/profile/AchievementsScreen').AchievementsScreen} />
      <Stack.Screen name="Statistics" getComponent={() => require('@/screens/profile/StatisticsScreen').StatisticsScreen as typeof import('@/screens/profile/StatisticsScreen').StatisticsScreen} />
      <Stack.Screen name="Feedback" getComponent={() => require('@/screens/FeedbackScreen').FeedbackScreen as typeof import('@/screens/FeedbackScreen').FeedbackScreen} />
      <Stack.Screen name="PlayerCompare" getComponent={() => require('@/screens/players/PlayerCompareScreen').PlayerCompareScreen as typeof import('@/screens/players/PlayerCompareScreen').PlayerCompareScreen} />
      <Stack.Screen name="PlayerTimeline" getComponent={() => require('@/screens/players/PlayerTimelineScreen').PlayerTimelineScreen as typeof import('@/screens/players/PlayerTimelineScreen').PlayerTimelineScreen} />
      <Stack.Screen name="MatchDetails" getComponent={() => require('@/screens/games/MatchDetailsScreen').MatchDetailsScreen as typeof import('@/screens/games/MatchDetailsScreen').MatchDetailsScreen} />
      {/* Draft Teams (חלוקת כוחות) — MatchDetails is hosted in this stack too,
          so its "קביעת כוחות" action MUST be able to navigate here, else the tap
          silently no-ops when the game was opened from the Communities tab. */}
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
      <Stack.Screen name="AdminApproval" getComponent={() => require('@/screens/groups/AdminApprovalScreen').AdminApprovalScreen as typeof import('@/screens/groups/AdminApprovalScreen').AdminApprovalScreen} />
      <Stack.Screen name="History" getComponent={() => require('@/screens/tabs/HistoryScreen').HistoryScreen as typeof import('@/screens/tabs/HistoryScreen').HistoryScreen} />
      <Stack.Screen name="GameCreate" getComponent={() => require('@/screens/games/GameCreateScreen').GameCreateScreen as typeof import('@/screens/games/GameCreateScreen').GameCreateScreen} />
    </Stack.Navigator>
  );
}
