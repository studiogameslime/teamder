// ChatStack — the "צ'אטים" tab. A list of my chats, plus the two chat
// screens (game + community). The same chat screens are ALSO reachable
// from inside the game / community details screens, which navigate here
// via the parent tab navigator.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { CommunitiesStackParamList } from './CommunitiesStack';

import type { MapScreenParams } from '@/screens/map/MapScreen';

export type ChatStackParamList = CommunitiesStackParamList & {
  ChatsList: undefined;
  Friends: undefined;
  SocialPrivacy: undefined;
  GameChat: { gameId: string };
  CommunityChat: { groupId: string };
  DirectChat: { convId: string };
  Statistics: { userId?: string } | undefined;
  Feedback: { type?: 'bug' | 'suggestion'; playerId?: string; playerName?: string } | undefined;
  PlayerCard: { userId: string; groupId?: string };
  PlayerCompare: { groupId: string; otherUid: string; otherName?: string };
  // A player card lists the clubs that person belongs to, and tapping one
  // opens a club page. The card is registered here; the two club pages were
  // not, so from the chats tab that tap was a silent no-op — `navigate()` on a
  // name the focused stack does not register does nothing and says nothing.
  CommunityDetails: { groupId: string };
  CommunityDetailsPublic: { groupId: string; fromInvitation?: boolean };
};

// Screen modules are evaluated only when their route renders. Keep all route
// registrations local so shared destinations preserve their back stack.
const Stack = createNativeStackNavigator<ChatStackParamList>();

export function ChatStack() {
  return (
    <Stack.Navigator
      initialRouteName="ChatsList"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="ChatsList" getComponent={() => require('@/screens/chat/ChatsListScreen').ChatsListScreen as typeof import('@/screens/chat/ChatsListScreen').ChatsListScreen} />
      <Stack.Screen name="Friends" getComponent={() => require('@/screens/profile/FriendsScreen').FriendsScreen as typeof import('@/screens/profile/FriendsScreen').FriendsScreen} />
      <Stack.Screen name="SocialPrivacy" getComponent={() => require('@/screens/profile/SocialPrivacyScreen').SocialPrivacyScreen as typeof import('@/screens/profile/SocialPrivacyScreen').SocialPrivacyScreen} />
      <Stack.Screen name="GameChat" getComponent={() => require('@/screens/chat/GameChatScreen').GameChatScreen as typeof import('@/screens/chat/GameChatScreen').GameChatScreen} />
      <Stack.Screen name="CommunityChat" getComponent={() => require('@/screens/chat/CommunityChatScreen').CommunityChatScreen as typeof import('@/screens/chat/CommunityChatScreen').CommunityChatScreen} />
      <Stack.Screen name="DirectChat" getComponent={() => require('@/screens/chat/DirectChatScreen').DirectChatScreen as typeof import('@/screens/chat/DirectChatScreen').DirectChatScreen} />
      <Stack.Screen name="PlayerCard" getComponent={() => require('@/screens/players/PlayerCardScreen').PlayerCardScreen as typeof import('@/screens/players/PlayerCardScreen').PlayerCardScreen} />
      <Stack.Screen name="Achievements" getComponent={() => require('@/screens/profile/AchievementsScreen').AchievementsScreen as typeof import('@/screens/profile/AchievementsScreen').AchievementsScreen} />
      <Stack.Screen name="Statistics" getComponent={() => require('@/screens/profile/StatisticsScreen').StatisticsScreen as typeof import('@/screens/profile/StatisticsScreen').StatisticsScreen} />
      <Stack.Screen name="Feedback" getComponent={() => require('@/screens/FeedbackScreen').FeedbackScreen as typeof import('@/screens/FeedbackScreen').FeedbackScreen} />
      <Stack.Screen name="PlayerCompare" getComponent={() => require('@/screens/players/PlayerCompareScreen').PlayerCompareScreen as typeof import('@/screens/players/PlayerCompareScreen').PlayerCompareScreen} />
      <Stack.Screen name="CommunityDetails" getComponent={() => require('@/screens/communities/CommunityDetailsScreen').CommunityDetailsScreen as typeof import('@/screens/communities/CommunityDetailsScreen').CommunityDetailsScreen} />
      <Stack.Screen
        name="CommunityDetailsPublic"
        getComponent={() => require('@/screens/communities/CommunityDetailsPublicScreen').CommunityDetailsPublicScreen as typeof import('@/screens/communities/CommunityDetailsPublicScreen').CommunityDetailsPublicScreen}
      />
      <Stack.Screen name="CommunitiesFeed" getComponent={() => require('@/screens/communities/PublicGroupsFeedScreen').PublicGroupsFeedScreen as typeof import('@/screens/communities/PublicGroupsFeedScreen').PublicGroupsFeedScreen} />
      <Stack.Screen name="Requests" getComponent={() => require('@/screens/RequestsScreen').RequestsScreen as typeof import('@/screens/RequestsScreen').RequestsScreen} />
      <Stack.Screen name="CommunitiesMap" getComponent={() => require('@/screens/map/MapScreen').MapScreen as typeof import('@/screens/map/MapScreen').MapScreen} />
      <Stack.Screen name="CommunitiesCreate" getComponent={() => require('@/screens/groups/CreateGroupScreen').CreateGroupScreen as typeof import('@/screens/groups/CreateGroupScreen').CreateGroupScreen} />
      <Stack.Screen name="EmailAuth" getComponent={() => require('@/screens/auth/EmailAuthScreen').EmailAuthScreen as typeof import('@/screens/auth/EmailAuthScreen').EmailAuthScreen} />
      <Stack.Screen name="CommunityEdit" getComponent={() => require('@/screens/communities/CommunityEditScreen').CommunityEditScreen as typeof import('@/screens/communities/CommunityEditScreen').CommunityEditScreen} />
      <Stack.Screen name="CommunityPlayers" getComponent={() => require('@/screens/communities/CommunityPlayersScreen').CommunityPlayersScreen as typeof import('@/screens/communities/CommunityPlayersScreen').CommunityPlayersScreen} />
      <Stack.Screen name="ManagerDashboard" getComponent={() => require('@/screens/communities/ManagerDashboardScreen').ManagerDashboardScreen as typeof import('@/screens/communities/ManagerDashboardScreen').ManagerDashboardScreen} />
      <Stack.Screen name="CommunityStats" getComponent={() => require('@/screens/communities/CommunityStatsScreen').CommunityStatsScreen as typeof import('@/screens/communities/CommunityStatsScreen').CommunityStatsScreen} />
      <Stack.Screen name="CommunityHistory" getComponent={() => require('@/screens/communities/CommunityHistoryScreen').CommunityHistoryScreen as typeof import('@/screens/communities/CommunityHistoryScreen').CommunityHistoryScreen} />
      <Stack.Screen name="PlayerTimeline" getComponent={() => require('@/screens/players/PlayerTimelineScreen').PlayerTimelineScreen as typeof import('@/screens/players/PlayerTimelineScreen').PlayerTimelineScreen} />
      <Stack.Screen name="MatchDetails" getComponent={() => require('@/screens/games/MatchDetailsScreen').MatchDetailsScreen as typeof import('@/screens/games/MatchDetailsScreen').MatchDetailsScreen} />
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
