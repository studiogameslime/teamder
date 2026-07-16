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
import { PublicGroupsFeedScreen } from '@/screens/communities/PublicGroupsFeedScreen';
import { RequestsScreen } from '@/screens/RequestsScreen';
import { CreateGroupScreen } from '@/screens/groups/CreateGroupScreen';
import { CommunityDetailsScreen } from '@/screens/communities/CommunityDetailsScreen';
import { CommunityDetailsPublicScreen } from '@/screens/communities/CommunityDetailsPublicScreen';
import { CommunityEditScreen } from '@/screens/communities/CommunityEditScreen';
import { CommunityPlayersScreen } from '@/screens/communities/CommunityPlayersScreen';
import { CommunityStatsScreen } from '@/screens/communities/CommunityStatsScreen';
import { CommunityHistoryScreen } from '@/screens/communities/CommunityHistoryScreen';
import { PlayerCardScreen } from '@/screens/players/PlayerCardScreen';
import { PlayerCompareScreen } from '@/screens/players/PlayerCompareScreen';
import { PlayerTimelineScreen } from '@/screens/players/PlayerTimelineScreen';
import { MatchDetailsScreen } from '@/screens/games/MatchDetailsScreen';
import { DraftSetupScreen } from '@/screens/games/DraftSetupScreen';
import { DraftBoardScreen } from '@/screens/games/DraftBoardScreen';
import { EveningSummaryScreen } from '@/screens/games/EveningSummaryScreen';
import { MatchPlayersScreen } from '@/screens/games/MatchPlayersScreen';
import { AvailablePlayersScreen } from '@/screens/games/AvailablePlayersScreen';
import { AddMembersScreen } from '@/screens/games/AddMembersScreen';
import { GameEditScreen } from '@/screens/games/GameEditScreen';
import { LiveMatchScreen } from '@/screens/LiveMatchScreen';
import { AdminApprovalScreen } from '@/screens/groups/AdminApprovalScreen';
import { HistoryScreen } from '@/screens/tabs/HistoryScreen';
import { GameCreateScreen } from '@/screens/games/GameCreateScreen';
import { MapScreen, type MapScreenParams } from '@/screens/map/MapScreen';

export type CommunitiesStackParamList = {
  CommunitiesFeed: undefined;
  Requests: undefined;
  /** Full-screen map of open public communities (mode: 'communities'). */
  CommunitiesMap: MapScreenParams;
  CommunitiesCreate: undefined;
  CommunityDetails: { groupId: string };
  CommunityDetailsPublic: { groupId: string };
  CommunityEdit: { groupId: string };
  CommunityPlayers: { groupId: string };
  CommunityStats: { groupId: string };
  CommunityHistory: { groupId: string };
  PlayerCard: { userId: string; groupId?: string };
  PlayerCompare: { groupId: string; otherUid: string; otherName?: string };
  /** Admin-only per-community player timeline (cards + equipment handoffs). */
  PlayerTimeline: { userId: string; groupId: string; name?: string };
  // Match-detail chain — same routes as GameStack, deliberately
  // duplicated so back-navigation from MatchDetails returns to
  // CommunityDetails rather than jumping the user to the Games tab.
  MatchDetails: { gameId: string };
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
  MatchPlayers: { gameId: string };
  AvailablePlayers: { gameId: string };
  AddMembers: { gameId: string };
  GameEdit: { gameId: string };
  LiveMatch: { gameId: string };
  // Admin approvals are reachable from CommunityDetails' overflow
  // menu. Registering here (rather than crossing into ProfileTab)
  // keeps "back" returning to the community page that triggered it.
  AdminApproval: undefined;
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

const Stack = createNativeStackNavigator<CommunitiesStackParamList>();

export function CommunitiesStack() {
  return (
    <Stack.Navigator
      initialRouteName="CommunitiesFeed"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="CommunitiesFeed" component={PublicGroupsFeedScreen} />
      <Stack.Screen name="Requests" component={RequestsScreen} />
      <Stack.Screen name="CommunitiesMap" component={MapScreen} />
      <Stack.Screen name="CommunitiesCreate" component={CreateGroupScreen} />
      <Stack.Screen name="CommunityDetails" component={CommunityDetailsScreen} />
      <Stack.Screen
        name="CommunityDetailsPublic"
        component={CommunityDetailsPublicScreen}
      />
      <Stack.Screen name="CommunityEdit" component={CommunityEditScreen} />
      <Stack.Screen
        name="CommunityPlayers"
        component={CommunityPlayersScreen}
      />
      <Stack.Screen name="CommunityStats" component={CommunityStatsScreen} />
      <Stack.Screen name="CommunityHistory" component={CommunityHistoryScreen} />
      <Stack.Screen name="PlayerCard" component={PlayerCardScreen} />
      <Stack.Screen name="PlayerCompare" component={PlayerCompareScreen} />
      <Stack.Screen name="PlayerTimeline" component={PlayerTimelineScreen} />
      <Stack.Screen name="MatchDetails" component={MatchDetailsScreen} />
      {/* Draft Teams (חלוקת כוחות) — MatchDetails is hosted in this stack too,
          so its "קביעת כוחות" action MUST be able to navigate here, else the tap
          silently no-ops when the game was opened from the Communities tab. */}
      <Stack.Screen name="DraftSetup" component={DraftSetupScreen} />
      <Stack.Screen name="DraftBoard" component={DraftBoardScreen} />
      <Stack.Screen name="EveningSummary" component={EveningSummaryScreen} />
      <Stack.Screen name="AddMembers" component={AddMembersScreen} />
      <Stack.Screen name="MatchPlayers" component={MatchPlayersScreen} />
      <Stack.Screen name="AvailablePlayers" component={AvailablePlayersScreen} />
      <Stack.Screen name="GameEdit" component={GameEditScreen} />
      <Stack.Screen name="LiveMatch" component={LiveMatchScreen} />
      <Stack.Screen name="AdminApproval" component={AdminApprovalScreen} />
      <Stack.Screen name="History" component={HistoryScreen} />
      <Stack.Screen name="GameCreate" component={GameCreateScreen} />
    </Stack.Navigator>
  );
}
