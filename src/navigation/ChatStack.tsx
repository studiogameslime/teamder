// ChatStack — the "צ'אטים" tab. A list of my chats, plus the two chat
// screens (game + community). The same chat screens are ALSO reachable
// from inside the game / community details screens, which navigate here
// via the parent tab navigator.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ChatsListScreen } from '@/screens/chat/ChatsListScreen';
import { GameChatScreen } from '@/screens/chat/GameChatScreen';
import { CommunityChatScreen } from '@/screens/chat/CommunityChatScreen';
import { DirectChatScreen } from '@/screens/chat/DirectChatScreen';
import { PlayerCardScreen } from '@/screens/players/PlayerCardScreen';
import { PlayerCompareScreen } from '@/screens/players/PlayerCompareScreen';
import { CommunityDetailsScreen } from '@/screens/communities/CommunityDetailsScreen';
import { CommunityDetailsPublicScreen } from '@/screens/communities/CommunityDetailsPublicScreen';

import type { CommunitiesStackParamList } from './CommunitiesStack';
import { EmailAuthScreen } from '@/screens/auth/EmailAuthScreen';
import { PublicGroupsFeedScreen } from '@/screens/communities/PublicGroupsFeedScreen';
import { RequestsScreen } from '@/screens/RequestsScreen';
import { CreateGroupScreen } from '@/screens/groups/CreateGroupScreen';
import { CommunityEditScreen } from '@/screens/communities/CommunityEditScreen';
import { CommunityPlayersScreen } from '@/screens/communities/CommunityPlayersScreen';
import { CommunityStatsScreen } from '@/screens/communities/CommunityStatsScreen';
import { CommunityHistoryScreen } from '@/screens/communities/CommunityHistoryScreen';
import { PlayerTimelineScreen } from '@/screens/players/PlayerTimelineScreen';
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
import { LiveMatchScreen } from '@/screens/LiveMatchScreen';
import { AdminApprovalScreen } from '@/screens/groups/AdminApprovalScreen';
import { HistoryScreen } from '@/screens/tabs/HistoryScreen';
import { GameCreateScreen } from '@/screens/games/GameCreateScreen';
import { MapScreen, type MapScreenParams } from '@/screens/map/MapScreen';

export type ChatStackParamList = CommunitiesStackParamList & {
  ChatsList: undefined;
  GameChat: { gameId: string };
  CommunityChat: { groupId: string };
  DirectChat: { convId: string };
  PlayerCard: { userId: string; groupId?: string };
  PlayerCompare: { groupId: string; otherUid: string; otherName?: string };
  // A player card lists the clubs that person belongs to, and tapping one
  // opens a club page. The card is registered here; the two club pages were
  // not, so from the chats tab that tap was a silent no-op — `navigate()` on a
  // name the focused stack does not register does nothing and says nothing.
  CommunityDetails: { groupId: string };
  CommunityDetailsPublic: { groupId: string };
};

const Stack = createNativeStackNavigator<ChatStackParamList>();

export function ChatStack() {
  return (
    <Stack.Navigator
      initialRouteName="ChatsList"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="ChatsList" component={ChatsListScreen} />
      <Stack.Screen name="GameChat" component={GameChatScreen} />
      <Stack.Screen name="CommunityChat" component={CommunityChatScreen} />
      <Stack.Screen name="DirectChat" component={DirectChatScreen} />
      <Stack.Screen name="PlayerCard" component={PlayerCardScreen} />
      <Stack.Screen name="PlayerCompare" component={PlayerCompareScreen} />
      <Stack.Screen name="CommunityDetails" component={CommunityDetailsScreen} />
      <Stack.Screen
        name="CommunityDetailsPublic"
        component={CommunityDetailsPublicScreen}
      />
      <Stack.Screen name="CommunitiesFeed" component={PublicGroupsFeedScreen} />
      <Stack.Screen name="Requests" component={RequestsScreen} />
      <Stack.Screen name="CommunitiesMap" component={MapScreen} />
      <Stack.Screen name="CommunitiesCreate" component={CreateGroupScreen} />
      <Stack.Screen name="EmailAuth" component={EmailAuthScreen} />
      <Stack.Screen name="CommunityEdit" component={CommunityEditScreen} />
      <Stack.Screen name="CommunityPlayers" component={CommunityPlayersScreen} />
      <Stack.Screen name="CommunityStats" component={CommunityStatsScreen} />
      <Stack.Screen name="CommunityHistory" component={CommunityHistoryScreen} />
      <Stack.Screen name="PlayerTimeline" component={PlayerTimelineScreen} />
      <Stack.Screen name="MatchDetails" component={MatchDetailsScreen} />
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
      <Stack.Screen name="AdminApproval" component={AdminApprovalScreen} />
      <Stack.Screen name="History" component={HistoryScreen} />
      <Stack.Screen name="GameCreate" component={GameCreateScreen} />
    </Stack.Navigator>
  );
}
