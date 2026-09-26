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

export type ChatStackParamList = {
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
    </Stack.Navigator>
  );
}
